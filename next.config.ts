import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  transpilePackages: ["three"],
  // hCaptcha refuses localhost and 127.0.0.1 as hostnames -- the widget
  // shows "localhost detected" and its token will not verify -- and they
  // cannot be added to a site's hostname list either. lvh.me is a public
  // DNS name that resolves to 127.0.0.1, so browsing the dev server at
  // http://lvh.me:3000 gives hCaptcha a real hostname to check against.
  // Next blocks cross-origin requests to dev-only assets, hence this.
  allowedDevOrigins: ["lvh.me"],
};

export default nextConfig;
