import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sign the browser in as the seeded dev user, in development only.
 *
 * The server routes have a bypass that swaps in the service-role client,
 * but that cannot help the browser: it talks to Supabase directly with
 * the anon key, and RLS correctly returns NOTHING to an unauthenticated
 * caller. The symptom is not an error — it is zero rows, which surfaces
 * as `[SceneSync] Error querying authoritative state: {}`, an empty
 * object because there was no error to report.
 *
 * Loosening RLS to fix that would make development pass under rules
 * production does not have, which is how a policy bug ships. So the
 * browser gets a REAL session instead: the same seeded account, signed
 * in with a password that only exists on a local stack. RLS then behaves
 * exactly as it will in production, and realtime subscriptions — which
 * also authorise per-connection — start working too.
 *
 * Guarded twice: NODE_ENV is `production` in any deployment, and the
 * credentials live in .env.local, which is gitignored. The password is
 * for `dev@localhost.test` on 127.0.0.1 and is worthless anywhere else.
 */
let attempted: Promise<void> | null = null;

export function ensureDevSession(client: SupabaseClient<never>): Promise<void> {
  if (process.env.NODE_ENV === 'production') return Promise.resolve();

  const email = process.env.NEXT_PUBLIC_DEV_USER_EMAIL;
  const password = process.env.NEXT_PUBLIC_DEV_USER_PASSWORD;
  if (!email || !password) return Promise.resolve();

  // Once per page load, not once per caller — several hooks reach for a
  // client, and signing in concurrently races the token exchange.
  attempted ??= (async () => {
    // getUser(), not getSession(). getSession reads localStorage and
    // believes it; a `supabase db reset` deletes every user while the
    // browser keeps the old token, so the client looks signed in as
    // somebody who no longer exists and every query returns zero rows.
    // getUser asks the server, which is the only thing that knows.
    const { data, error: whoami } = await client.auth.getUser();
    if (data?.user && !whoami) return;

    await client.auth.signOut().catch(() => undefined);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      console.warn('[dev-session] sign-in failed:', error.message);
    }
  })();

  return attempted;
}
