'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ClientSpatialEntity } from '../../types/spatial-client';
import { assetPipeline } from '../loaders/asset-pipeline';
import { useSceneStore } from '../store/scene-store';

interface EntityRendererProps {
  entity: ClientSpatialEntity;
}

export const EntityRenderer: React.FC<EntityRendererProps> = ({ entity }) => {
  const groupRef = useRef<THREE.Group>(null);
  const targetPosRef = useRef(new THREE.Vector3());
  const targetRotRef = useRef(new THREE.Quaternion());
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [loadError, setLoadError] = useState(false);

  const selectedEntityId = useSceneStore((s) => s.selectedEntityId);
  const selectEntity = useSceneStore((s) => s.selectEntity);
  const isSelected = selectedEntityId === entity.instanceId;

  useEffect(() => {
    let isMounted = true;
    assetPipeline
      .loadGLB(entity.assets.gltfUrl)
      .then((loadedGroup) => {
        if (isMounted) {
          setModel(loadedGroup);
        }
      })
      .catch((err) => {
        console.error(`[EntityRenderer] Model load error for SKU ${entity.sku}:`, err);
        if (isMounted) setLoadError(true);
      });

    return () => {
      isMounted = false;
    };
  }, [entity.assets.gltfUrl, entity.sku]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    if (entity.targetTransform && !entity.isLocked) {
      targetPosRef.current.set(...entity.targetTransform.position);
      targetRotRef.current.set(...entity.targetTransform.rotation);

      groupRef.current.position.lerp(targetPosRef.current, Math.min(1, delta * 14));
      groupRef.current.quaternion.slerp(targetRotRef.current, Math.min(1, delta * 14));
    } else {
      groupRef.current.position.set(...entity.transform.position);
      groupRef.current.quaternion.set(...entity.transform.rotation);
      groupRef.current.scale.set(...entity.transform.scale);
    }
  });

  return (
    <group
      ref={groupRef}
      name={entity.instanceId}
      onClick={(e) => {
        e.stopPropagation();
        if (!entity.isGhost) {
          selectEntity(isSelected ? null : entity.instanceId);
        }
      }}
    >
      {model && <primitive object={model} />}

      {loadError && (
        <mesh position={[0, entity.boundingBox.extents[1], 0]}>
          <boxGeometry
            args={[
              entity.boundingBox.extents[0] * 2,
              entity.boundingBox.extents[1] * 2,
              entity.boundingBox.extents[2] * 2,
            ]}
          />
          {/* Solid, not wireframe. A catalog item with no GLB still has
              real dimensions, and this proxy is what the user sees while
              the asset is missing. Thin red lines vanish against a
              camera passthrough feed — a translucent solid reads as an
              object occupying space, which is the point of placing it. */}
          <meshStandardMaterial
            color="#FF3366"
            transparent
            opacity={0.35}
            roughness={0.6}
            depthWrite={false}
          />
        </mesh>
      )}
      {loadError && (
        // Edges on top of the solid, so the footprint stays readable
        // against a busy background.
        <lineSegments position={[0, entity.boundingBox.extents[1], 0]}>
          <edgesGeometry
            args={[
              new THREE.BoxGeometry(
                entity.boundingBox.extents[0] * 2,
                entity.boundingBox.extents[1] * 2,
                entity.boundingBox.extents[2] * 2
              ),
            ]}
          />
          <lineBasicMaterial color="#FFB3C4" />
        </lineSegments>
      )}

      {entity.isGhost && (
        <mesh position={[0, entity.boundingBox.extents[1], 0]}>
          <boxGeometry
            args={[
              entity.boundingBox.extents[0] * 2,
              entity.boundingBox.extents[1] * 2,
              entity.boundingBox.extents[2] * 2,
            ]}
          />
          <meshBasicMaterial color="#00E5FF" wireframe transparent opacity={0.4} />
        </mesh>
      )}

      {isSelected && (
        <mesh position={[0, entity.boundingBox.extents[1], 0]}>
          <boxGeometry
            args={[
              entity.boundingBox.extents[0] * 2 + 0.04,
              entity.boundingBox.extents[1] * 2 + 0.04,
              entity.boundingBox.extents[2] * 2 + 0.04,
            ]}
          />
          <meshBasicMaterial color="#FFCC00" wireframe />
        </mesh>
      )}
    </group>
  );
};
