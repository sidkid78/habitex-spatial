'use client';

import React, { useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import type { DetectedPlaneAnchor, ClientSurfaceModification } from '../../types/spatial-client';
import { assetPipeline } from '../loaders/asset-pipeline';

interface SurfacePlaneMeshProps {
  plane: DetectedPlaneAnchor;
  modification?: ClientSurfaceModification;
}

export const SurfacePlaneMesh: React.FC<SurfacePlaneMeshProps> = ({ plane, modification }) => {
  const [albedoMap, setAlbedoMap] = useState<THREE.Texture | null>(null);

  const uvScale = useMemo<[number, number]>(() => {
    return modification?.pbrMaterial.uvScale || [plane.dimensions[0], plane.dimensions[1]];
  }, [modification, plane.dimensions]);

  useEffect(() => {
    let active = true;
    if (modification?.pbrMaterial.albedoMapUrl) {
      assetPipeline.loadPBRTexture(modification.pbrMaterial.albedoMapUrl, uvScale).then((tex) => {
        if (active) setAlbedoMap(tex);
      });
    } else {
      setAlbedoMap(null);
    }
    return () => {
      active = false;
    };
  }, [modification, uvScale]);

  const geometry = useMemo(() => {
    if (plane.boundaryPolygon && plane.boundaryPolygon.length >= 3) {
      const shape = new THREE.Shape();
      shape.moveTo(plane.boundaryPolygon[0][0], plane.boundaryPolygon[0][2]);
      for (let i = 1; i < plane.boundaryPolygon.length; i++) {
        shape.lineTo(plane.boundaryPolygon[i][0], plane.boundaryPolygon[i][2]);
      }
      shape.closePath();
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(Math.PI / 2);
      return geom;
    }
    return new THREE.PlaneGeometry(plane.dimensions[0], plane.dimensions[1]);
  }, [plane]);

  const pbr = modification?.pbrMaterial;

  return (
    <mesh
      position={plane.transform.position}
      quaternion={plane.transform.rotation}
      scale={plane.transform.scale}
      geometry={geometry}
      receiveShadow
    >
      <meshStandardMaterial
        color={pbr?.albedoHex || (plane.semanticType === 'floor' ? '#2A2A2E' : '#E0E0E0')}
        map={albedoMap ?? undefined}
        roughness={pbr?.roughnessFactor ?? 0.8}
        metalness={pbr?.metallicFactor ?? 0.05}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};
