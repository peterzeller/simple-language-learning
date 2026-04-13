import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  productionBrowserSourceMaps: true,
  experimental: {
    serverSourceMaps: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
