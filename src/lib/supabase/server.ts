import { createServerClient } from '@supabase/ssr';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '../../types/supabase';

interface WritableCookies {
  set(name: string, value: string, options: unknown): void;
}

/**
 * Creates an authenticated Supabase client leveraging Next.js cookie store.
 * Used to enforce Row Level Security (RLS) on behalf of the calling client.
 */
export async function createClientFromRequest(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase public configuration. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            (cookieStore as unknown as WritableCookies).set(name, value, options)
          );
        } catch {
          // Can occur when called from pure Route Handler reading cookies
        }
      },
    },
  }) as SupabaseClient<Database>;
}

/**
 * Creates a privileged Supabase client with the service role key.
 * Used exclusively for administrative writes, cross-system mutations,
 * storage provisioning, and vector indexing operations.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase service role configuration. Please set SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as SupabaseClient<Database>;
}
