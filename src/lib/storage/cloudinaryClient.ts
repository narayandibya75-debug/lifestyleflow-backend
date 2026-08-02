// src/lib/storage/cloudinaryClient.ts
//
// Single shared Cloudinary configuration used by every storage helper
// (video uploads, thumbnail uploads, and the JSON "library manifest" that
// replaces local-disk persistence — see libraryStore.ts).
//
// Cloudinary is the only piece of paid-but-free-tier-friendly infrastructure
// this backend depends on, and it's reused here as our metadata store too so
// we don't have to introduce a separate database service just to survive an
// ephemeral filesystem (Render Free, Railway, Fly.io, etc. all recycle local
// disk on redeploy/restart, and horizontally-scaled instances don't share it
// at all).

import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  throw new Error(
    "Missing Cloudinary environment variables. Please check:\n" +
      `  - CLOUDINARY_CLOUD_NAME: ${cloudName ? "✅" : "❌"}\n` +
      `  - CLOUDINARY_API_KEY: ${apiKey ? "✅" : "❌"}\n` +
      `  - CLOUDINARY_API_SECRET: ${apiSecret ? "✅" : "❌"}`
  );
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
});

// Root folder for everything this app stores in Cloudinary: rendered
// videos, thumbnails, and the JSON manifest that stands in for a database.
export const CLOUDINARY_ROOT_FOLDER = "LifestyleFlowAI";

export { cloudinary };
