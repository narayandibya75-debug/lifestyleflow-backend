// src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import router from "./routes";

const app = express();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const NODE_ENV = process.env.NODE_ENV ?? "development";
const isProduction = NODE_ENV === "production";

// ---------------------------------------------------------------------------
// CORS — configured entirely from FRONTEND_URL, never hardcoded.
//
// FRONTEND_URL may be a single origin ("https://app.vercel.app") or a
// comma-separated list (useful when you have a production domain plus a
// preview-deploy domain, e.g. Vercel preview URLs). localhost is only ever
// allowed automatically outside production, so a misconfigured/missing
// FRONTEND_URL can't accidentally open CORS to everyone in production.
// ---------------------------------------------------------------------------
const configuredOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const allowedOrigins = isProduction
  ? configuredOrigins
  : [...new Set([...configuredOrigins, ...devOrigins])];

if (isProduction && allowedOrigins.length === 0) {
  console.warn(
    "⚠️ FRONTEND_URL is not set. No browser origin will be allowed to call this API in production."
  );
}

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header (server-to-server calls, curl, health checks) — allow.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));

// ---------------------------------------------------------------------------
// /generated static mount — DEV-ONLY CONVENIENCE, not the storage layer.
//
// Rendered videos/thumbnails are uploaded to Cloudinary as soon as they're
// ready (see lib/generation/PipelineRunner.ts + lib/storage/uploadCloudinary.ts)
// and every API response returns the Cloudinary URL, not a path under
// /generated. This mount just makes it convenient to poke at files in
// public/generated while a pipeline run is still in progress on a local
// machine; nothing in this app depends on it surviving a restart or being
// reachable from another instance, since local disk is never treated as
// persistent storage.
// ---------------------------------------------------------------------------
const generatedDir = path.join(process.cwd(), "public", "generated");
if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}
app.use("/generated", express.static(generatedDir));

// All API routes (mounted under /api to match the original Next.js
// `app/api/*` paths — this keeps existing OAuth redirect URIs etc.
// predictable: https://<backend>/api/youtube/callback, etc.)
app.use("/api", router);

app.listen(PORT, () => {
  console.log(`✅ Backend listening on http://localhost:${PORT} (${NODE_ENV})`);
});
