import { create } from 'zustand';
import type {
  ClientSpatialEntity,
  ClientSurfaceModification,
  ClientEnvironmentLighting,
  DetectedPlaneAnchor,
  Transform3D,
} from '../../types/spatial-client';

export interface SceneState {
  sessionId: string | null;
  version: number;
  clientRuntime: 'WebXR' | 'VisionOS' | 'Desktop';
  isXRActive: boolean;
  selectedEntityId: string | null;
  planes: Map<string, DetectedPlaneAnchor>;
  entities: Map<string, ClientSpatialEntity>;
  surfaceModifications: Map<string, ClientSurfaceModification>;
  lighting: ClientEnvironmentLighting;

  activeGizmoMode: 'translate' | 'rotate' | 'none';
  agentIsReasoning: boolean;
  activeTurnCommentary: string | null;

  initializeSession: (
    sessionId: string,
    planes: DetectedPlaneAnchor[],
    initialLighting?: ClientEnvironmentLighting
  ) => void;
  setClientRuntime: (runtime: 'WebXR' | 'VisionOS' | 'Desktop') => void;
  setXRActive: (active: boolean) => void;
  selectEntity: (id: string | null) => void;
  setGizmoMode: (mode: 'translate' | 'rotate' | 'none') => void;

  upsertEntity: (entity: ClientSpatialEntity) => void;
  stageGhostEntity: (entity: ClientSpatialEntity) => void;
  commitGhostEntity: (instanceId: string) => void;
  removeEntity: (instanceId: string) => void;
  updateEntityTransformOptimistic: (instanceId: string, transform: Partial<Transform3D>) => void;
  setEntityTargetTransform: (instanceId: string, transform: Transform3D) => void;
  setEntityLock: (instanceId: string, locked: boolean, lockedBy?: 'user' | 'agent' | 'peer') => void;

  applySurfaceModification: (mod: ClientSurfaceModification) => void;
  updateLighting: (lighting: Partial<ClientEnvironmentLighting>) => void;

  setAgentReasoning: (isReasoning: boolean, commentary?: string | null) => void;
  reconcileRemoteState: (
    version: number,
    entities: ClientSpatialEntity[],
    surfaces: ClientSurfaceModification[]
  ) => void;
}

export const useSceneStore = create<SceneState>()((set) => ({
  sessionId: null,
  version: 1,
  clientRuntime: 'WebXR',
  isXRActive: false,
  selectedEntityId: null,
  planes: new Map<string, DetectedPlaneAnchor>(),
  entities: new Map<string, ClientSpatialEntity>(),
  surfaceModifications: new Map<string, ClientSurfaceModification>(),
  lighting: {
    overrideEnabled: false,
    ambientLightColor: [1.0, 1.0, 1.0],
    ambientIntensity: 800,
    directionalRig: [],
  },
  activeGizmoMode: 'none',
  agentIsReasoning: false,
  activeTurnCommentary: null,

  initializeSession: (sessionId, planesArray, initialLighting) => {
    const planesMap = new Map<string, DetectedPlaneAnchor>();
    planesArray.forEach((p) => planesMap.set(p.id, p));
    set((state) => ({
      sessionId,
      planes: planesMap,
      lighting: initialLighting ? initialLighting : state.lighting,
    }));
  },

  setClientRuntime: (runtime) => {
    set({ clientRuntime: runtime });
  },

  setXRActive: (active) => {
    set({ isXRActive: active });
  },

  selectEntity: (id) => {
    set({ selectedEntityId: id });
  },

  setGizmoMode: (mode) => {
    set({ activeGizmoMode: mode });
  },

  upsertEntity: (entity) => {
    set((state) => {
      const next = new Map(state.entities);
      next.set(entity.instanceId, entity);
      return { entities: next };
    });
  },

  stageGhostEntity: (entity) => {
    set((state) => {
      const next = new Map(state.entities);
      next.set(entity.instanceId, {
        ...entity,
        isGhost: true,
        isLocked: true,
        lockedBy: 'agent',
      });
      return { entities: next };
    });
  },

  commitGhostEntity: (instanceId) => {
    set((state) => {
      const ent = state.entities.get(instanceId);
      if (!ent) return state;
      const next = new Map(state.entities);
      next.set(instanceId, {
        ...ent,
        isGhost: false,
        isLocked: false,
        lockedBy: undefined,
      });
      return { entities: next };
    });
  },

  removeEntity: (instanceId) => {
    set((state) => {
      const next = new Map(state.entities);
      next.delete(instanceId);
      return {
        entities: next,
        selectedEntityId: state.selectedEntityId === instanceId ? null : state.selectedEntityId,
      };
    });
  },

  updateEntityTransformOptimistic: (instanceId, partialTransform) => {
    set((state) => {
      const ent = state.entities.get(instanceId);
      if (!ent) return state;
      const next = new Map(state.entities);
      next.set(instanceId, {
        ...ent,
        transform: {
          position: partialTransform.position ?? ent.transform.position,
          rotation: partialTransform.rotation ?? ent.transform.rotation,
          scale: partialTransform.scale ?? ent.transform.scale,
        },
      });
      return { entities: next };
    });
  },

  setEntityTargetTransform: (instanceId, targetTransform) => {
    set((state) => {
      const ent = state.entities.get(instanceId);
      if (!ent) return state;
      const next = new Map(state.entities);
      next.set(instanceId, {
        ...ent,
        targetTransform,
      });
      return { entities: next };
    });
  },

  setEntityLock: (instanceId, locked, lockedBy) => {
    set((state) => {
      const ent = state.entities.get(instanceId);
      if (!ent) return state;
      const next = new Map(state.entities);
      next.set(instanceId, {
        ...ent,
        isLocked: locked,
        lockedBy,
      });
      return { entities: next };
    });
  },

  applySurfaceModification: (mod) => {
    set((state) => {
      const next = new Map(state.surfaceModifications);
      next.set(mod.planeAnchorId, mod);
      return { surfaceModifications: next };
    });
  },

  updateLighting: (partialLighting) => {
    set((state) => ({
      lighting: {
        ...state.lighting,
        ...partialLighting,
      },
    }));
  },

  setAgentReasoning: (isReasoning, commentary = null) => {
    set({
      agentIsReasoning: isReasoning,
      activeTurnCommentary: commentary,
    });
  },

  reconcileRemoteState: (version, remoteEntities, remoteSurfaces) => {
    set((state) => {
      if (version < state.version) return state;

      const nextEntities = new Map<string, ClientSpatialEntity>();

      for (const [id, entity] of state.entities.entries()) {
        if (!entity.isGhost || remoteEntities.some((r) => r.instanceId === id)) {
          nextEntities.set(id, entity);
        }
      }

      remoteEntities.forEach((remoteEnt) => {
        const local = nextEntities.get(remoteEnt.instanceId);
        if (!local) {
          nextEntities.set(remoteEnt.instanceId, remoteEnt);
        } else if (local.isLocked && local.lockedBy === 'user') {
          nextEntities.set(remoteEnt.instanceId, {
            ...local,
            catalogItemId: remoteEnt.catalogItemId,
            sku: remoteEnt.sku,
            name: remoteEnt.name,
          });
        } else {
          nextEntities.set(remoteEnt.instanceId, {
            ...local,
            targetTransform: remoteEnt.transform,
            boundingBox: remoteEnt.boundingBox,
            clearanceBufferMeters: remoteEnt.clearanceBufferMeters,
            isGhost: false,
          });
        }
      });

      const nextSurfaces = new Map(state.surfaceModifications);
      remoteSurfaces.forEach((surf) => {
        nextSurfaces.set(surf.planeAnchorId, surf);
      });

      return {
        version,
        entities: nextEntities,
        surfaceModifications: nextSurfaces,
      };
    });
  },
}));
