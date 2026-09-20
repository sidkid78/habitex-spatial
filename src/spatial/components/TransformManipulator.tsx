'use client';

import React, { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useSceneStore } from '../store/scene-store';
import { useSceneGraphSync } from '../hooks/use-scene-graph-sync';
import type { Transform3D } from '../../types/spatial-client';

interface TransformControlsInstance {
  object?: THREE.Object3D;
}

export const TransformManipulator: React.FC = () => {
  const transformRef = useRef<TransformControlsInstance | null>(null);
  const { scene } = useThree();

  const selectedEntityId = useSceneStore((s) => s.selectedEntityId);
  const sessionId = useSceneStore((s) => s.sessionId);
  const activeGizmoMode = useSceneStore((s) => s.activeGizmoMode);
  const updateEntityTransformOptimistic = useSceneStore((s) => s.updateEntityTransformOptimistic);
  const setEntityLock = useSceneStore((s) => s.setEntityLock);

  const { broadcastLocalTransform, broadcastReleaseTransform } = useSceneGraphSync(sessionId);

  if (!selectedEntityId || activeGizmoMode === 'none') {
    return null;
  }

  const targetObject = scene.getObjectByName(selectedEntityId) || undefined;

  return (
    <TransformControls
      ref={transformRef as unknown as React.Ref<never>}
      object={targetObject}
      mode={activeGizmoMode}
      onMouseDown={() => {
        setEntityLock(selectedEntityId, true, 'user');
      }}
      onChange={() => {
        if (!transformRef.current || !transformRef.current.object) return;
        const obj = transformRef.current.object;

        const currentTransform: Transform3D = {
          position: [obj.position.x, Math.max(0, obj.position.y), obj.position.z],
          rotation: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
          scale: [obj.scale.x, obj.scale.y, obj.scale.z],
        };

        updateEntityTransformOptimistic(selectedEntityId, currentTransform);
        broadcastLocalTransform(selectedEntityId, currentTransform);
      }}
      onMouseUp={() => {
        setEntityLock(selectedEntityId, false);
        broadcastReleaseTransform(selectedEntityId);
      }}
    />
  );
};
