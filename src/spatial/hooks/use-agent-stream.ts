'use client';

import { useState, useCallback } from 'react';
import { useSceneStore } from '../store/scene-store';
import type {
  ClientSpatialEntity,
  ClientEnvironmentLighting,
  PBRMaterialDefinition,
  Transform3D,
  MetricBoundingBox,
} from '../../types/spatial-client';

interface AgentStreamEntityPayload {
  instanceId: string;
  catalogItemId: string;
  sku: string;
  name: string;
  transform: Transform3D;
  boundingBox: MetricBoundingBox;
  clearanceBufferMeters: number;
}

interface AgentStreamAssetsPayload {
  gltf: string;
  usdz?: string;
}

interface StreamPayload {
  message?: string;
  status?: string;
  sku?: string;
  action?: 'ENTITY_ADDED' | 'LIGHTING_CHANGED' | 'SURFACE_MODIFIED';
  entity?: AgentStreamEntityPayload;
  assets?: AgentStreamAssetsPayload;
  lighting?: Partial<ClientEnvironmentLighting>;
  planeAnchorId?: string;
  pbrMaterial?: PBRMaterialDefinition;
  text?: string;
}

export function useAgentSpatialStream(sessionId: string | null) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamCommentary, setStreamCommentary] = useState<string>('');

  const stageGhostEntity = useSceneStore((s) => s.stageGhostEntity);
  const commitGhostEntity = useSceneStore((s) => s.commitGhostEntity);
  const updateLighting = useSceneStore((s) => s.updateLighting);
  const applySurfaceModification = useSceneStore((s) => s.applySurfaceModification);
  const setAgentReasoning = useSceneStore((s) => s.setAgentReasoning);

  const sendAgentMessage = useCallback(
    async (userMessage: string, conversationHistory: unknown[] = []) => {
      if (!sessionId || !userMessage.trim()) return;

      setIsStreaming(true);
      setAgentReasoning(true, 'Initializing spatial reasoning...');
      setStreamCommentary('');

      try {
        const response = await fetch('/api/agent/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            userMessage,
            conversationHistory,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Failed to initialize stream: HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const rawEvent of events) {
            if (!rawEvent.trim()) continue;

            const lines = rawEvent.split('\n');
            let eventType = '';
            let dataStr = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
              } else if (line.startsWith('data: ')) {
                dataStr = line.substring(6).trim();
              }
            }

            if (!eventType || !dataStr) continue;
            const payload = JSON.parse(dataStr) as StreamPayload;

            switch (eventType) {
              case 'thought':
                setAgentReasoning(true, payload.message || null);
                break;

              case 'guardrail_check':
                if (payload.status === 'PASSED') {
                  setAgentReasoning(true, `Verified placement guardrails for ${payload.sku || 'entity'}`);
                } else {
                  setAgentReasoning(true, `Collision detected. Repositioning ${payload.sku || 'entity'}...`);
                }
                break;

              case 'scene_mutation':
                if (payload.action === 'ENTITY_ADDED' && payload.entity) {
                  const newEntity: ClientSpatialEntity = {
                    instanceId: payload.entity.instanceId,
                    catalogItemId: payload.entity.catalogItemId,
                    sku: payload.entity.sku,
                    name: payload.entity.name,
                    transform: payload.entity.transform,
                    boundingBox: payload.entity.boundingBox,
                    clearanceBufferMeters: payload.entity.clearanceBufferMeters,
                    isLocked: true,
                    isGhost: true,
                    assets: {
                      gltfUrl: payload.assets?.gltf || '',
                      usdzUrl: payload.assets?.usdz,
                    },
                  };
                  stageGhostEntity(newEntity);
                } else if (payload.action === 'LIGHTING_CHANGED' && payload.lighting) {
                  updateLighting(payload.lighting);
                } else if (payload.action === 'SURFACE_MODIFIED' && payload.planeAnchorId && payload.pbrMaterial) {
                  applySurfaceModification({
                    planeAnchorId: payload.planeAnchorId,
                    surfaceType: 'wall',
                    pbrMaterial: payload.pbrMaterial,
                  });
                }
                break;

              case 'commentary':
                if (payload.text) {
                  setStreamCommentary((prev) => prev + payload.text);
                }
                break;

              case 'done':
                useSceneStore.getState().entities.forEach((ent) => {
                  if (ent.isGhost) {
                    commitGhostEntity(ent.instanceId);
                  }
                });
                setAgentReasoning(false, null);
                break;

              case 'error':
                console.error('[Agent Stream Error Server Payload]:', payload);
                setAgentReasoning(false, null);
                break;
            }
          }
        }
      } catch (err) {
        console.error('[Agent Stream Consumer Fatal]:', err);
        setAgentReasoning(false, null);
      } finally {
        setIsStreaming(false);
      }
    },
    [sessionId, stageGhostEntity, commitGhostEntity, updateLighting, applySurfaceModification, setAgentReasoning]
  );

  return { sendAgentMessage, isStreaming, streamCommentary };
}
