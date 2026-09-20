import { NextRequest } from 'next/server';
import { GoogleGenAI, type Content } from '@google/genai';
import { createClientFromRequest, createAdminClient } from '../../../../lib/supabase/server';
import { habitexTools } from '../../../../agent/tools';
import { SpatialMath } from '../../../../spatial/math';
import { SpatialGuardrailsEngine } from '../../../../spatial/guardrails';
import type {
  PhysicalRoomScanManifest,
  SceneGraphState,
  SpatialEntityInstance,
  Vector3D,
} from '../../../../types/spatial';
import type { Database, Json } from '../../../../types/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type StreamEventType =
  | 'thought'
  | 'tool_call'
  | 'guardrail_check'
  | 'scene_mutation'
  | 'inventory_result'
  | 'commentary'
  | 'error'
  | 'done';

function formatSSE(event: StreamEventType, data: Record<string, unknown>): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const supabase = await createClientFromRequest();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { sessionId, userMessage, conversationHistory = [] } = (await req.json()) as {
    sessionId: string;
    userMessage: string;
    conversationHistory?: Content[];
  };

  if (!sessionId || !userMessage) {
    return new Response(JSON.stringify({ error: 'Missing required parameters: sessionId, userMessage' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: sessionRaw, error: sessionError } = await supabase
    .from('design_sessions')
    .select(`
      id,
      user_id,
      version,
      environment_lighting,
      room_scans (*),
      scene_entities (*),
      surface_modifications (*)
    `)
    .eq('id', sessionId)
    .single();

  const session = sessionRaw as unknown as {
    id: string;
    user_id: string;
    version: number;
    environment_lighting: unknown;
    room_scans: Record<string, unknown>;
    scene_entities: Record<string, unknown>[];
    surface_modifications: Record<string, unknown>[];
  } | null;

  if (sessionError || !session || !session.room_scans) {
    return new Response(JSON.stringify({ error: 'Design session or associated scan manifest not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const scanData = session.room_scans as unknown as {
    id: string;
    user_id: string;
    created_at: string;
    client_runtime: 'VisionOS' | 'WebXR';
    device_hardware: string;
    bounding_box: PhysicalRoomScanManifest['bounds'];
    planes: PhysicalRoomScanManifest['planes'];
    light_probe: PhysicalRoomScanManifest['lightProbe'];
  };

  const scanManifest: PhysicalRoomScanManifest = {
    scanId: scanData.id,
    userId: scanData.user_id,
    capturedAt: scanData.created_at,
    clientRuntime: scanData.client_runtime,
    deviceHardware: scanData.device_hardware,
    bounds: scanData.bounding_box,
    planes: scanData.planes,
    lightProbe: scanData.light_probe,
  };

  const activeScene: SceneGraphState = {
    version: session.version,
    sessionId: session.id,
    environmentLighting: (session.environment_lighting as unknown as SceneGraphState['environmentLighting']) || {
      overrideEnabled: false,
      ambientLightColor: [1, 1, 1],
      ambientIntensity: scanManifest.lightProbe.ambientIntensityLumens,
      directionalRig: [],
    },
    wallSurfaceModifications: (session.surface_modifications || []).map((s) => ({
      planeAnchorId: s.plane_anchor_id as string,
      pbrMaterial: s.pbr_material as SceneGraphState['wallSurfaceModifications'][0]['pbrMaterial'],
    })),
    entities: (session.scene_entities || []).map((s) => {
      const pos = Array.isArray(s.position) ? s.position : JSON.parse(s.position as string);
      const rot = Array.isArray(s.rotation) ? s.rotation : JSON.parse(s.rotation as string);
      const scl = s.scale ? (Array.isArray(s.scale) ? s.scale : JSON.parse(s.scale as string)) : [1, 1, 1];
      return {
        instanceId: s.id as string,
        catalogItemId: s.catalog_item_id as string,
        sku: s.catalog_item_id as string,
        name: 'Scene Placed Entity',
        transform: { position: pos, rotation: rot, scale: scl },
        boundingBox: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5], center: [0, 0.5, 0], extents: [0.5, 0.5, 0.5] },
        clearanceBufferMeters: 0.35,
      };
    }),
  };

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    const adminSupabase = createAdminClient();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await writer.write(formatSSE('error', { message: 'Missing Gemini API configuration' }));
      await writer.close();
      return;
    }
    const ai = new GoogleGenAI({ apiKey });

    const wallPlanes = scanManifest.planes.filter((p) => p.semanticType === 'wall');
    const floorPlanes = scanManifest.planes.filter((p) => p.semanticType === 'floor');
    const openings = scanManifest.planes.filter((p) => p.semanticType === 'door' || p.semanticType === 'window');

    const systemInstruction = `
You are Habitex AI, an autonomous interior architect and spatial computing agent for VisionOS & WebXR.
Coordinate System: Right-handed metric system (+X: Right, +Y: Up, +Z: Outward).

PHYSICAL CONSTRAINTS:
- Room Metric Bounds: Min [${scanManifest.bounds.min.join(', ')}] | Max [${scanManifest.bounds.max.join(', ')}]
- Structural Walls: ${wallPlanes.map((w) => `'${w.id}'`).join(', ')}
- Floors Detected: ${floorPlanes.length}
- Doorways & Clearances: ${openings.map((o) => `${o.semanticType} ('${o.id}')`).join(', ')}

CURRENT SCENE ENTITIES (${activeScene.entities.length}):
${activeScene.entities.map((e) => `- ${e.name} [ID: ${e.instanceId}]: pos=[${e.transform.position.join(', ')}]`).join('\n') || 'None'}

SURFACE MODS:
${activeScene.wallSurfaceModifications.map((m) => `- Wall '${m.planeAnchorId}': ${m.pbrMaterial.materialCategory}`).join('\n') || 'Original'}

OPERATIONAL PRINCIPLES:
1. Always test catalog items before placing using 'search_inventory' or target dimensions.
2. Floor furniture must have position Y = 0.00.
3. Obey clearance buffers around doorways and corridors.
4. If a tool reports a GUARDRAIL_VIOLATION, review the suggested correction and call the tool again with the adjusted transform.
`;

    const contents: Content[] = [
      ...conversationHistory,
      { role: 'user', parts: [{ text: userMessage }] } as unknown as Content,
    ];

    const entitiesToInsertBatch: Array<Record<string, unknown>> = [];
    const surfacesToUpsertBatch: Array<Record<string, unknown>> = [];

    const MAX_TOOL_HOPS = 6;
    let iteration = 0;

    try {
      await writer.write(
        formatSSE('thought', { message: 'Analyzing room scan and spatial constraints...' })
      );

      while (iteration < MAX_TOOL_HOPS) {
        iteration++;

        const response = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents,
          config: {
            systemInstruction: { parts: [{ text: systemInstruction }] } as unknown as Content,
            tools: [{ functionDeclarations: habitexTools }],
            temperature: 0.15,
          },
        });

        const candidate = response.candidates?.[0];
        if (!candidate || !candidate.content) {
          throw new Error('Spatial agent generated empty response.');
        }

        contents.push(candidate.content);

        const functionCalls = (candidate.content.parts || []).filter(
          (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
            'functionCall' in p && typeof p.functionCall === 'object' && p.functionCall !== null
        );

        if (functionCalls.length === 0) {
          const finalMessage = response.text || 'Layout updated according to preferences.';
          await writer.write(formatSSE('commentary', { text: finalMessage }));
          break;
        }

        const toolResponseParts: Array<{ functionResponse: { name: string; response: Record<string, unknown> } }> = [];

        for (const part of functionCalls) {
          const call = part.functionCall;
          const args = call.args;

          await writer.write(
            formatSSE('tool_call', { tool: call.name, parameters: args })
          );

          let toolResult: Record<string, unknown>;

          switch (call.name) {
            case 'place_model': {
              const { sku, position, rotationDegreesY, targetWallId, clearanceBufferMeters } = args as {
                sku: string;
                position: Vector3D;
                rotationDegreesY?: number;
                targetWallId?: string;
                clearanceBufferMeters?: number;
              };

              const { data: itemRaw } = await supabase
                .from('spatial_catalog_items')
                .select('*')
                .eq('sku', sku)
                .single();
                
              const item = itemRaw as unknown as Database['public']['Tables']['spatial_catalog_items']['Row'] | null;

              if (!item) {
                toolResult = { status: 'ERROR', message: `SKU '${sku}' not found in catalog.` };
                break;
              }

              const dim = Array.isArray(item.dimensions_metric)
                ? (item.dimensions_metric as [number, number, number])
                : (JSON.parse(item.dimensions_metric as string) as [number, number, number]);

              const tentativeEntity: SpatialEntityInstance = {
                instanceId: `ent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                catalogItemId: item.id,
                sku: item.sku,
                name: item.name,
                transform: {
                  position,
                  rotation: SpatialMath.quaternionFromEulerY(rotationDegreesY || 0),
                  scale: [1, 1, 1],
                },
                boundingBox: {
                  min: [-dim[0] / 2, 0, -dim[2] / 2],
                  max: [dim[0] / 2, dim[1], dim[2] / 2],
                  center: [0, dim[1] / 2, 0],
                  extents: [dim[0] / 2, dim[1] / 2, dim[2] / 2],
                },
                clearanceBufferMeters: clearanceBufferMeters ?? 0.35,
                isWallMounted: false,
              };

              const validation = SpatialGuardrailsEngine.validateEntityPlacement(
                tentativeEntity,
                scanManifest,
                activeScene,
                targetWallId
              );

              await writer.write(
                formatSSE('guardrail_check', {
                  sku,
                  status: validation.valid ? 'PASSED' : 'FAILED',
                  code: validation.code,
                  message: validation.message,
                  correction: validation.suggestedCorrection,
                })
              );

              if (!validation.valid) {
                toolResult = {
                  status: 'GUARDRAIL_VIOLATION',
                  code: validation.code,
                  message: validation.message,
                  suggestedCorrection: validation.suggestedCorrection as unknown as Record<string, unknown>,
                };
              } else {
                activeScene.entities.push(tentativeEntity);
                entitiesToInsertBatch.push({
                  catalog_item_id: item.id,
                  position: tentativeEntity.transform.position,
                  rotation: tentativeEntity.transform.rotation,
                  scale: tentativeEntity.transform.scale,
                });

                toolResult = {
                  status: 'SUCCESS',
                  instanceId: tentativeEntity.instanceId,
                  name: item.name,
                  position: tentativeEntity.transform.position,
                };

                await writer.write(
                  formatSSE('scene_mutation', {
                    action: 'ENTITY_ADDED',
                    entity: tentativeEntity as unknown as Record<string, unknown>,
                    assets: {
                      gltf: item.gltf_storage_path,
                      usdz: item.usdz_storage_path,
                    },
                  })
                );
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

              activeScene.environmentLighting = {
                overrideEnabled: true,
                ambientLightColor: [r, g, b],
                ambientIntensity: ambientIntensityLumens,
                directionalRig: (directionalRigs || []).map((d, idx) => ({
                  id: `light_${idx}`,
                  position: [0, 2.5, 0],
                  direction: d.direction,
                  intensity: d.intensityLux,
                  castShadows: d.castShadows,
                })),
              };

              await adminSupabase
                .from('design_sessions')
                .update({ environment_lighting: activeScene.environmentLighting as unknown as Json })
                .eq('id', sessionId);

              toolResult = { status: 'SUCCESS', lighting: activeScene.environmentLighting as unknown as Record<string, unknown> };

              await writer.write(
                formatSSE('scene_mutation', { action: 'LIGHTING_CHANGED', lighting: activeScene.environmentLighting as unknown as Record<string, unknown> })
              );
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

              const targetPlane = scanManifest.planes.find((p) => p.id === planeAnchorId);

              if (!targetPlane) {
                toolResult = { status: 'ERROR', message: `Plane '${planeAnchorId}' does not exist.` };
                break;
              }

              const pbrMaterial = {
                materialId: `mat_${materialCategory}`,
                name: materialCategory,
                albedoFactor: [1, 1, 1, 1] as [number, number, number, number],
                roughnessFactor: roughness,
                metallicFactor: metallic,
                albedoHex,
                uvScale: [1.0, 1.0] as [number, number],
              };

              surfacesToUpsertBatch.push({
                plane_anchor_id: planeAnchorId,
                surface_type: targetPlane.semanticType,
                pbr_material: pbrMaterial,
              });

              toolResult = { status: 'SUCCESS', planeAnchorId, pbrMaterial: pbrMaterial as unknown as Record<string, unknown> };

              await writer.write(
                formatSSE('scene_mutation', { action: 'SURFACE_MODIFIED', planeAnchorId, pbrMaterial: pbrMaterial as unknown as Record<string, unknown> })
              );
              break;
            }

            case 'search_inventory': {
              const { query, maxBudgetUsd } = args as {
                query: string;
                maxBudgetUsd?: number;
                maxDimensions?: number[];
              };

              let dbQuery = adminSupabase
                .from('spatial_catalog_items')
                .select('*')
                .ilike('name', `%${query}%`)
                .eq('in_stock', true);

              if (maxBudgetUsd) {
                dbQuery = dbQuery.lte('price_cents', maxBudgetUsd * 100);
              }

              const { data: matchesRaw } = await dbQuery.limit(4);
              const matches = matchesRaw as Array<Database['public']['Tables']['spatial_catalog_items']['Row']> | null;

              toolResult = {
                count: matches?.length || 0,
                items: (matches || []).map((m) => ({
                  sku: m.sku,
                  name: m.name,
                  priceUsd: (m.price_cents / 100).toFixed(2),
                  dimensionsMeters: m.dimensions_metric,
                })),
              };

              await writer.write(formatSSE('inventory_result', { query, items: toolResult.items as unknown as Record<string, unknown>[] }));
              break;
            }

            default:
              toolResult = { status: 'ERROR', message: `Unhandled agent tool: ${call.name}` };
          }

          toolResponseParts.push({
            functionResponse: {
              name: call.name,
              response: toolResult,
            },
          });
        }

        contents.push({ role: 'user', parts: toolResponseParts as unknown[] as Content['parts'] } as unknown as Content);
      }

      if (entitiesToInsertBatch.length > 0 || surfacesToUpsertBatch.length > 0) {
        const { error: txError } = await supabase.rpc('commit_spatial_mutation_tx', {
          p_session_id: sessionId,
          p_entities: entitiesToInsertBatch as unknown as Json,
          p_surfaces: surfacesToUpsertBatch as unknown as Json,
        });

        if (txError) {
          console.error('[Transaction Error RPC]:', txError);
          await writer.write(formatSSE('error', { message: 'Database commit failed', details: txError.message }));
        } else {
          const channel = adminSupabase.channel(`room:${sessionId}:scene`);
          await channel.send({
            type: 'broadcast',
            event: 'scene_committed',
            payload: {
              sessionId,
              version: activeScene.version + 1,
              placedCount: entitiesToInsertBatch.length,
              surfaceCount: surfacesToUpsertBatch.length,
            },
          });
        }
      }

      await writer.write(formatSSE('done', { sessionId, turnComplete: true }));
    } catch (streamError: unknown) {
      const error = streamError as Error;
      console.error('[Streaming Error]:', error);
      await writer.write(formatSSE('error', { message: error.message || 'Stream processing error' }));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
