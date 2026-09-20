-- ============================================================================
-- HABITEX AI: SPATIAL COMPUTING & COMMERCE SCHEMA
-- Migration: 20250228000001_habitex_spatial_core.sql
-- ============================================================================

-- 1. EXTENSIONS & PREREQUISITES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA extensions;

-- 2. ENUM DECLARATIONS
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_runtime_type') THEN
    CREATE TYPE public.client_runtime_type AS ENUM ('VisionOS', 'WebXR');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'catalog_category') THEN
    CREATE TYPE public.catalog_category AS ENUM (
      'sofa_seating',
      'accent_chair',
      'dining_table',
      'coffee_accent_table',
      'lighting_ambient',
      'lighting_directional',
      'storage_credenza',
      'bed_mattress',
      'decor_rug',
      'wall_covering',
      'floor_flooring'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'collaborator_role') THEN
    CREATE TYPE public.collaborator_role AS ENUM ('owner', 'editor', 'viewer');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_type') THEN
    CREATE TYPE public.order_status_type AS ENUM (
      'draft',
      'pending_payment',
      'processing',
      'placed',
      'fulfilled',
      'cancelled'
    );
  END IF;
END $$;

-- 3. HELPER FUNCTIONS: Automatic Timestamp Updating
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TABLE DEFINITIONS
-- ============================================================================

-- 4. USER PROFILES
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. ROOM SCANS
-- Holds physical spatial room boundaries, plane anchors, and light probes from visionOS / WebXR
CREATE TABLE public.room_scans (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_runtime public.client_runtime_type NOT NULL,
    device_hardware TEXT NOT NULL,
    storage_mesh_path TEXT, -- Supabase Storage reference to .ply / .usdz
    bounding_box JSONB NOT NULL, -- { min: [x,y,z], max: [x,y,z], center: [x,y,z], extents: [w,h,d] }
    planes JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of SpatialPlaneAnchor
    light_probe JSONB NOT NULL DEFAULT '{}'::jsonb, -- SH coefficients and illuminance metrics
    semantic_openings JSONB NOT NULL DEFAULT '{"doors": [], "windows": []}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_bounding_box_format CHECK (
      bounding_box ? 'min' AND bounding_box ? 'max' AND bounding_box ? 'extents'
    )
);

CREATE TRIGGER set_room_scans_updated_at
BEFORE UPDATE ON public.room_scans
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. SPATIAL ASSET CATALOG
-- Unified catalog for 3D furniture, PBR textures, and materials with 768-dim embeddings (Gemini)
CREATE TABLE public.spatial_catalog_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    sku VARCHAR(64) UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category public.catalog_category NOT NULL,
    is_surface_material BOOLEAN NOT NULL DEFAULT FALSE,
    dimensions_metric extensions.vector(3) NOT NULL, -- [width, height, depth] in SI metres
    bounding_box JSONB NOT NULL DEFAULT '{}'::jsonb,
    gltf_storage_path TEXT, -- WebXR (Three.js / WebGPU) asset
    usdz_storage_path TEXT, -- visionOS (RealityKit) asset
    pbr_material_config JSONB DEFAULT NULL, -- For wall/floor materials: { albedo, roughness, metallic, normalUrl, etc. }
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    in_stock BOOLEAN NOT NULL DEFAULT TRUE,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    retailer_id UUID NOT NULL,
    retailer_name TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding extensions.vector(768), -- Gemini text-embedding-004 / multimodal representation
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_spatial_catalog_items_updated_at
BEFORE UPDATE ON public.spatial_catalog_items
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 7. DESIGN SESSIONS
-- Collaborative spaces linking a physical room scan with an editable spatial scene
CREATE TABLE public.design_sessions (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    scan_id UUID NOT NULL REFERENCES public.room_scans(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    environment_lighting JSONB NOT NULL DEFAULT '{
      "overrideEnabled": false,
      "ambientLightColor": [1.0, 1.0, 1.0],
      "ambientIntensity": 1.0,
      "directionalRig": []
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_design_sessions_updated_at
BEFORE UPDATE ON public.design_sessions
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 8. SESSION COLLABORATORS
-- Multimodal Multi-User Realtime access mapping
CREATE TABLE public.session_collaborators (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.design_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.collaborator_role NOT NULL DEFAULT 'editor',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, user_id)
);

-- 9. SCENE ENTITIES (Spatial Graph Nodes)
-- Real-time 3D furniture instances placed in the room
CREATE TABLE public.scene_entities (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.design_sessions(id) ON DELETE CASCADE,
    catalog_item_id UUID NOT NULL REFERENCES public.spatial_catalog_items(id) ON DELETE RESTRICT,
    position extensions.vector(3) NOT NULL, -- [x, y, z] metric translation
    rotation extensions.vector(4) NOT NULL, -- [w, x, y, z] Hamilton Unit Quaternion
    scale extensions.vector(3) NOT NULL DEFAULT '[1.0, 1.0, 1.0]'::extensions.vector,
    material_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    physics_config JSONB NOT NULL DEFAULT '{"isStatic": true, "massKg": 15.0, "collisionLayer": "furniture"}'::jsonb,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_scene_entities_updated_at
BEFORE UPDATE ON public.scene_entities
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 10. SURFACE MODIFICATIONS (PBR Overrides for Detected Surfaces)
CREATE TABLE public.surface_modifications (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.design_sessions(id) ON DELETE CASCADE,
    plane_anchor_id TEXT NOT NULL,
    surface_type VARCHAR(16) NOT NULL CHECK (surface_type IN ('wall', 'floor', 'ceiling')),
    pbr_material JSONB NOT NULL, -- Direct PBR factors: albedoFactor, roughness, metallic, normalTextureUrl, uvScale
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, plane_anchor_id)
);

CREATE TRIGGER set_surface_modifications_updated_at
BEFORE UPDATE ON public.surface_modifications
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 11. ORDERS (Autonomous & Direct Agentic Checkout)
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    session_id UUID REFERENCES public.design_sessions(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status public.order_status_type NOT NULL DEFAULT 'draft',
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
    billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_intent_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 12. ORDER LINE ITEMS
CREATE TABLE public.order_items (
    id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    catalog_item_id UUID NOT NULL REFERENCES public.spatial_catalog_items(id) ON DELETE RESTRICT,
    scene_entity_id UUID REFERENCES public.scene_entities(id) ON DELETE SET NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    retailer_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- HNSW & PERFORMANCE INDEXING
-- ============================================================================

-- Fast HNSW cosine similarity index for Gemini 768-dimensional embeddings
CREATE INDEX idx_catalog_hnsw_embedding 
ON public.spatial_catalog_items 
USING hnsw (embedding extensions.vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Spatial and relational B-tree indices for fast low-latency lookups
CREATE INDEX idx_spatial_catalog_category ON public.spatial_catalog_items (category);
CREATE INDEX idx_spatial_catalog_price ON public.spatial_catalog_items (price_cents);
CREATE INDEX idx_spatial_catalog_sku ON public.spatial_catalog_items (sku);

CREATE INDEX idx_scene_entities_session_id ON public.scene_entities (session_id);
CREATE INDEX idx_surface_modifications_session_id ON public.surface_modifications (session_id);
CREATE INDEX idx_collaborators_session_user ON public.session_collaborators (session_id, user_id);
CREATE INDEX idx_orders_user_id ON public.orders (user_id);
CREATE INDEX idx_order_items_order_id ON public.order_items (order_id);

-- ============================================================================
-- VECTOR SEARCH & SCENE RPC FUNCTIONS
-- ============================================================================

-- Function: Semantic and Metric Dimension Constrained Vector Retrieval
CREATE OR REPLACE FUNCTION public.match_spatial_catalog_items(
    query_embedding extensions.vector(768),
    match_threshold FLOAT DEFAULT 0.45,
    match_count INT DEFAULT 10,
    filter_category public.catalog_category DEFAULT NULL,
    max_price_cents INT DEFAULT NULL,
    max_dimensions extensions.vector(3) DEFAULT NULL -- [max_w, max_h, max_d]
)
RETURNS TABLE (
    id UUID,
    sku VARCHAR(64),
    name TEXT,
    description TEXT,
    category public.catalog_category,
    dimensions_metric extensions.vector(3),
    gltf_storage_path TEXT,
    usdz_storage_path TEXT,
    price_cents INT,
    currency VARCHAR(3),
    retailer_name TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT
        item.id,
        item.sku,
        item.name,
        item.description,
        item.category,
        item.dimensions_metric,
        item.gltf_storage_path,
        item.usdz_storage_path,
        item.price_cents,
        item.currency,
        item.retailer_name,
        (1 - (item.embedding <=> query_embedding))::FLOAT AS similarity
    FROM public.spatial_catalog_items item
    WHERE item.in_stock = TRUE
      AND (filter_category IS NULL OR item.category = filter_category)
      AND (max_price_cents IS NULL OR item.price_cents <= max_price_cents)
      AND (
          max_dimensions IS NULL OR (
              item.dimensions_metric[1] <= max_dimensions[1] AND
              item.dimensions_metric[2] <= max_dimensions[2] AND
              item.dimensions_metric[3] <= max_dimensions[3]
          )
      )
      AND (1 - (item.embedding <=> query_embedding)) > match_threshold
    ORDER BY similarity DESC
    LIMIT match_count;
END;
$$;

-- Function: Atomic Scene Entity Batch Placement
CREATE OR REPLACE FUNCTION public.commit_spatial_mutation_tx(
    p_session_id UUID,
    p_entities JSONB, -- Array of objects: { catalog_item_id, position: [x,y,z], rotation: [w,x,y,z], scale: [x,y,z] }
    p_surfaces JSONB DEFAULT '[]'::jsonb -- Array of objects: { plane_anchor_id, surface_type, pbr_material }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entity RECORD;
    v_surface RECORD;
    v_created_entities_count INT := 0;
    v_updated_surfaces_count INT := 0;
BEGIN
    -- Validate session access
    IF NOT EXISTS (
        SELECT 1 FROM public.design_sessions 
        WHERE id = p_session_id 
        AND (user_id = auth.uid() OR id IN (
            SELECT session_id FROM public.session_collaborators 
            WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
        ))
    ) THEN
        RAISE EXCEPTION 'Unauthorized spatial mutation attempt on session %', p_session_id;
    END IF;

    -- Process Entity Mutations
    FOR v_entity IN SELECT * FROM jsonb_array_elements(p_entities) LOOP
        INSERT INTO public.scene_entities (
            session_id,
            catalog_item_id,
            position,
            rotation,
            scale
        ) VALUES (
            p_session_id,
            (v_entity.value->>'catalog_item_id')::UUID,
            (v_entity.value->>'position')::extensions.vector,
            (v_entity.value->>'rotation')::extensions.vector,
            COALESCE((v_entity.value->>'scale')::extensions.vector, '[1.0, 1.0, 1.0]'::extensions.vector)
        );
        v_created_entities_count := v_created_entities_count + 1;
    END LOOP;

    -- Process Surface Modifications
    FOR v_surface IN SELECT * FROM jsonb_array_elements(p_surfaces) LOOP
        INSERT INTO public.surface_modifications (
            session_id,
            plane_anchor_id,
            surface_type,
            pbr_material
        ) VALUES (
            p_session_id,
            v_surface.value->>'plane_anchor_id',
            v_surface.value->>'surface_type',
            v_surface.value->'pbr_material'
        )
        ON CONFLICT (session_id, plane_anchor_id)
        DO UPDATE SET
            pbr_material = EXCLUDED.pbr_material,
            updated_at = NOW();
        v_updated_surfaces_count := v_updated_surfaces_count + 1;
    END LOOP;

    -- Increment Session Version Counter
    UPDATE public.design_sessions
    SET version = version + 1,
        updated_at = NOW()
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
        'success', true,
        'session_id', p_session_id,
        'entities_placed', v_created_entities_count,
        'surfaces_modified', v_updated_surfaces_count
    );
END;
$$;

-- ============================================================================
-- SUPABASE REALTIME REPLICATION CONFIGURATION
-- ============================================================================

-- Ensure full row image on mutate for real-time CDC
ALTER TABLE public.design_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.scene_entities REPLICA IDENTITY FULL;
ALTER TABLE public.surface_modifications REPLICA IDENTITY FULL;

-- Add relevant spatial graph entities to the Supabase Realtime publication
BEGIN;
  DROP PUBLICATION IF EXISTS supabase_realtime;
  CREATE PUBLICATION supabase_realtime FOR TABLE 
    public.design_sessions,
    public.scene_entities,
    public.surface_modifications;
COMMIT;
