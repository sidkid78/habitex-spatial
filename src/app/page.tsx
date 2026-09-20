import React from 'react';
import { createClientFromRequest } from '../lib/supabase/server';
import { SpatialCanvas } from '../spatial/components/SpatialCanvas';
import { getSpatialWorkspaceConfig } from '../index';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Root Application Route (Server Component)
 *
 * Resolves or establishes an active spatial design session on the server
 * before mounting the WebGL / WebXR spatial canvas runtime on the client.
 */
export default async function HomePage(props: PageProps) {
  const workspaceConfig = getSpatialWorkspaceConfig();
  const searchParams = props.searchParams ? await props.searchParams : {};

  let sessionId: string | null = null;

  // 1. Check incoming URL query parameters for an existing session token
  const querySession = searchParams.sessionId || searchParams.session;
  if (typeof querySession === 'string' && querySession.trim()) {
    sessionId = querySession.trim();
  }

  // 2. Query Supabase for the most recent active design session if unassigned
  if (!sessionId) {
    try {
      const supabase = await createClientFromRequest();
      const { data: sessionRaw } = await supabase
        .from('design_sessions')
        .select('id')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const session = sessionRaw as unknown as { id: string } | null;
      if (session?.id) {
        sessionId = session.id;
      }
    } catch {
      // Gracefully handle unauthenticated or unconfigured Supabase instances
    }
  }

  // 3. Fallback to generating a fresh session UUID
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  return (
    <main
      className="w-full h-screen min-h-screen bg-neutral-950 overflow-hidden relative"
      data-app-name={workspaceConfig.name}
      data-app-version={workspaceConfig.version}
    >
      <header className="sr-only">
        <h1>{workspaceConfig.name}</h1>
        <p>Active Session: {sessionId}</p>
      </header>
      <SpatialCanvas sessionId={sessionId} />
    </main>
  );
}
