-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- 1. Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spatial_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surface_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- PROFILES POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can read all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- ROOM SCANS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view their own room scans"
ON public.room_scans FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own room scans"
ON public.room_scans FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can modify their own room scans"
ON public.room_scans FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own room scans"
ON public.room_scans FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- SPATIAL CATALOG ITEMS (Public Catalog with Service Role Mutations)
-- ----------------------------------------------------------------------------
CREATE POLICY "Authenticated users can browse catalog items"
ON public.spatial_catalog_items FOR SELECT
TO authenticated
USING (true);

-- Catalog modifications restricted to administrative service role
CREATE POLICY "Service role full access on catalog"
ON public.spatial_catalog_items FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- DESIGN SESSIONS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view sessions they own or collaborate on"
ON public.design_sessions FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id OR
    id IN (SELECT session_id FROM public.session_collaborators WHERE user_id = auth.uid())
);

CREATE POLICY "Users can create their own design sessions"
ON public.design_sessions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Session owners and editors can update design sessions"
ON public.design_sessions FOR UPDATE
TO authenticated
USING (
    auth.uid() = user_id OR
    id IN (
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
)
WITH CHECK (
    auth.uid() = user_id OR
    id IN (
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
);

CREATE POLICY "Only session owners can delete design sessions"
ON public.design_sessions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- SESSION COLLABORATORS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view collaborators of their sessions"
ON public.session_collaborators FOR SELECT
TO authenticated
USING (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Session owners can manage collaborators"
ON public.session_collaborators FOR ALL
TO authenticated
USING (
    session_id IN (SELECT id FROM public.design_sessions WHERE user_id = auth.uid())
)
WITH CHECK (
    session_id IN (SELECT id FROM public.design_sessions WHERE user_id = auth.uid())
);

-- ----------------------------------------------------------------------------
-- SCENE ENTITIES POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view entities in accessible sessions"
ON public.scene_entities FOR SELECT
TO authenticated
USING (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can insert entities in editable sessions"
ON public.scene_entities FOR INSERT
TO authenticated
WITH CHECK (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
);

CREATE POLICY "Users can update entities in editable sessions"
ON public.scene_entities FOR UPDATE
TO authenticated
USING (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
)
WITH CHECK (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
);

CREATE POLICY "Users can delete entities in editable sessions"
ON public.scene_entities FOR DELETE
TO authenticated
USING (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
);

-- ----------------------------------------------------------------------------
-- SURFACE MODIFICATIONS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can read surface modifications in accessible sessions"
ON public.surface_modifications FOR SELECT
TO authenticated
USING (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators WHERE user_id = auth.uid()
    )
);

CREATE POLICY "Users can mutate surfaces in editable sessions"
ON public.surface_modifications FOR ALL
TO authenticated
USING (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
)
WITH CHECK (
    session_id IN (
        SELECT id FROM public.design_sessions WHERE user_id = auth.uid()
        UNION
        SELECT session_id FROM public.session_collaborators 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
);

-- ----------------------------------------------------------------------------
-- ORDERS & ORDER ITEMS POLICIES
-- ----------------------------------------------------------------------------
CREATE POLICY "Users can view their own orders"
ON public.orders FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own orders"
ON public.orders FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view items attached to their orders"
ON public.order_items FOR SELECT
TO authenticated
USING (
    order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid())
);

CREATE POLICY "Users can insert line items to their own orders"
ON public.order_items FOR INSERT
TO authenticated
WITH CHECK (
    order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid())
);
