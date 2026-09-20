import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";

export type Vector3D = [x: number, y: number, z: number];
export type Quaternion = [w: number, x: number, y: number, z: number];
export type Matrix4x4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export interface BoundingBox3D {
  min: Vector3D;
  max: Vector3D;
  center: Vector3D;
  extents: Vector3D; 
}

export interface Transform3D {
  position: Vector3D;
  rotation: Quaternion;
  scale: Vector3D;
  matrixWorld?: Matrix4x4;
}

export type StructuralPlaneType = 
  | 'floor' | 'ceiling' | 'wall' | 'door' 
  | 'window' | 'table' | 'seat' | 'unknown';

export interface SpatialPlaneAnchor {
  id: string;
  semanticType: StructuralPlaneType;
  confidence: number; 
  transform: Transform3D;
  dimensions: [width: number, height: number]; 
  boundaryPolygon: Vector3D[]; 
  isPrimaryFloor?: boolean;
}

export interface EnvironmentalLightProbe {
  ambientIntensityLumens: number;
  colorTemperatureKelvin: number;
  sphericalHarmonicsCoefficients: number[]; 
  dominantDirectionalLight?: {
    direction: Vector3D;
    color: [r: number, g: number, b: number];
    intensityLux: number;
  };
}

export interface PhysicalRoomScanManifest {
  scanId: string;
  userId: string;
  capturedAt: string; 
  clientRuntime: 'VisionOS' | 'WebXR';
  deviceHardware: string;
  rawMeshStorageKey?: string; 
  bounds: BoundingBox3D;
  planes: SpatialPlaneAnchor[];
  lightProbe: EnvironmentalLightProbe;
  semanticOpenings: {
    doors: Array<{ id: string; transform: Transform3D; width: number; height: number }>;
    windows: Array<{ id: string; transform: Transform3D; width: number; height: number }>;
  };
}

export type SurfaceMaterialType = 'pbr_standard' | 'clearcoat' | 'sheen';

export interface PBRMaterialSpecification {
  materialId: string;
  name: string;
  albedoFactor: [r: number, g: number, b: number, a: number];
  roughnessFactor: number;
  metallicFactor: number;
  normalTextureUrl?: string;
  baseColorTextureUrl?: string;
  roughnessMetallicTextureUrl?: string;
  uvScale: [u: number, v: number];
}

export interface SpatialEntityInstance {
  instanceId: string;
  catalogItemId: string;
  sku: string;
  name: string;
  transform: Transform3D;
  boundingBox: BoundingBox3D;
  assetUris: {
    gltf: string;       
    usdz: string;       
  };
  materialOverrides: Record<string, PBRMaterialSpecification>; 
  physics: {
    isStatic: boolean;
    massKg: number;
    collisionLayer: 'furniture' | 'decor' | 'obstacle';
  };
  commerce: {
    retailerId: string;
    unitPrice: number;
    currency: string;
    inStock: boolean;
  };
}

export interface SceneGraphState {
  version: number;
  sessionId: string;
  environmentLighting: {
    overrideEnabled: boolean;
    ambientLightColor: [r: number, g: number, b: number];
    ambientIntensity: number;
    directionalRig: Array<{
      id: string;
      position: Vector3D;
      direction: Vector3D;
      intensity: number;
      castShadows: boolean;
    }>;
  };
  wallSurfaceModifications: Array<{
    planeAnchorId: string;
    material: PBRMaterialSpecification;
  }>;
  floorSurfaceModifications: Array<{
    planeAnchorId: string;
    material: PBRMaterialSpecification;
  }>;
  entities: SpatialEntityInstance[];
}

export function buildPlaceFurnitureItemTool(): FunctionDeclaration {
  return {
    name: "place_furniture_item",
    description: "Places or updates a 3D furniture item in the physical room with precise metric coordinates and orientation.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        sku: {
          type: Type.STRING,
          description: "The unique catalog SKU representing the product."
        },
        itemType: {
          type: Type.STRING,
          description: "Category of item (e.g., 'accent_chair', 'sectional_sofa', 'credenza')."
        },
        position: {
          type: Type.ARRAY,
          description: "World coordinates [x, y, z] in metres. Must rest on floor (y=0 relative).",
          items: { type: Type.NUMBER }
        },
        rotationYDegrees: {
          type: Type.NUMBER,
          description: "Rotation about the vertical Y-axis in degrees (0 to 360)."
        },
        clearanceRadiusMeters: {
          type: Type.NUMBER,
          description: "Required empty radius around the entity to avoid human traffic collisions."
        }
      },
      required: ["sku", "itemType", "position", "rotationYDegrees"]
    }
  };
}

export function buildModifySurfaceMaterialTool(): FunctionDeclaration {
  return {
    name: "modify_surface_material",
    description: "Alters the PBR surface material properties of a detected wall or floor plane anchor.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetPlaneId: {
          type: Type.STRING,
          description: "The unique ID of the detected spatial plane (from the scan manifest)."
        },
        surfaceType: {
          type: Type.STRING,
          description: "Classification of the structural surface (e.g., wall, floor)."
        },
        materialCategory: {
          type: Type.STRING,
          description: "E.g., 'matte_paint', 'hardwood_herringbone', 'travertine_tile', 'exposed_concrete'."
        },
        baseColorHex: {
          type: Type.STRING,
          description: "Primary hex color string, e.g., '#F5F5DC'."
        },
        roughness: {
          type: Type.NUMBER,
          description: "PBR roughness coefficient (0.0 to 1.0)."
        },
        metallic: {
          type: Type.NUMBER,
          description: "PBR metallic coefficient (0.0 to 1.0)."
        }
      },
      required: ["targetPlaneId", "surfaceType", "materialCategory", "baseColorHex"]
    }
  };
}

export function buildQueryCatalogInventoryTool(): FunctionDeclaration {
  return {
    name: "query_catalog_inventory",
    description: "Searches the live retailer catalog database for pieces matching style, size, and price criteria.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        searchQuery: {
          type: Type.STRING,
          description: "Semantic query describing the object (e.g., 'scandinavian oak dining table')."
        },
        maxDimensions: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER },
          description: "Max [width, height, depth] in metres."
        },
        maxPrice: {
          type: Type.NUMBER,
          description: "Budget ceiling in USD."
        }
      },
      required: ["searchQuery"]
    }
  };
}

export function buildSpatialSystemInstruction(scanContext: PhysicalRoomScanManifest): string {
  const floorCount = scanContext.planes.filter(p => p.semanticType === 'floor').length;
  const wallCount = scanContext.planes.filter(p => p.semanticType === 'wall').length;
  
  return `
You are Habitex AI's primary Spatial Architecture and Interior Design Agent.
You have direct spatial understanding of a real-world room with the following properties:
- Room Bounding Dimensions: Width=${scanContext.bounds.extents[0] * 2}m, Height=${scanContext.bounds.extents[1] * 2}m, Depth=${scanContext.bounds.extents[2] * 2}m.
- Detected Floors: ${floorCount}
- Detected Walls: ${wallCount}
- Primary Floor Anchor Reference: Position [0, 0, 0].

SPATIAL CONSTRAINTS:
1. All objects MUST be positioned within the primary room bounds.
2. Furniture items must be placed on the floor plane (Y = 0.00) unless explicitly wall-mounted.
3. Observe functional clearances: Never obstruct doors, windows, or pedestrian paths.
4. When selecting colors and textures, accommodate the room's current lighting profile (Intensity: ${scanContext.lightProbe.ambientIntensityLumens} lm).

You mutate the world strictly by executing designated tools. When the user requests a modification, invoke the corresponding spatial tool with exact metric parameters.
  `.trim();
}

export async function processSpatialConversation(
  aiClient: GoogleGenAI,
  userPrompt: string,
  scanContext: PhysicalRoomScanManifest
) {
  const systemInstruction = buildSpatialSystemInstruction(scanContext);

  const response = await aiClient.models.generateContent({
    model: "gemini-3.7-flash",
    contents: [
      { role: "user", parts: [{ text: userPrompt }] }
    ],
    config: {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools: [{
        functionDeclarations: [
          buildPlaceFurnitureItemTool(),
          buildModifySurfaceMaterialTool(),
          buildQueryCatalogInventoryTool()
        ]
      }],
      temperature: 0.2 
    }
  });

  return response;
}
