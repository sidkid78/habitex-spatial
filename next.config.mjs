/** @type {import('next').NextConfig} */
const nextConfig = {
  // Testing on a real device means the dev server is reached over the LAN
  // rather than at localhost, and Next blocks cross-origin requests to
  // /_next/* by default so a hostile page cannot read your dev assets.
  // This names the hosts allowed to do it.
  //
  // Development only — Next ignores it in a production build — and it
  // needs updating if the machine's LAN address changes.
  // 127.0.0.1 and localhost are here because binding the dev server to
  // 0.0.0.0 (needed to reach it from a phone) makes Next treat even
  // local requests as cross-origin, which silently breaks HMR on the
  // development machine itself.
  // `*` matches exactly one hostname label, so *.trycloudflare.com
  // covers whatever name the quick tunnel generates this run —
  // worth doing because that name changes every restart, and a
  // stale entry shows up as HMR quietly dying rather than an error.
  //
  // WebXR still needs the tunnel: navigator.xr is a secure-context
  // API, so AR works over the tunnel's https and not over the LAN
  // address. localhost is exempt; 192.168.x.x is not.
  allowedDevOrigins: [
    '*.trycloudflare.com',
    '192.168.18.3',
    '127.0.0.1',
    'localhost',
  ],

  // Turbopack is the default bundler from Next 16. A `webpack` key here
  // makes the build refuse to start ("using Turbopack, with a `webpack`
  // config and no `turbopack` config"), so the extensionAlias trick that
  // worked on 15 is gone. Relative imports are written WITHOUT a .js
  // extension instead, which is what moduleResolution "bundler" expects
  // and what Turbopack resolves natively.
  turbopack: {},
};

export default nextConfig;
