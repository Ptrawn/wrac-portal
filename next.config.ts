import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents (partial prerendering) is intentionally OFF. This portal is
  // auth-gated on every route: each page reads the per-request session at the
  // top and redirect()s on it, so there is no cacheable static shell to
  // prerender. Leaving it on breaks `next build` ("Uncached data accessed
  // outside <Suspense>") for no benefit. Standard dynamic SSR is the right fit.
  cacheComponents: false,
};

export default nextConfig;
