import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Health imports upload a WHOOP export zip (a few MB at most) through a server action.
      bodySizeLimit: "32mb",
    },
  },
};

export default nextConfig;
