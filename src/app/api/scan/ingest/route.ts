import { NextRequest, NextResponse } from 'next/server';
import { resolveActor } from '../../../../lib/supabase/dev-auth';
import { GoogleGenAI, type Content } from '@google/genai';
import { createClientFromRequest, createAdminClient } from '../../../../lib/supabase/server';
import type { Database, Json } from '../../../../types/supabase';
import { Buffer } from 'node:buffer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PlanePayload {
  id: string;
  semanticType: 'floor' | 'ceiling' | 'wall' | 'door' | 'window' | 'table' | 'seat' | 'unknown';
  confidence: number;
  transform: {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  };
  dimensions: [number, number];
  boundaryPolygon: Array<[number, number, number]>;
  isPrimaryFloor?: boolean;
}

interface IngestPayload {
  clientRuntime: 'VisionOS' | 'WebXR';
  deviceHardware: string;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    extents: [number, number, number];
  };
  planes: PlanePayload[];
  lightProbe: {
    ambientIntensityLumens: number;
    colorTemperatureKelvin: number;
    sphericalHarmonicsCoefficients: number[];
  };
  semanticOpenings?: {
    doors: Array<{ id: string; transform: unknown; width: number; height: number }>;
    windows: Array<{ id: string; transform: unknown; width: number; height: number }>;
  };
  sessionName?: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClientFromRequest();
    // Falls back to a seeded user in development only — see
    // lib/supabase/dev-auth. In production this is exactly
    // auth.getUser() and nothing else.
    const actor = await resolveActor(supabase);
    
    if (!actor) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required for room scan ingestion.' },
        { status: 401 }
      );
    }

    const adminClient = createAdminClient();
    const contentType = req.headers.get('content-type') || '';

    let payload: IngestPayload;
    let meshBuffer: Buffer | null = null;
    let meshFileName: string | null = null;
    let previewImageBuffer: Buffer | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const manifestRaw = formData.get('manifest');
      if (!manifestRaw || typeof manifestRaw !== 'string') {
        return NextResponse.json({ error: 'Missing manifest JSON in multipart payload' }, { status: 400 });
      }

      payload = JSON.parse(manifestRaw) as IngestPayload;

      const meshFile = formData.get('mesh') as File | null;
      if (meshFile) {
        meshBuffer = Buffer.from(await meshFile.arrayBuffer());
        meshFileName = `${actor.userId}/${Date.now()}_${meshFile.name || 'mesh.usdz'}`;
      }

      const previewImage = formData.get('previewImage') as File | null;
      if (previewImage) {
        previewImageBuffer = Buffer.from(await previewImage.arrayBuffer());
      }
    } else if (contentType.includes('application/json')) {
      payload = (await req.json()) as IngestPayload;
    } else {
      return NextResponse.json({ error: 'Unsupported Content-Type. Expected application/json or multipart/form-data.' }, { status: 415 });
    }

    const { boundingBox, planes, clientRuntime, deviceHardware, lightProbe } = payload;
    if (!boundingBox?.min || !boundingBox?.max || !boundingBox?.extents) {
      return NextResponse.json({ error: 'Invalid spatial bounding box coordinates' }, { status: 422 });
    }

    let storageMeshPath: string | null = null;

    if (meshBuffer && meshFileName) {
      const { data: uploadData, error: uploadError } = await adminClient.storage
        .from('room-scans')
        .upload(meshFileName, meshBuffer, {
          contentType: meshFileName.endsWith('.usdz') ? 'model/vnd.usdz+zip' : 'application/octet-stream',
          upsert: true,
        });

      if (uploadError) {
        console.error('[Scan Ingestion] Storage upload error:', uploadError);
      } else if (uploadData) {
        storageMeshPath = uploadData.path;
      }
    }

    let spatialStyleNotes = 'Standard geometric scan captured.';
    if (previewImageBuffer) {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
          const ai = new GoogleGenAI({ apiKey });
          
          const genContents = [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: previewImageBuffer.toString('base64'),
                  },
                },
                {
                  text: `Analyze this physical room scan preview. Room bounds: Width ${(boundingBox.extents[0] * 2).toFixed(1)}m, Length ${(boundingBox.extents[2] * 2).toFixed(1)}m, Height ${(boundingBox.extents[1] * 2).toFixed(1)}m. Ambient lux: ${lightProbe.ambientIntensityLumens}. Detail architectural style, natural lighting characteristics, and primary functional zones in under 120 words.`,
                },
              ],
            },
          ] as unknown as Content[];

          const visionResponse = await ai.models.generateContent({
            model: 'gemini-3.7-flash',
            contents: genContents,
          });
          spatialStyleNotes = visionResponse.text || spatialStyleNotes;
        }
      } catch (geminiErr: unknown) {
        console.warn('[Scan Ingestion] Non-critical Gemini visual analysis failure:', (geminiErr as Error).message);
      }
    }

    // Insert room scan using a safe cast to bypass deep generic type resolution bugs
    const { data: scanRecordRaw, error: scanInsertError } = await actor.db
      .from('room_scans')
      .insert({
        user_id: actor.userId,
        client_runtime: clientRuntime,
        device_hardware: deviceHardware,
        storage_mesh_path: storageMeshPath,
        bounding_box: boundingBox as unknown as Json,
        planes: planes as unknown as Json,
        light_probe: lightProbe as unknown as Json,
        semantic_openings: (payload.semanticOpenings || { doors: [], windows: [] }) as unknown as Json,
      })
      .select()
      .single();

    if (scanInsertError || !scanRecordRaw) {
      console.error('[Scan Ingestion] Scan record insertion failed:', scanInsertError);
      return NextResponse.json({ error: 'Failed to record room scan metadata' }, { status: 500 });
    }
    const scanRecord = scanRecordRaw as unknown as Database['public']['Tables']['room_scans']['Row'];

    // Session Bootstrapping
    const { data: sessionRecordRaw, error: sessionInsertError } = await actor.db
      .from('design_sessions')
      .insert({
        user_id: actor.userId,
        scan_id: scanRecord.id,
        name: payload.sessionName || `Design Session - ${new Date().toLocaleDateString()}`,
        version: 1,
        is_active: true,
        environment_lighting: {
          overrideEnabled: false,
          ambientLightColor: [1.0, 1.0, 1.0],
          ambientIntensity: lightProbe.ambientIntensityLumens,
          directionalRig: [],
        } as unknown as Json,
      })
      .select()
      .single();

    if (sessionInsertError || !sessionRecordRaw) {
      console.error('[Scan Ingestion] Session creation failed:', sessionInsertError);
      return NextResponse.json({ error: 'Scan saved but failed to initiate design session' }, { status: 500 });
    }
    const sessionRecord = sessionRecordRaw as unknown as Database['public']['Tables']['design_sessions']['Row'];

    return NextResponse.json(
      {
        success: true,
        scanId: scanRecord.id,
        sessionId: sessionRecord.id,
        summary: spatialStyleNotes,
        meshPath: storageMeshPath,
        planesDetected: planes.length,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[Scan Ingestion Fatal]:', error);
    return NextResponse.json({ error: 'Internal server error during scan processing', details: error.message }, { status: 500 });
  }
}
