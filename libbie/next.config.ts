import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app lives in this subdirectory; pin the workspace root so Next doesn't
  // pick up an unrelated parent lockfile.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
