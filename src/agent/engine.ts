import { GoogleGenAI, Content } from '@google/genai';
import {
  PhysicalRoomScanManifest,
  SceneGraphState,
  SpatialEntityInstance,
  Vector3D
} from '../types/spatial';
import { SpatialMath } from '../spatial/math';
import { SpatialGuardrailsEngine } from '../spatial/guardrails';
import { habitexTools } from './tools';

export interface CatalogItemRecord {
  sku: string;
  name: string;
  category: string;
  dimensionsMetric: Vector3D;
  priceCents: number;
  currency: string;
  inStock: boolean;
  leadTimeDays: number;
  gltfUrl: string;
  usdzUrl: string;
}

export interface EngineDependencies {
  findCatalogItemBySku: (sku: string) => Promise<CatalogItemRecord | null>;
  searchCatalog: (query: string, maxDim?: Vector3D, maxPrice?: number) => Promise<CatalogItemRecord[]>;
  compareRetailers: (sku: string) => Promise<Array<{ retailer: string; priceUsd: number; inStock: boolean; leadDays: number }>>;
  commitPurchaseReservation: (items: Array<{ sku: string; quantity: number, instanceId?: string }>) => Promise<{ reservationId: string; expiresAt: string; totalUsd: number }>;
}

export class HabitexSpatialEngine {
  private ai: GoogleGenAI;
  private deps: EngineDependencies;

  constructor(deps: EngineDependencies, apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("Missing Gemini API Key");
    }
    this.ai = new GoogleGenAI({ apiKey: key });
    this.deps = deps;
  }

  private constructSystemInstruction(scan: PhysicalRoomScanManifest, scene: SceneGraphState): string {
    const wallPlanes = scan.planes.filter(p => p.semanticType === 'wall');
    const floorPlanes = scan.planes.filter(p => p.semanticType === 'floor');
    const openings = scan.planes.filter(p => p.semanticType === 'door' || p.semanticType === 'window');

    return `
You are the Habitex AI Spatial Design & Architecture Intelligence Agent.
You operate inside a real-time spatial computing environment (Apple Vision Pro and WebXR).
You reason mathematically in SI metres using a Right-Handed Coordinate Reference System (+X: Right, +Y: Up, +Z: Backwards/Towards user).

PHYSICAL ROOM CONSTRAINTS & SCAN TOPOLOGY:
- Bounding Box Min: [${scan.bounds.min.map(n => n.toFixed(2)).join(', ')}]
- Bounding Box Max: [${scan.bounds.max.map(n => n.toFixed(2)).join(', ')}]
- Room Center: [${scan.bounds.center.map(n => n.toFixed(2)).join(', ')}]
- Room Extents (half-sizes): [${scan.bounds.extents.map(n => n.toFixed(2)).join(', ')}]
- Detected Structural Walls: ${wallPlanes.length} (IDs: ${wallPlanes.map(w => `'${w.id}'`).join(', ')})
- Detected Floors: ${floorPlanes.length}
- Detected Architectural Openings (Clearance Zones): ${openings.map(o => `${o.semanticType}: '${o.id}'`).join(', ')}
- Environmental Ambient Lighting: ${scan.lightProbe.ambientIntensityLumens} Lumens, Temp: ${scan.lightProbe.colorTemperatureKelvin}K

CURRENT SCENE ENTITIES:
${scene.entities.map(e => `- ID: "${e.instanceId}", Name: "${e.name}", SKU: "${e.sku}", Position: [${e.transform.position.map(n => n.toFixed(2)).join(', ')}], RotationY: [${e.transform.rotation.map(n => n.toFixed(2)).join(', ')}]`).join('\n') || 'None'}

SURFACE MODIFICATIONS:
${scene.wallSurfaceModifications.map(w => `- Wall '${w.planeAnchorId}': ${w.pbrMaterial.materialCategory} (${w.pbrMaterial.albedoHex})`).join('\n') || 'Default scans'}

OPERATIONAL RULES:
1. SPATIAL ADMISSIBILITY: Never place an entity that causes a collision or clearance buffer violation. Floor items must sit at Y = 0.00.
2. ROTATION ACCURACY: Provide yaw rotations in degrees [0-360]. When objects are placed against walls, ensure they face toward the room center.
3. COMMERCE VERIFICATION: If user asks for furniture, search catalog inventory before placing to verify metric dimensions fit the room context.
4. CORRECTION HANDLING: If a tool execution response contains a spatial guardrail failure, recalculate and correct position/orientation immediately.
`;
  }

  async processDesignTurn(
    userPrompt: string,
    scan: PhysicalRoomScanManifest,
    scene: SceneGraphState,
    conversationHistory: Content[] = []
  ): Promise<{
    agentReply: string;
    updatedScene: SceneGraphState;
    executedToolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>;
    history: Content[];
  }> {
    const executedToolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }> = [];
    const activeScene: SceneGraphState = JSON.parse(JSON.stringify(scene));

    const contents: Content[] = [
      ...conversationHistory,
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ];

    const systemInstruction = this.constructSystemInstruction(scan, activeScene);
    const MAX_TOOL_ITERATIONS = 6;
    let iteration = 0;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      const response = await this.ai.models.generateContent({
        model: 'gemini-3.7-flash',
        contents,
        config: {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          tools: [{ functionDeclarations: habitexTools }],
          temperature: 0.15
        }
      });

      const candidate = response.candidates?.[0];
      if (!candidate || !candidate.content) {
        throw new Error('Spatial Engine: Received empty candidate response from Gemini.');
      }

      contents.push(candidate.content);

      const functionCalls = (candidate.content.parts || []).filter(
        (p): p is { functionCall: { name: string; args: Record<string, unknown> } } => 
          'functionCall' in p && typeof p.functionCall === 'object' && p.functionCall !== null
      );

      if (functionCalls.length === 0) {
        return {
          agentReply: response.text || '',
          updatedScene: activeScene,
          executedToolCalls,
          history: contents
        };
      }

      const toolResponseParts: Array<{ functionResponse: { name: string; response: Record<string, unknown> } }> = [];

      for (const part of functionCalls) {
        const call = part.functionCall;
        const args = call.args;

        let executionResult: Record<string, unknown>;

        try {
          switch (call.name) {
            case 'place_model': {
              const { sku, position, rotationDegreesY, targetWallId, clearanceBufferMeters } = args as {
                sku: string;
                position: Vector3D;
                rotationDegreesY: number;
                targetWallId?: string;
                clearanceBufferMeters?: number;
              };
              
              const item = await this.deps.findCatalogItemBySku(sku);

              if (!item) {
                executionResult = { error: `Item with SKU ${sku} not found in catalog.` };
                break;
              }

              const tentativeTransform = {
                position: position,
                rotation: SpatialMath.quaternionFromEulerY(rotationDegreesY),
                scale: [1, 1, 1] as Vector3D
              };

              const tentativeBoundingBox = {
                min: [-item.dimensionsMetric[0] / 2, 0, -item.dimensionsMetric[2] / 2] as Vector3D,
                max: [item.dimensionsMetric[0] / 2, item.dimensionsMetric[1], item.dimensionsMetric[2] / 2] as Vector3D,
                center: [0, item.dimensionsMetric[1] / 2, 0] as Vector3D,
                extents: [item.dimensionsMetric[0] / 2, item.dimensionsMetric[1] / 2, item.dimensionsMetric[2] / 2] as Vector3D
              };

              const tentativeEntity: SpatialEntityInstance = {
                instanceId: `ent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                catalogItemId: sku,
                sku,
                name: item.name,
                transform: tentativeTransform,
                boundingBox: tentativeBoundingBox,
                clearanceBufferMeters: clearanceBufferMeters ?? 0.35,
                isWallMounted: false
              };

              const validation = SpatialGuardrailsEngine.validateEntityPlacement(
                tentativeEntity,
                scan,
                activeScene,
                targetWallId
              );

              if (!validation.valid) {
                executionResult = {
                  status: 'GUARDRAIL_VIOLATION',
                  code: validation.code,
                  message: validation.message,
                  suggestedCorrection: validation.suggestedCorrection
                };
              } else {
                activeScene.entities.push(tentativeEntity);
                activeScene.version += 1;
                executionResult = {
                  status: 'SUCCESS',
                  instanceId: tentativeEntity.instanceId,
                  name: tentativeEntity.name,
                  position: tentativeEntity.transform.position,
                  rotation: tentativeEntity.transform.rotation
                };
              }
              break;
            }

            case 'transform_object': {
              const { instanceId, newPosition, newRotationDegreesY, scaleMultiplier } = args as {
                instanceId: string;
                newPosition?: Vector3D;
                newRotationDegreesY?: number;
                scaleMultiplier?: number;
              };
              
              const targetEntity = activeScene.entities.find(e => e.instanceId === instanceId);

              if (!targetEntity) {
                executionResult = { error: `Entity with ID '${instanceId}' was not found in active scene.` };
                break;
              }

              const modifiedTransform = {
                position: newPosition ?? targetEntity.transform.position,
                rotation: newRotationDegreesY !== undefined
                  ? SpatialMath.quaternionFromEulerY(newRotationDegreesY)
                  : targetEntity.transform.rotation,
                scale: scaleMultiplier !== undefined
                  ? [scaleMultiplier, scaleMultiplier, scaleMultiplier] as Vector3D
                  : targetEntity.transform.scale
              };

              const tentativeModified: SpatialEntityInstance = {
                ...targetEntity,
                transform: modifiedTransform
              };

              const validation = SpatialGuardrailsEngine.validateEntityPlacement(
                tentativeModified,
                scan,
                activeScene
              );

              if (!validation.valid) {
                executionResult = {
                  status: 'GUARDRAIL_VIOLATION',
                  code: validation.code,
                  message: validation.message,
                  suggestedCorrection: validation.suggestedCorrection
                };
              } else {
                targetEntity.transform = modifiedTransform;
                activeScene.version += 1;
                executionResult = {
                  status: 'SUCCESS',
                  instanceId,
                  updatedTransform: targetEntity.transform
                };
              }
              break;
            }

            case 'delete_object': {
              const { instanceId } = args as { instanceId: string };
              const initialCount = activeScene.entities.length;
              activeScene.entities = activeScene.entities.filter(e => e.instanceId !== instanceId);

              if (activeScene.entities.length === initialCount) {
                executionResult = { error: `Entity '${instanceId}' not found for deletion.` };
              } else {
                activeScene.version += 1;
                executionResult = { status: 'SUCCESS', deletedInstanceId: instanceId };
              }
              break;
            }

            case 'adjust_lighting': {
              const { ambientLightColorHex, ambientIntensityLumens, directionalRigs } = args as {
                ambientLightColorHex: string;
                ambientIntensityLumens: number;
                directionalRigs?: Array<{ direction: Vector3D; intensityLux: number; castShadows: boolean }>;
              };
              
              const cleanHex = ambientLightColorHex.replace('#', '');
              const r = parseInt(cleanHex.substring(0, 2), 16) / 255.0;
              const g = parseInt(cleanHex.substring(2, 4), 16) / 255.0;
              const b = parseInt(cleanHex.substring(4, 6), 16) / 255.0;

              activeScene.environmentLighting.overrideEnabled = true;
              activeScene.environmentLighting.ambientLightColor = [r, g, b];
              activeScene.environmentLighting.ambientIntensity = ambientIntensityLumens;

              if (directionalRigs && Array.isArray(directionalRigs)) {
                activeScene.environmentLighting.directionalRig = directionalRigs.map((rig, idx) => ({
                  id: `rig_dir_${idx}`,
                  position: [0, 2.5, 0],
                  direction: rig.direction,
                  intensity: rig.intensityLux,
                  castShadows: rig.castShadows
                }));
              }

              activeScene.version += 1;
              executionResult = {
                status: 'SUCCESS',
                lighting: activeScene.environmentLighting as unknown as Record<string, unknown>
              };
              break;
            }

            case 'set_surface_material': {
              const { planeAnchorId, materialCategory, albedoHex, roughness, metallic } = args as {
                planeAnchorId: string;
                materialCategory: string;
                albedoHex: string;
                roughness: number;
                metallic: number;
              };
              
              const plane = scan.planes.find(p => p.id === planeAnchorId);

              if (!plane) {
                executionResult = { error: `Plane anchor ID '${planeAnchorId}' not found in scan manifest.` };
                break;
              }

              const modificationIndex = activeScene.wallSurfaceModifications.findIndex(
                w => w.planeAnchorId === planeAnchorId
              );

              const pbrMaterial = { albedoHex, roughness, metallic, materialCategory };

              if (modificationIndex >= 0) {
                activeScene.wallSurfaceModifications[modificationIndex].pbrMaterial = pbrMaterial;
              } else {
                activeScene.wallSurfaceModifications.push({ planeAnchorId, pbrMaterial });
              }

              activeScene.version += 1;
              executionResult = { status: 'SUCCESS', updatedPlaneId: planeAnchorId, pbrMaterial };
              break;
            }

            case 'search_inventory': {
              const { query, maxDimensions, maxBudgetUsd } = args as {
                query: string;
                maxDimensions?: Vector3D;
                maxBudgetUsd?: number;
              };
              const items = await this.deps.searchCatalog(query, maxDimensions, maxBudgetUsd);
              executionResult = {
                count: items.length,
                results: items.slice(0, 4).map(it => ({
                  sku: it.sku,
                  name: it.name,
                  category: it.category,
                  dimensionsMeters: it.dimensionsMetric,
                  priceUsd: (it.priceCents / 100).toFixed(2),
                  inStock: it.inStock
                }))
              };
              break;
            }

            case 'compare_prices': {
              const { sku } = args as { sku: string; includeAlternatives?: boolean };
              const retailers = await this.deps.compareRetailers(sku);
              executionResult = { sku, comparisons: retailers };
              break;
            }

            case 'stage_purchase': {
              const { items } = args as { items: Array<{ sku: string; quantity: number; instanceId?: string }> };
              const reservation = await this.deps.commitPurchaseReservation(items);
              executionResult = { status: 'STAGED', reservation: reservation as unknown as Record<string, unknown> };
              break;
            }

            default:
              executionResult = { error: `Unknown tool name: ${call.name}` };
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          executionResult = { error: `Internal tool execution failure: ${errorMessage}` };
        }

        executedToolCalls.push({ name: call.name, args, result: executionResult });

        toolResponseParts.push({
          functionResponse: {
            name: call.name,
            response: executionResult
          }
        });
      }

      contents.push({
        role: 'user',
        parts: toolResponseParts as unknown as Array<Record<string, unknown>>
      });
    }

    return {
      agentReply: 'Maximum spatial reasoning steps reached. Changes up to this point have been applied.',
      updatedScene: activeScene,
      executedToolCalls,
      history: contents
    };
  }
}
