import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to the repo root (one level up) so the
  // shared demo-data in `../shared/demo-data` — imported via the `@shared/*`
  // alias — is inside the root and gets compiled. Files outside the workspace
  // root are not compiled by Turbopack.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
