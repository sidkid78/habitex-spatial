'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { useSceneStore } from '../store/scene-store';

interface XREstimateData {
  sphericalHarmonicsCoefficients?: number[] | Float32Array;
  primaryLightIntensity?: { x: number; y: number; z: number };
  primaryLightDirection?: { x: number; y: number; z: number };
}

interface XREstimateEvent {
  data: XREstimateData;
}

interface XRLightProbeSource {
  addEventListener(type: string, listener: (e: XREstimateEvent) => void): void;
}

interface ExtendedXRSession {
  preferredReflectionFormat?: string;
  requestLightProbe?: (options?: { reflectionFormat?: string }) => Promise<XRLightProbeSource>;
}

export function useWebXRLighting() {
  const session = useXR((s) => s.session);
  const lightProbeRef = useRef<THREE.LightProbe | null>(null);
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
  const xrLightProbeRequested = useRef(false);

  const lightingState = useSceneStore((s) => s.lighting);

  useFrame(() => {
    if (lightingState.overrideEnabled) {
      if (directionalLightRef.current && lightingState.directionalRig[0]) {
        const rig = lightingState.directionalRig[0];
        directionalLightRef.current.intensity = rig.intensity / 400;
        directionalLightRef.current.position.set(...rig.position);
      }
      return;
    }

    if (session && !xrLightProbeRequested.current) {
      try {
        const extSession = session as unknown as ExtendedXRSession;
        if (typeof extSession.requestLightProbe === 'function') {
          xrLightProbeRequested.current = true;
          extSession
            .requestLightProbe({ reflectionFormat: extSession.preferredReflectionFormat })
            .then((probe) => {
              probe.addEventListener('estimation', (e) => {
                const estimate = e.data;
                if (estimate.sphericalHarmonicsCoefficients && lightProbeRef.current) {
                  lightProbeRef.current.sh.fromArray(estimate.sphericalHarmonicsCoefficients as number[]);
                }
                if (estimate.primaryLightIntensity && estimate.primaryLightDirection && directionalLightRef.current) {
                  const intensity = Math.max(
                    estimate.primaryLightIntensity.x,
                    estimate.primaryLightIntensity.y,
                    estimate.primaryLightIntensity.z
                  );
                  directionalLightRef.current.intensity = intensity;
                  directionalLightRef.current.position.set(
                    estimate.primaryLightDirection.x * 5,
                    estimate.primaryLightDirection.y * 5,
                    estimate.primaryLightDirection.z * 5
                  );
                }
              });
            })
            .catch(() => {
              xrLightProbeRequested.current = true;
            });
        }
      } catch {
        xrLightProbeRequested.current = true;
      }
    }
  });

  return { lightProbeRef, directionalLightRef };
}
