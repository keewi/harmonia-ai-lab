import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Scores go through the password proxy on upload; several charts can top 10MB together.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
