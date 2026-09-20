'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXR } from '@react-three/xr';
import * as THREE from 'three';
import { useSceneStore } from '../store/scene-store';
import { useWebXRLighting } from '../hooks/use-webxr-lighting';
import { SurfacePlaneMesh } from './SurfacePlaneMesh';
import { EntityRenderer } from './EntityRenderer';
import { TransformManipulator } from './TransformManipulator';
import { assetPipeline } from '../loaders/asset-pipeline';

function SpatialSceneContainer() {
  const planes = useSceneStore((s) => Array.from(s.planes.values()));
  const entities = useSceneStore((s) => Array.from(s.entities.values()));
  const surfaceModifications = useSceneStore((s) => s.surfaceModifications);
  const lighting = useSceneStore((s) => s.lighting);
  const setXRActive = useSceneStore((s) => s.setXRActive);

  const session = useXR((s) => s.session);

  useEffect(() => {
    setXRActive(session != null);
  }, [session, setXRActive]);

  const { lightProbeRef, directionalLightRef } = useWebXRLighting();

  return (
    <>
      <lightProbe ref={lightProbeRef as unknown as React.Ref<THREE.LightProbe>} />
      <ambientLight
        color={new THREE.Color(...lighting.ambientLightColor)}
        intensity={lighting.ambientIntensity / 1000}
      />
      <directionalLight
        ref={directionalLightRef as unknown as React.Ref<THREE.DirectionalLight>}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0001}
      />

      {planes.map((plane) => (
        <SurfacePlaneMesh
          key={plane.id}
          plane={plane}
          modification={surfaceModifications.get(plane.id)}
        />
      ))}

      {entities.map((entity) => (
        <EntityRenderer key={entity.instanceId} entity={entity} />
      ))}

      <TransformManipulator />
    </>
  );
}

interface SpatialCanvasProps {
  sessionId: string;
}

export const SpatialCanvas: React.FC<SpatialCanvasProps> = ({ sessionId }) => {
  const setClientRuntime = useSceneStore((s) => s.setClientRuntime);
  const [xrStore] = useState(() => createXRStore());

  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof document !== 'undefined') {
      const isVisionOS = navigator.userAgent.includes('Macintosh') && 'ontouchend' in document;
      if (isVisionOS) {
        setClientRuntime('VisionOS');
      }
    }
  }, [setClientRuntime]);

  return (
    <div className="relative w-full h-full min-h-screen bg-neutral-950 overflow-hidden select-none">
      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <button
          type="button"
          onClick={() => {
            xrStore.enterAR().catch((err: unknown) => {
              console.warn('[SpatialCanvas] Failed to enter AR session:', err);
            });
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow-lg cursor-pointer"
        >
          Enter AR
        </button>
      </div>

      <Canvas
        shadows
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        camera={{ position: [0, 1.6, 2], fov: 65 }}
        onCreated={({ gl }) => {
          assetPipeline.initKTX2(gl);
        }}
      >
        <XR store={xrStore}>
          <Suspense fallback={null}>
            <SpatialSceneContainer />
          </Suspense>
        </XR>
      </Canvas>
    </div>
  );
};

export default SpatialCanvas;
