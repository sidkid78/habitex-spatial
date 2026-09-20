/**
 * seed-dev-session.mjs — a user, a scanned room and a design session.
 *
 * Every API route gates on an authenticated user, and there is no auth
 * UI yet, so the app can only ever render an empty canvas and 401 on
 * every request. This creates a real user with a real session to work
 * against. Local only: it uses the service role key and refuses any URL
 * that is not 127.0.0.1.
 *
 *   node scripts/seed-dev-session.mjs
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .map((l) => l.match(/^([A-Z_]+)="?([^"\n]*)"?$/)).filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = 'dev@localhost.test';
if (!/127\.0\.0\.1|localhost/.test(URL_)) throw new Error(`refusing non-local: ${URL_}`);

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const rest = async (path, init = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init, headers: { ...h, Prefer: 'return=representation', ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

// 1. the user
const list = await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: h }).then((r) => r.json());
let userId = (list.users || []).find((u) => u.email === EMAIL)?.id;
if (!userId) {
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ email: EMAIL, password: 'devpassword123', email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  userId = body.id;
}
console.log(`user     ${EMAIL}  ${userId}`);

await rest('profiles', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify({ id: userId, email: EMAIL, full_name: 'Dev User' }),
}).catch(() => rest(`profiles?id=eq.${userId}`, { method: 'PATCH', body: JSON.stringify({ email: EMAIL }) }));
console.log('profile  ok');

// 2. a scanned room — a session cannot exist without one
const existingScan = await rest(`room_scans?user_id=eq.${userId}&select=id&limit=1`);
const scanId = existingScan[0]?.id ?? (await rest('room_scans', {
  method: 'POST',
  body: JSON.stringify({
    user_id: userId,
    client_runtime: 'WebXR',
    device_hardware: 'dev-seed',
    // The CHECK constraint requires min, max AND extents together.
    bounding_box: { min: [-2.5, 0, -2], max: [2.5, 2.6, 2], center: [0, 1.3, 0], extents: [5, 2.6, 4] },
    // A plain rectangular room, so the agent has real surfaces to reason
    // about instead of an empty scene.
    planes: [
      { id: 'floor', semanticLabel: 'floor', center: [0, 0, 0], extent: [5, 4], normal: [0, 1, 0] },
      { id: 'ceiling', semanticLabel: 'ceiling', center: [0, 2.6, 0], extent: [5, 4], normal: [0, -1, 0] },
      { id: 'wall-west', semanticLabel: 'wall', center: [-2.5, 1.3, 0], extent: [4, 2.6], normal: [1, 0, 0] },
      { id: 'wall-east', semanticLabel: 'wall', center: [2.5, 1.3, 0], extent: [4, 2.6], normal: [-1, 0, 0] },
      { id: 'wall-north', semanticLabel: 'wall', center: [0, 1.3, -2], extent: [5, 2.6], normal: [0, 0, 1] },
      { id: 'wall-south', semanticLabel: 'wall', center: [0, 1.3, 2], extent: [5, 2.6], normal: [0, 0, -1] },
    ],
    semantic_openings: { doors: [], windows: [] },
  }),
}))[0].id;
console.log(`scan     ${scanId}`);

// 3. the session the page opens
const existingSession = await rest(`design_sessions?user_id=eq.${userId}&select=id&limit=1`);
const sessionId = existingSession[0]?.id ?? (await rest('design_sessions', {
  method: 'POST',
  body: JSON.stringify({ user_id: userId, scan_id: scanId, name: 'Dev Session' }),
}))[0].id;
console.log(`session  ${sessionId}`);

// 4. something to place
const catalogue = await rest('spatial_catalog_items?select=id&limit=1');
if (catalogue.length === 0) {
  await rest('spatial_catalog_items', {
    method: 'POST',
    body: JSON.stringify([
      { sku: 'DEV-CHAIR-01', name: 'Lounge Chair', description: 'Low walnut-framed lounge chair.',
        category: 'accent_chair', dimensions_metric: [0.8, 0.75, 0.85], price_cents: 89900,
        retailer_id: '00000000-0000-0000-0000-0000000000aa', retailer_name: 'Dev Retailer' },
      { sku: 'DEV-LAMP-01', name: 'Floor Lamp', description: 'Warm 2700K floor lamp.',
        category: 'lighting_ambient', dimensions_metric: [0.35, 1.6, 0.35], price_cents: 24900,
        retailer_id: '00000000-0000-0000-0000-0000000000aa', retailer_name: 'Dev Retailer' },
      { sku: 'DEV-SIDE-01', name: 'Walnut Sideboard', description: 'Six-drawer walnut sideboard.',
        category: 'storage_credenza', dimensions_metric: [1.6, 0.75, 0.45], price_cents: 149900,
        retailer_id: '00000000-0000-0000-0000-0000000000aa', retailer_name: 'Dev Retailer' },
    ]),
  }).catch((e) => console.log('catalogue skipped:', String(e).slice(0, 120)));
}
console.log('catalog  ok');

console.log(`\nDEV_BYPASS_USER_ID="${userId}"`);
console.log(`open: http://localhost:3040/?sessionId=${sessionId}`);
