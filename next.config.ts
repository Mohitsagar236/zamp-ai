import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: [
    "pg",
    "pdfjs-dist",
    "@napi-rs/canvas",
    "tesseract.js",
  ],
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};
export default config;
