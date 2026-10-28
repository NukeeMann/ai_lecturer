import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run dev:lan`: Next dev blocks HMR/dev resources from non-localhost
  // origins unless allowed. Private-range wildcards cover home/hotspot LANs.
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*", "172.17.*.*", "172.18.*.*", "172.19.*.*", "172.20.*.*",
    "172.21.*.*", "172.22.*.*", "172.23.*.*", "172.24.*.*", "172.25.*.*",
    "172.26.*.*", "172.27.*.*", "172.28.*.*", "172.29.*.*", "172.30.*.*",
    "172.31.*.*",
    "*.local",
  ],
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
  // sql.js (Anki .apkg builder) loads its sql-wasm.wasm from its own
  // directory at runtime — external keeps that lookup pointing at
  // node_modules instead of the bundled chunks dir.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "unzipper", "puppeteer-core", "sql.js"],
};

export default nextConfig;
