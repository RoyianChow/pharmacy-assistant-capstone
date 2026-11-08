import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const headers = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/demo/classifier/resnet18-caf5359a14d1.onnx", headers },
      { source: "/demo/classifier/ort/:version/:file", headers },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
