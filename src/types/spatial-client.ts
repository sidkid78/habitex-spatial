export type Vector3Tuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

export interface Transform3D {
  position: Vector3Tuple;
  rotation: QuaternionTuple;
  scale: Vector3Tuple;
}

export interface MetricBoundingBox {
  min: Vector3Tuple;
  max: Vector3Tuple;
  center: Vector3Tuple;
  extents: Vector3Tuple;
}

export interface PBRMaterialDefinition {
  materialId: string;
  name: string;
  albedoHex: string;
  roughnessFactor: number;
  metallicFactor: number;
  normalMapUrl?: string;
  roughnessMapUrl?: string;
  albedoMapUrl?: string;
  uvScale: [number, number];
}

export interface ClientSpatialEntity {
  instanceId: string;
  catalogItemId: string;
  sku: string;
  name: string;
  transform: Transform3D;
  targetTransform?: Transform3D;
  boundingBox: MetricBoundingBox;
  clearanceBufferMeters: number;
  isLocked: boolean;
  lockedBy?: 'user' | 'agent' | 'peer';
  isGhost?: boolean;
  assets: {
    gltfUrl: string;
    usdzUrl?: string;
  };
}

export interface ClientSurfaceModification {
  planeAnchorId: string;
  surfaceType: 'floor' | 'wall' | 'ceiling';
  pbrMaterial: PBRMaterialDefinition;
}

export interface ClientLightSource {
  id: string;
  position: Vector3Tuple;
  direction?: Vector3Tuple;
  intensity: number;
  color: Vector3Tuple;
  castShadows: boolean;
}

export interface ClientEnvironmentLighting {
  overrideEnabled: boolean;
  ambientLightColor: Vector3Tuple;
  ambientIntensity: number;
  directionalRig: ClientLightSource[];
  sphericalHarmonicsCoefficients?: number[];
}

export interface DetectedPlaneAnchor {
  id: string;
  semanticType: 'floor' | 'ceiling' | 'wall' | 'door' | 'window' | 'table' | 'seat' | 'unknown';
  transform: Transform3D;
  dimensions: [number, number];
  boundaryPolygon: Vector3Tuple[];
}
