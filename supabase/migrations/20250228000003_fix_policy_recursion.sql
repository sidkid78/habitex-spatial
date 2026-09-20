-- Break the RLS recursion between design_sessions and session_collaborators.
--
-- Postgres refused every read with:
--   42P17: infinite recursion detected in policy for relation "design_sessions"
--
-- Two cycles, either one fatal:
--
--   1. SELF. The session_collaborators SELECT policy queried
--      session_collaborators inside its own USING clause, so evaluating
--      the policy required evaluating the policy.
--
--   2. MUTUAL. The design_sessions policies query session_collaborators
--      to find shared sessions, and the session_collaborators policies
--      query design_sessions to find owned ones.
--
-- A policy cannot ask a question whose answer requires the same policy.
-- The fix is to answer the membership question OUTSIDE row security: a
-- SECURITY DEFINER function runs as its owner and is not itself filtered,
-- so the cycle stops at the function boundary.
--
-- This does not widen access. The function takes the caller's own
-- auth.uid() and answers only "may this user reach this session",
-- exactly what the policies were trying to compute for themselves.

CREATE OR REPLACE FUNCTION public.can_access_session(target_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
-- An empty search_path stops a caller-controlled schema from shadowing
-- these tables; SECURITY DEFINER without it is a privilege-escalation
-- footgun.
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.design_sessions s
        WHERE s.id = target_session_id AND s.user_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.session_collaborators c
        WHERE c.session_id = target_session_id AND c.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_session(target_session_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.design_sessions s
        WHERE s.id = target_session_id AND s.user_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.session_collaborators c
        WHERE c.session_id = target_session_id
          AND c.user_id = auth.uid()
          AND c.role IN ('owner', 'editor')
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_session(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_session(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_session(UUID) TO authenticated;

-- design_sessions: owner check stays inline, membership goes through the
-- function. The owner branch is first so the common case never calls it.
DROP POLICY IF EXISTS "Users can view their own or shared design sessions" ON public.design_sessions;
DROP POLICY IF EXISTS "Session owners and editors can update design sessions" ON public.design_sessions;

CREATE POLICY "Users can view their own or shared design sessions"
ON public.design_sessions FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.can_access_session(id));

CREATE POLICY "Session owners and editors can update design sessions"
ON public.design_sessions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR public.can_edit_session(id))
WITH CHECK (auth.uid() = user_id OR public.can_edit_session(id));

-- session_collaborators: the self-referencing UNION is what made this
-- table recursive on its own.
DROP POLICY IF EXISTS "Users can view collaborators of their sessions" ON public.session_collaborators;
DROP POLICY IF EXISTS "Session owners can manage collaborators" ON public.session_collaborators;

CREATE POLICY "Users can view collaborators of their sessions"
ON public.session_collaborators FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.can_access_session(session_id));

CREATE POLICY "Session owners can manage collaborators"
ON public.session_collaborators FOR ALL
TO authenticated
USING (public.can_edit_session(session_id))
WITH CHECK (public.can_edit_session(session_id));
