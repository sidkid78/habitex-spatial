import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './server';
import type { Database } from '../../types/supabase';

/**
 * Who is making this request, with a local-development escape hatch.
 *
 * Every API route gates on an authenticated user, and this app has no
 * auth UI yet — so in development every request 401s and the spatial
 * agent cannot be exercised at all. `npm run seed:dev` creates a real
 * user with a real scanned room and design session; this adopts that id
 * when DEV_BYPASS_USER_ID is set.
 *
 * Two conditions, both required, so it cannot reach production:
 * NODE_ENV is `production` in any real deployment, and the variable
 * lives in .env.local, which is gitignored.
 *
 * Skipping auth is not enough on its own. Every query below the gate
 * runs through RLS, which correctly denies an unauthenticated request,
 * so a bypassed request also needs the service-role client. A real
 * session keeps using the request-scoped client and stays subject to
 * RLS — the bypass changes who you are, never what the rules are for
 * everyone else.
 */
export interface RequestActor {
  userId: string;
  /** RLS-bound for a real session; service-role only on the dev path. */
  db: SupabaseClient<Database>;
  isDevBypass: boolean;
}

export async function resolveActor(
  sessionClient: SupabaseClient<Database>
): Promise<RequestActor | null> {
  const { data: { user } } = await sessionClient.auth.getUser();
  if (user) {
    return { userId: user.id, db: sessionClient, isDevBypass: false };
  }

  const devUserId =
    process.env.NODE_ENV !== 'production' ? process.env.DEV_BYPASS_USER_ID : undefined;
  if (!devUserId) return null;

  return { userId: devUserId, db: createAdminClient(), isDevBypass: true };
}
