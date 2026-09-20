import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import { Quaternion, Vector3D } from "../../../../lib/agent/spatial-agent";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }
  return createClient(url, key);
}

function getAIClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing Gemini configuration");
  }
  return new GoogleGenAI({ apiKey: key });
}

function eulerYToQuaternion(degrees: number): Quaternion {
  const rad = (degrees * Math.PI) / 180;
  return [Math.cos(rad / 2), 0, Math.sin(rad / 2), 0];
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const ai = getAIClient();
    
    const body = await req.json();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";

    if (!sessionId || !prompt) {
      return NextResponse.json({ error: "Missing sessionId or prompt" }, { status: 400 });
    }

    const { data: session, error: sessionErr } = await supabase
      .from("design_sessions")
      .select("*, room_scans(*)")
      .eq("id", sessionId)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Spatial session not found" }, { status: 404 });
    }

    const scanContext = session.room_scans;

    const geminiResponse = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: {
          parts: [{
            text: `Spatial agent for room ${sessionId}. Extents: ${JSON.stringify(scanContext.bounding_box.extents)}. Ensure collisions are avoided.`
          }]
        },
        tools: [{
          functionDeclarations: [
            {
              name: "place_furniture",
              description: "Insert a physical catalog item into the room.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  sku: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  z: { type: Type.NUMBER },
                  rotationDegreesY: { type: Type.NUMBER }
                },
                required: ["sku", "x", "y", "z", "rotationDegreesY"]
              }
            }
          ]
        }]
      }
    });

    const functionCalls = geminiResponse.functionCalls ?? [];
    const executedMutations: Array<Record<string, unknown>> = [];

    for (const call of functionCalls) {
      if (call.name === "place_furniture" && call.args) {
        const args = call.args as Record<string, unknown>;
        const sku = typeof args.sku === "string" ? args.sku : "";
        const x = typeof args.x === "number" ? args.x : 0;
        const y = typeof args.y === "number" ? args.y : 0;
        const z = typeof args.z === "number" ? args.z : 0;
        const rot = typeof args.rotationDegreesY === "number" ? args.rotationDegreesY : 0;
        
        if (!sku) continue;

        const { data: item } = await supabase
          .from("spatial_catalog_items")
          .select("id, gltf_storage_path, usdz_storage_path")
          .eq("sku", sku)
          .single();

        if (item) {
          const rotationQuat = eulerYToQuaternion(rot);
          const positionVec: Vector3D = [x, y, z];

          const { data: entity, error: entityErr } = await supabase
            .from("scene_entities")
            .insert({
              session_id: sessionId,
              catalog_item_id: item.id,
              position: positionVec,
              rotation: rotationQuat,
              scale: [1, 1, 1]
            })
            .select()
            .single();

          if (!entityErr && entity) {
            executedMutations.push({
              type: "ENTITY_PLACED",
              entityId: entity.id,
              sku: sku,
              position: positionVec,
              rotation: rotationQuat,
              assetUrls: {
                gltf: item.gltf_storage_path,
                usdz: item.usdz_storage_path
              }
            });
          }
        }
      }
    }

    const channel = supabase.channel(`room:${sessionId}:scene`);
    await channel.send({
      type: "broadcast",
      event: "scene_mutated",
      payload: {
        mutations: executedMutations,
        agentSummary: geminiResponse.text
      }
    });

    return NextResponse.json({
      status: "EXECUTED",
      agentText: geminiResponse.text,
      mutations: executedMutations
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
