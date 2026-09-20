'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { XR, createXRStore, useXR } from '@react-three/xr';
import * as THREE from 'three';
import { useSceneStore } from '../store/scene-store';
import { useWebXRLighting } from '../hooks/use-webxr-lighting';
import { useAgentSpatialStream } from '../hooks/use-agent-stream';
import { useSpatialSceneSync } from '../../hooks/useSpatialSceneSync';
import { SurfacePlaneMesh } from './SurfacePlaneMesh';
import { EntityRenderer } from './EntityRenderer';
import { TransformManipulator } from './TransformManipulator';
import { assetPipeline } from '../loaders/asset-pipeline';

interface SpatialSceneContainerProps {
  sessionId: string;
}

function SpatialSceneContainer({ sessionId }: SpatialSceneContainerProps) {
  const { scene } = useThree();
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

  // Consume real-time spatial mutations broadcast by /api/spatial/mutate
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  useSpatialSceneSync({
    sessionId,
    threeScene: scene,
    supabaseUrl,
    supabaseAnonKey,
  });

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
  const activeGizmoMode = useSceneStore((s) => s.activeGizmoMode);
  const setGizmoMode = useSceneStore((s) => s.setGizmoMode);
  const selectedEntityId = useSceneStore((s) => s.selectedEntityId);
  const agentIsReasoning = useSceneStore((s) => s.agentIsReasoning);
  const activeTurnCommentary = useSceneStore((s) => s.activeTurnCommentary);

  const [xrStore] = useState(() => createXRStore());
  const [promptInput, setPromptInput] = useState('');

  // Connect useAgentSpatialStream for real-time design turn streaming from /api/agent/stream
  const { sendAgentMessage, isStreaming, streamCommentary } = useAgentSpatialStream(sessionId);

  // Sync active sessionId to scene store for TransformManipulator & multi-client sync
  useEffect(() => {
    if (sessionId) {
      useSceneStore.setState({ sessionId });
    }
  }, [sessionId]);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof document !== 'undefined') {
      const isVisionOS = navigator.userAgent.includes('Macintosh') && 'ontouchend' in document;
      if (isVisionOS) {
        setClientRuntime('VisionOS');
      }
    }
  }, [setClientRuntime]);

  const handleSendPrompt = useCallback(
    async (textToSend?: string) => {
      const msg = (textToSend ?? promptInput).trim();
      if (!msg || isStreaming) return;
      setPromptInput('');
      await sendAgentMessage(msg);
    },
    [promptInput, isStreaming, sendAgentMessage]
  );

  return (
    <div className="relative w-full h-full min-h-screen bg-neutral-950 overflow-hidden select-none">
      {/* Top Header Overlay */}
      <header className="absolute top-4 left-4 z-50 flex flex-col gap-1 pointer-events-auto">
        <div className="flex items-center gap-2 bg-neutral-900/80 backdrop-blur-md border border-neutral-800 px-3.5 py-1.5 rounded-full text-xs text-neutral-200 shadow-xl">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-neutral-100">Habitex Spatial Studio</span>
          <span className="text-neutral-500">|</span>
          <span className="font-mono text-neutral-400">
            {sessionId.length > 12 ? `${sessionId.slice(0, 8)}...` : sessionId}
          </span>
        </div>
      </header>

      {/* Top Right AR Control */}
      <div className="absolute top-4 right-4 z-50 flex gap-2">
        <button
          type="button"
          onClick={() => {
            xrStore.enterAR().catch((err: unknown) => {
              console.warn('[SpatialCanvas] Failed to enter AR session:', err);
            });
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold uppercase tracking-wider rounded-lg shadow-lg cursor-pointer transition-all active:scale-95"
        >
          Enter AR
        </button>
      </div>

      {/* Bottom Floating Agent HUD */}
      <aside className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-2xl flex flex-col gap-2 pointer-events-auto">
        {/* Gizmo Controls when an entity is selected */}
        {selectedEntityId && (
          <div className="self-center flex items-center gap-1.5 bg-neutral-900/90 backdrop-blur-md border border-neutral-700/60 p-1 rounded-lg shadow-2xl text-xs">
            <span className="px-2 text-neutral-400 font-mono">Gizmo:</span>
            <button
              type="button"
              onClick={() => setGizmoMode('translate')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                activeGizmoMode === 'translate'
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              Translate
            </button>
            <button
              type="button"
              onClick={() => setGizmoMode('rotate')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                activeGizmoMode === 'rotate'
                  ? 'bg-blue-600 text-white'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              Rotate
            </button>
            <button
              type="button"
              onClick={() => setGizmoMode('none')}
              className={`px-3 py-1 rounded font-medium transition-colors ${
                activeGizmoMode === 'none'
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-300 hover:bg-neutral-800'
              }`}
            >
              Deselect
            </button>
          </div>
        )}

        {/* Live Reasoning / Streaming Commentary Banner */}
        {(agentIsReasoning || isStreaming || streamCommentary || activeTurnCommentary) && (
          <div className="bg-neutral-900/90 backdrop-blur-md border border-neutral-800 p-3 rounded-xl shadow-2xl text-xs text-neutral-300 flex items-start gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping mt-1 shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="font-semibold text-neutral-200">
                {isStreaming || agentIsReasoning ? 'Habitex AI Reasoning...' : 'Spatial Agent'}
              </div>
              <p className="text-neutral-300 leading-relaxed font-sans">
                {streamCommentary || activeTurnCommentary || 'Evaluating room boundaries and placement guardrails...'}
              </p>
            </div>
          </div>
        )}

        {/* Interactive Prompt Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendPrompt();
          }}
          className="flex items-center gap-2 bg-neutral-900/95 backdrop-blur-xl border border-neutral-800/80 p-2 rounded-2xl shadow-2xl"
        >
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            disabled={isStreaming}
            placeholder="Command spatial agent (e.g. 'Place lounge chair near west wall')..."
            className="flex-1 bg-transparent px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isStreaming || !promptInput.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-xs font-semibold rounded-xl shadow transition-all cursor-pointer disabled:cursor-not-allowed"
          >
            {isStreaming ? 'Streaming...' : 'Send'}
          </button>
        </form>

        {/* Suggested Quick Commands */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-[11px] text-neutral-400">
          <span className="shrink-0 text-neutral-500">Suggestions:</span>
          <button
            type="button"
            onClick={() => void handleSendPrompt('Place modern accent chair')}
            disabled={isStreaming}
            className="shrink-0 px-2.5 py-1 bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800/80 rounded-lg text-neutral-300 transition-colors cursor-pointer"
          >
            Place Accent Chair
          </button>
          <button
            type="button"
            onClick={() => void handleSendPrompt('Adjust lighting to warm 2700K')}
            disabled={isStreaming}
            className="shrink-0 px-2.5 py-1 bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800/80 rounded-lg text-neutral-300 transition-colors cursor-pointer"
          >
            Warm 2700K Lighting
          </button>
          <button
            type="button"
            onClick={() => void handleSendPrompt('Apply walnut wood finish to wall')}
            disabled={isStreaming}
            className="shrink-0 px-2.5 py-1 bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800/80 rounded-lg text-neutral-300 transition-colors cursor-pointer"
          >
            Walnut Finish
          </button>
        </div>
      </aside>

      {/* 3D WebGL / WebXR Scene Canvas */}
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
            <SpatialSceneContainer sessionId={sessionId} />
          </Suspense>
        </XR>
      </Canvas>
    </div>
  );
};

export default SpatialCanvas;
