export type Vector3D = [x: number, y: number, z: number];
export type Quaternion = [w: number, x: number, y: number, z: number];
export type Matrix3x3 = [
  number, number, number,
  number, number, number,
  number, number, number
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
}

export interface OrientedBoundingBox {
  center: Vector3D;
  extents: Vector3D;
  axes: [Vector3D, Vector3D, Vector3D];
}

export type StructuralPlaneType = 
  | 'floor'
  | 'ceiling'
  | 'wall'
  | 'door'
  | 'window'
  | 'table'
  | 'seat'
  | 'unknown';

export interface SpatialPlaneAnchor {
  id: string;
  semanticType: StructuralPlaneType;
  confidence: number;
  transform: Transform3D;
  dimensions: [width: number, height: number];
  boundaryPolygon: Vector3D[];
  normal?: Vector3D;
  isPrimaryFloor?: boolean;
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
  lightProbe: {
    ambientIntensityLumens: number;
    colorTemperatureKelvin: number;
    sphericalHarmonicsCoefficients: number[];
  };
}

export interface SpatialEntityInstance {
  instanceId: string;
  catalogItemId: string;
  sku: string;
  name: string;
  transform: Transform3D;
  boundingBox: BoundingBox3D;
  clearanceBufferMeters: number;
  isWallMounted?: boolean;
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
    pbrMaterial: {
      albedoHex: string;
      roughness: number;
      metallic: number;
      materialCategory: string;
    };
  }>;
  entities: SpatialEntityInstance[];
}

export interface SpatialValidationResult {
  valid: boolean;
  code: 'OK' | 'OUT_OF_BOUNDS' | 'COLLISION_DETECTED' | 'CLEARANCE_VIOLATION' | 'UNSUPPORTED_PLANE' | 'ORIENTATION_MISMATCH';
  message: string;
  culpritEntityId?: string;
  suggestedCorrection?: {
    position?: Vector3D;
    rotation?: Quaternion;
  };
}
