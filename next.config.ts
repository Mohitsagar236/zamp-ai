import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.INVOICELENS_DIST_DIR ?? ".next",
  serverExternalPackages: ["pdfjs-dist"],
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};
export default config;
