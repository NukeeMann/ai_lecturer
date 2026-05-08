import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse pulls in pdfjs-dist, which uses a runtime dynamic `import` to
  // load its worker (`./pdf.worker.mjs`). Turbopack/webpack rewrites that
  // path against the bundled chunks dir and the lookup fails at runtime.
  // Marking these packages external keeps the imports as plain Node
  // resolutions so the worker module is found in node_modules.
  // unzipper has conditional `require('@aws-sdk/client-s3')` inside its s3
  // helpers (we don't use them, but Turbopack still tries to resolve the
  // require). Mark it external so it's resolved at runtime via plain Node
  // module lookup, mirroring the pdf-parse / pdfjs-dist treatment.
  // puppeteer-core ships dynamic requires (e.g. websocket transports) that
  // Turbopack can't statically resolve. Mark it external so it's loaded via
  // plain Node module resolution at runtime.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "unzipper", "puppeteer-core"],
};

export default nextConfig;
