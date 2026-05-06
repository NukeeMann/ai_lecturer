import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse pulls in pdfjs-dist, which uses a runtime dynamic `import` to
  // load its worker (`./pdf.worker.mjs`). Turbopack/webpack rewrites that
  // path against the bundled chunks dir and the lookup fails at runtime.
  // Marking these packages external keeps the imports as plain Node
  // resolutions so the worker module is found in node_modules.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
