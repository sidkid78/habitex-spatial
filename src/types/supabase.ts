export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ClientRuntimeType = 'VisionOS' | 'WebXR';

export type CatalogCategory =
  | 'sofa_seating'
  | 'accent_chair'
  | 'dining_table'
  | 'coffee_accent_table'
  | 'lighting_ambient'
  | 'lighting_directional'
  | 'storage_credenza'
  | 'bed_mattress'
  | 'decor_rug'
  | 'wall_covering'
  | 'floor_flooring';

export type CollaboratorRole = 'owner' | 'editor' | 'viewer';

export type OrderStatusType =
  | 'draft'
  | 'pending_payment'
  | 'processing'
  | 'placed'
  | 'fulfilled'
  | 'cancelled';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      room_scans: {
        Row: {
          id: string;
          user_id: string;
          client_runtime: ClientRuntimeType;
          device_hardware: string;
          storage_mesh_path: string | null;
          bounding_box: {
            min: [number, number, number];
            max: [number, number, number];
            center: [number, number, number];
            extents: [number, number, number];
          };
          planes: Array<{
            id: string;
            semanticType:
              | 'floor'
              | 'ceiling'
              | 'wall'
              | 'door'
              | 'window'
              | 'table'
              | 'seat'
              | 'unknown';
            confidence: number;
            transform: {
              position: [number, number, number];
              rotation: [number, number, number, number];
              scale: [number, number, number];
            };
            dimensions: [number, number];
            boundaryPolygon: Array<[number, number, number]>;
            isPrimaryFloor?: boolean;
          }>;
          light_probe: {
            ambientIntensityLumens: number;
            colorTemperatureKelvin: number;
            sphericalHarmonicsCoefficients: number[];
            dominantDirectionalLight?: {
              direction: [number, number, number];
              color: [number, number, number];
              intensityLux: number;
            };
          };
          semantic_openings: {
            doors: Array<{
              id: string;
              transform: Json;
              width: number;
              height: number;
            }>;
            windows: Array<{
              id: string;
              transform: Json;
              width: number;
              height: number;
            }>;
          };
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_runtime: ClientRuntimeType;
          device_hardware: string;
          storage_mesh_path?: string | null;
          bounding_box: Json;
          planes?: Json;
          light_probe?: Json;
          semantic_openings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_runtime?: ClientRuntimeType;
          device_hardware?: string;
          storage_mesh_path?: string | null;
          bounding_box?: Json;
          planes?: Json;
          light_probe?: Json;
          semantic_openings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      spatial_catalog_items: {
        Row: {
          id: string;
          sku: string;
          name: string;
          description: string;
          category: CatalogCategory;
          is_surface_material: boolean;
          dimensions_metric: string | number[];
          bounding_box: Json;
          gltf_storage_path: string | null;
          usdz_storage_path: string | null;
          pbr_material_config: {
            materialId: string;
            name: string;
            albedoFactor: [number, number, number, number];
            roughnessFactor: number;
            metallicFactor: number;
            normalTextureUrl?: string;
            baseColorTextureUrl?: string;
            roughnessMetallicTextureUrl?: string;
            uvScale: [number, number];
          } | null;
          price_cents: number;
          currency: string;
          in_stock: boolean;
          stock_quantity: number;
          retailer_id: string;
          retailer_name: string;
          metadata: Json;
          embedding: string | number[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sku: string;
          name: string;
          description: string;
          category: CatalogCategory;
          is_surface_material?: boolean;
          dimensions_metric: string | number[];
          bounding_box?: Json;
          gltf_storage_path?: string | null;
          usdz_storage_path?: string | null;
          pbr_material_config?: Json | null;
          price_cents: number;
          currency?: string;
          in_stock?: boolean;
          stock_quantity?: number;
          retailer_id: string;
          retailer_name: string;
          metadata?: Json;
          embedding?: string | number[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sku?: string;
          name?: string;
          description?: string;
          category?: CatalogCategory;
          is_surface_material?: boolean;
          dimensions_metric?: string | number[];
          bounding_box?: Json;
          gltf_storage_path?: string | null;
          usdz_storage_path?: string | null;
          pbr_material_config?: Json | null;
          price_cents?: number;
          currency?: string;
          in_stock?: boolean;
          stock_quantity?: number;
          retailer_id?: string;
          retailer_name?: string;
          metadata?: Json;
          embedding?: string | number[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      design_sessions: {
        Row: {
          id: string;
          user_id: string;
          scan_id: string;
          name: string;
          version: number;
          is_active: boolean;
          environment_lighting: {
            overrideEnabled: boolean;
            ambientLightColor: [number, number, number];
            ambientIntensity: number;
            directionalRig: Array<{
              id: string;
              position: [number, number, number];
              direction: [number, number, number];
              intensity: number;
              castShadows: boolean;
            }>;
          };
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scan_id: string;
          name: string;
          version?: number;
          is_active?: boolean;
          environment_lighting?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          scan_id?: string;
          name?: string;
          version?: number;
          is_active?: boolean;
          environment_lighting?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      session_collaborators: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          role: CollaboratorRole;
          joined_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          role?: CollaboratorRole;
          joined_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          user_id?: string;
          role?: CollaboratorRole;
          joined_at?: string;
        };
        Relationships: [];
      };
      scene_entities: {
        Row: {
          id: string;
          session_id: string;
          catalog_item_id: string;
          position: string | number[];
          rotation: string | number[];
          scale: string | number[];
          material_overrides: Record<string, Json>;
          physics_config: {
            isStatic: boolean;
            massKg: number;
            collisionLayer: string;
          };
          is_locked: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          catalog_item_id: string;
          position: string | number[];
          rotation: string | number[];
          scale?: string | number[];
          material_overrides?: Json;
          physics_config?: Json;
          is_locked?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          catalog_item_id?: string;
          position?: string | number[];
          rotation?: string | number[];
          scale?: string | number[];
          material_overrides?: Json;
          physics_config?: Json;
          is_locked?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      surface_modifications: {
        Row: {
          id: string;
          session_id: string;
          plane_anchor_id: string;
          surface_type: 'wall' | 'floor' | 'ceiling';
          pbr_material: {
            materialId: string;
            name: string;
            albedoFactor: [number, number, number, number];
            roughnessFactor: number;
            metallicFactor: number;
            normalTextureUrl?: string;
            baseColorTextureUrl?: string;
            roughnessMetallicTextureUrl?: string;
            uvScale: [number, number];
          };
          applied_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          plane_anchor_id: string;
          surface_type: 'wall' | 'floor' | 'ceiling';
          pbr_material: Json;
          applied_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          plane_anchor_id?: string;
          surface_type?: 'wall' | 'floor' | 'ceiling';
          pbr_material?: Json;
          applied_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          session_id: string | null;
          user_id: string;
          status: OrderStatusType;
          total_amount_cents: number;
          currency: string;
          shipping_address: Json;
          billing_address: Json;
          payment_intent_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          user_id: string;
          status?: OrderStatusType;
          total_amount_cents: number;
          currency?: string;
          shipping_address?: Json;
          billing_address?: Json;
          payment_intent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          user_id?: string;
          status?: OrderStatusType;
          total_amount_cents?: number;
          currency?: string;
          shipping_address?: Json;
          billing_address?: Json;
          payment_intent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          catalog_item_id: string;
          scene_entity_id: string | null;
          unit_price_cents: number;
          quantity: number;
          retailer_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          catalog_item_id: string;
          scene_entity_id?: string | null;
          unit_price_cents: number;
          quantity: number;
          retailer_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          catalog_item_id?: string;
          scene_entity_id?: string | null;
          unit_price_cents?: number;
          quantity?: number;
          retailer_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_spatial_catalog_items: {
        Args: {
          query_embedding: string;
          match_threshold?: number;
          match_count?: number;
          filter_category?: CatalogCategory | null;
          max_price_cents?: number | null;
          max_dimensions?: string | null;
        };
        Returns: Array<{
          id: string;
          sku: string;
          name: string;
          description: string;
          category: CatalogCategory;
          dimensions_metric: string;
          gltf_storage_path: string | null;
          usdz_storage_path: string | null;
          price_cents: number;
          currency: string;
          retailer_name: string;
          similarity: number;
        }>;
      };
      commit_spatial_mutation_tx: {
        Args: {
          p_session_id: string;
          p_entities: Json;
          p_surfaces?: Json;
        };
        Returns: {
          success: boolean;
          session_id: string;
          entities_placed: number;
          surfaces_modified: number;
        };
      };
    };
  };
}
