import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PhysicalRoomScanManifest } from "../../../../lib/agent/spatial-agent";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const authHeader = req.headers.get("authorization");
    
    if (!authHeader) {
      return NextResponse.json({ error: "Missing authorization bearer" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    const payload = (await req.json()) as PhysicalRoomScanManifest;

    if (!payload.bounds || !payload.planes || payload.planes.length === 0) {
      return NextResponse.json({ error: "Invalid spatial scan: Incomplete boundaries" }, { status: 422 });
    }

    const { data: scanRecord, error: insertError } = await supabase
      .from("room_scans")
      .insert({
        user_id: user.id,
        client_runtime: payload.clientRuntime,
        bounding_box: payload.bounds,
        planes: payload.planes,
        light_probe: payload.lightProbe,
        storage_mesh_path: payload.rawMeshStorageKey ?? null
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const { data: sessionRecord, error: sessionError } = await supabase
      .from("design_sessions")
      .insert({
        user_id: user.id,
        scan_id: scanRecord.id,
        name: `Design - ${new Date().toLocaleDateString()}`
      })
      .select("id")
      .single();

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    return NextResponse.json({
      scanId: scanRecord.id,
      sessionId: sessionRecord.id,
      status: "INITIALIZED"
    }, { status: 201 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal spatial ingestion error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
