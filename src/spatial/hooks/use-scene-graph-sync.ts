'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useSceneStore } from '../store/scene-store';
import type {
  ClientSpatialEntity,
  ClientSurfaceModification,
  Transform3D,
  PBRMaterialDefinition,
} from '../../types/spatial-client';
import type { Database } from '../../types/supabase';
import { ensureDevSession } from '../../lib/supabase/dev-session';

interface RawSceneEntity {
  id: string;
  catalog_item_id: string;
  position: unknown;
  rotation: unknown;
  scale?: unknown;
}

interface RawSurfaceModification {
  plane_anchor_id: string;
  surface_type: 'floor' | 'wall' | 'ceiling';
  pbr_material: unknown;
}

interface RawDesignSession {
  version: number;
  scene_entities?: RawSceneEntity[];
  surface_modifications?: RawSurfaceModification[];
}

interface PeerTransformPayload {
  instanceId: string;
  transform: Transform3D;
  userId?: string;
}

interface PeerReleasePayload {
  instanceId: string;
}

function parseTuple3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(value) && value.length === 3) {
    return [Number(value[0]), Number(value[1]), Number(value[2])];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length === 3) {
        return [Number(parsed[0]), Number(parsed[1]), Number(parsed[2])];
      }
    } catch {}
  }
  return fallback;
}

function parseTuple4(value: unknown, fallback: [number, number, number, number]): [number, number, number, number] {
  if (Array.isArray(value) && value.length === 4) {
    return [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length === 4) {
        return [Number(parsed[0]), Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
      }
    } catch {}
  }
  return fallback;
}

export function useSceneGraphSync(sessionId: string | null) {
  const supabaseRef = useRef<SupabaseClient<Database> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const reconcileRemoteState = useSceneStore((s) => s.reconcileRemoteState);
  const setEntityTargetTransform = useSceneStore((s) => s.setEntityTargetTransform);
  const setEntityLock = useSceneStore((s) => s.setEntityLock);

  const getSupabaseClient = useCallback((): SupabaseClient<Database> | null => {
    if (!supabaseRef.current) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && key) {
        supabaseRef.current = createBrowserClient<Database>(url, key);
      }
    }
    return supabaseRef.current;
  }, []);

  const fetchAuthoritativeScene = useCallback(async () => {
    if (!sessionId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // RLS returns zero rows to an unauthenticated caller, which reads as
    // an empty error rather than a denial. In development this signs in
    // as the seeded user so the policies behave as they will in
    // production; in production it is a no-op.
    await ensureDevSession(supabase as unknown as SupabaseClient<never>);

    const { data: sessionDataRaw, error } = await supabase
      .from('design_sessions')
      .select(`
        version,
        scene_entities (*),
        surface_modifications (*)
      `)
      .eq('id', sessionId)
      // maybeSingle, not single: .single() answers 0 rows with HTTP 406,
      // which the browser logs as a failed request no matter how the
      // result is handled. A session that is absent or not visible to
      // this user is an ordinary outcome, so ask a question that has a
      // null answer.
      .maybeSingle();

    if (error || !sessionDataRaw) {
      // PGRST116 is "0 rows", which is what .single() reports for a
      // session that does not exist or that this user cannot see. That
      // is an ordinary state — a fresh visitor with no session in the
      // URL — not a failure, and logging it as an error makes an empty
      // app look broken.
      if (error?.code === 'PGRST116' || !error) {
        return;
      }
      console.error('[SceneSync] Error querying authoritative state:', error);
      return;
    }

    const sessionData = sessionDataRaw as unknown as RawDesignSession;

    const entities: ClientSpatialEntity[] = (sessionData.scene_entities || []).map((se) => ({
      instanceId: se.id,
      catalogItemId: se.catalog_item_id,
      sku: se.catalog_item_id,
      name: 'Scene Placed Entity',
      transform: {
        position: parseTuple3(se.position, [0, 0, 0]),
        rotation: parseTuple4(se.rotation, [0, 0, 0, 1]),
        scale: parseTuple3(se.scale, [1, 1, 1]),
      },
      boundingBox: {
        min: [-0.5, 0, -0.5],
        max: [0.5, 1, 0.5],
        center: [0, 0.5, 0],
        extents: [0.5, 0.5, 0.5],
      },
      clearanceBufferMeters: 0.35,
      isLocked: false,
      assets: {
        gltfUrl: `/api/storage/models/${se.catalog_item_id}.glb`,
      },
    }));

    const surfaces: ClientSurfaceModification[] = (sessionData.surface_modifications || []).map((sm) => ({
      planeAnchorId: sm.plane_anchor_id,
      surfaceType: sm.surface_type,
      pbrMaterial: sm.pbr_material as PBRMaterialDefinition,
    }));

    reconcileRemoteState(sessionData.version, entities, surfaces);
  }, [sessionId, getSupabaseClient, reconcileRemoteState]);

  useEffect(() => {
    if (!sessionId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    void fetchAuthoritativeScene();

    const channel = supabase.channel(`room:${sessionId}:scene`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'scene_committed' }, () => {
        void fetchAuthoritativeScene();
      })
      .on('broadcast', { event: 'entity_transform_peer' }, ({ payload }) => {
        const p = payload as PeerTransformPayload;
        if (p?.instanceId && p.transform) {
          setEntityLock(p.instanceId, true, 'peer');
          setEntityTargetTransform(p.instanceId, p.transform);
        }
      })
      .on('broadcast', { event: 'entity_transform_released' }, ({ payload }) => {
        const p = payload as PeerReleasePayload;
        if (p?.instanceId) {
          setEntityLock(p.instanceId, false);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[SceneSync] Connected to spatial channel: room:${sessionId}:scene`);
        }
      });

    channelRef.current = channel;

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, getSupabaseClient, fetchAuthoritativeScene, setEntityTargetTransform, setEntityLock]);

  const broadcastLocalTransform = useCallback((instanceId: string, transform: Transform3D) => {
    if (channelRef.current) {
      void channelRef.current.send({
        type: 'broadcast',
        event: 'entity_transform_peer',
        payload: { instanceId, transform },
      });
    }
  }, []);

  const broadcastReleaseTransform = useCallback((instanceId: string) => {
    if (channelRef.current) {
      void channelRef.current.send({
        type: 'broadcast',
        event: 'entity_transform_released',
        payload: { instanceId },
      });
    }
  }, []);

  return { broadcastLocalTransform, broadcastReleaseTransform, refreshScene: fetchAuthoritativeScene };
}
