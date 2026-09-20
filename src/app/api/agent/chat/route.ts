import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { HabitexSpatialEngine } from '../../../../agent/engine';
import { PhysicalRoomScanManifest, SceneGraphState, Vector3D, Quaternion } from '../../../../types/spatial';

export const runtime = 'nodejs';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase configuration');
  }
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, userMessage, history } = await req.json();

    const supabase = getSupabaseClient();

    const { data: session } = await supabase
      .from('design_sessions')
      .select('*, room_scans(*), scene_entities(*), surface_modifications(*)')
      .eq('id', sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const scanManifest: PhysicalRoomScanManifest = {
      scanId: session.room_scans.id,
      userId: session.user_id,
      capturedAt: session.room_scans.created_at,
      clientRuntime: session.room_scans.client_runtime,
      deviceHardware: 'Apple Vision Pro',
      bounds: session.room_scans.bounding_box,
      planes: session.room_scans.planes,
      lightProbe: session.room_scans.light_probe
    };

    const currentScene: SceneGraphState = {
      version: session.version,
      sessionId: session.id,
      environmentLighting: {
        overrideEnabled: false,
        ambientLightColor: [1, 1, 1],
        ambientIntensity: scanManifest.lightProbe.ambientIntensityLumens,
        directionalRig: []
      },
      wallSurfaceModifications: (session.surface_modifications || []).map((sm: Record<string, unknown>) => ({
        planeAnchorId: sm.plane_anchor_id as string,
        pbrMaterial: sm.pbr_material as {
          albedoHex: string;
          roughness: number;
          metallic: number;
          materialCategory: string;
        }
      })),
      entities: (session.scene_entities || []).map((se: Record<string, unknown>) => ({
        instanceId: se.id as string,
        catalogItemId: se.catalog_item_id as string,
        sku: se.sku as string,
        name: se.name as string,
        transform: {
          position: se.position as Vector3D,
          rotation: se.rotation as Quaternion,
          scale: se.scale as Vector3D
        },
        boundingBox: se.bounding_box as { min: Vector3D; max: Vector3D; center: Vector3D; extents: Vector3D },
        clearanceBufferMeters: 0.35,
        isWallMounted: false
      }))
    };

    const engine = new HabitexSpatialEngine({
      findCatalogItemBySku: async (sku: string) => {
        const { data } = await supabase
          .from('spatial_catalog_items')
          .select('*')
          .eq('sku', sku)
          .single();
        if (!data) return null;
        return {
          sku: data.sku,
          name: data.name,
          category: data.category,
          dimensionsMetric: data.dimensions_metric,
          priceCents: data.price_cents,
          currency: data.currency,
          inStock: data.in_stock,
          leadTimeDays: 5,
          gltfUrl: data.gltf_storage_path,
          usdzUrl: data.usdz_storage_path
        };
      },
      searchCatalog: async (query: string, maxDim?: Vector3D, maxPrice?: number) => {
        let q = supabase.from('spatial_catalog_items').select('*').ilike('name', `%${query}%`);
        if (maxPrice) q = q.lte('price_cents', maxPrice * 100);
        const { data } = await q.limit(5);
        return (data || []).map((d: Record<string, unknown>) => ({
          sku: d.sku as string,
          name: d.name as string,
          category: d.category as string,
          dimensionsMetric: d.dimensions_metric as Vector3D,
          priceCents: d.price_cents as number,
          currency: d.currency as string,
          inStock: d.in_stock as boolean,
          leadTimeDays: 7,
          gltfUrl: d.gltf_storage_path as string,
          usdzUrl: d.usdz_storage_path as string
        }));
      },
      compareRetailers: async (sku: string) => [
        { retailer: 'Habitex Direct', priceUsd: 1299, inStock: true, leadDays: 3 },
        { retailer: 'Partner Design Studio', priceUsd: 1350, inStock: true, leadDays: 7 }
      ],
      commitPurchaseReservation: async (items: Array<{ sku: string; quantity: number }>) => ({
        reservationId: `res_${Date.now()}`,
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
        totalUsd: 1299
      })
    });

    const outcome = await engine.processDesignTurn(userMessage, scanManifest, currentScene, history);

    if (outcome.executedToolCalls.some(t => (t.result as Record<string, unknown>)?.status === 'SUCCESS')) {
      await supabase
        .from('design_sessions')
        .update({ version: outcome.updatedScene.version, updated_at: new Date().toISOString() })
        .eq('id', sessionId);

      const channel = supabase.channel(`room:${sessionId}:scene`);
      await channel.send({
        type: 'broadcast',
        event: 'scene_mutated',
        payload: {
          scene: outcome.updatedScene,
          toolDeltas: outcome.executedToolCalls
        }
      });
    }

    return NextResponse.json({
      agentReply: outcome.agentReply,
      scene: outcome.updatedScene,
      history: outcome.history,
      mutations: outcome.executedToolCalls
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal error processing turn";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
