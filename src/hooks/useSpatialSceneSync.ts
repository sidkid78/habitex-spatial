import { useEffect, useRef } from "react";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface SpatialSyncProps {
  sessionId: string;
  threeScene: THREE.Scene;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export function useSpatialSceneSync({
  sessionId,
  threeScene,
  supabaseUrl,
  supabaseAnonKey
}: SpatialSyncProps) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const gltfLoaderRef = useRef<GLTFLoader | null>(null);

  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !sessionId) {
      return;
    }

    if (!gltfLoaderRef.current) {
      gltfLoaderRef.current = new GLTFLoader();
    }
    const loader = gltfLoaderRef.current;

    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const channelName = `room:${sessionId}:scene`;

    const channel = supabase.channel(channelName)
      .on("broadcast", { event: "scene_mutated" }, (payload) => {
        const mutations = payload.payload?.mutations;
        if (!Array.isArray(mutations)) return;

        for (const mut of mutations) {
          if (mut.type === "ENTITY_PLACED" && mut.assetUrls?.gltf) {
            loader.load(
              mut.assetUrls.gltf,
              (data: unknown) => {
                const gltf = data as { scene: THREE.Object3D };
                const model = gltf.scene;
                model.name = mut.entityId;
                
                if (Array.isArray(mut.position) && mut.position.length === 3) {
                  model.position.set(mut.position[0], mut.position[1], mut.position[2]);
                }
                
                if (Array.isArray(mut.rotation) && mut.rotation.length === 4) {
                  model.quaternion.set(
                    mut.rotation[1], 
                    mut.rotation[2], 
                    mut.rotation[3], 
                    mut.rotation[0]  
                  );
                }

                model.castShadow = true;
                model.receiveShadow = true;
                threeScene.add(model);
              },
              undefined,
              (error: unknown) => {
                console.error(`Failed to load asset for entity ${mut.entityId}`, error);
              }
            );
          }
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [sessionId, threeScene, supabaseUrl, supabaseAnonKey]);
}
