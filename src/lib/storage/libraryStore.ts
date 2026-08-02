// src/lib/storage/libraryStore.ts
//
// This app has no database — generation metadata originally lived entirely
// as metadata.json files under public/generated/<id>/. That's fine on a
// machine with persistent disk, but breaks the moment the backend runs on
// an ephemeral filesystem (Render Free, Railway, Fly.io) or behind more
// than one instance, because the directory listing IS the source of truth
// for the library/calendar/drafts pages.
//
// Rather than bolt on a separate paid database service, this module reuses
// the Cloudinary account the app already requires and stores a single JSON
// "manifest" object (id -> record) as a raw Cloudinary asset. Local disk is
// still used as a fast working directory during generation (see
// PipelineRunner), but every record that needs to survive past the current
// request is synced here, and local temp files are deleted once that sync
// succeeds.
//
// Reads always go through Cloudinary's Admin API to resolve the *current*
// version of the manifest, then fetch that versioned URL — versioned URLs
// are unique per upload, so the CDN never serves stale data the way a bare
// unversioned URL could.

import { cloudinary, CLOUDINARY_ROOT_FOLDER } from "./cloudinaryClient";
import axios from "axios";

const MANIFEST_PUBLIC_ID = `${CLOUDINARY_ROOT_FOLDER}/library-manifest`;

export interface LibraryRecord {
  id: string;
  topic?: string;
  title?: string;
  description?: string;
  tags?: string[];
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  script?: unknown;
  schedule?: Record<string, unknown> | null;
  publish?: Record<string, unknown>;
  autoPublish?: boolean;
  youtubeId?: string;
  youtubeUrl?: string;
  youtubeStatus?: string;
  instagramMediaId?: string;
  instagramPermalink?: string;
  instagramStatus?: string;
  error?: string;
  [key: string]: unknown;
}

type Manifest = Record<string, LibraryRecord>;

async function fetchManifest(): Promise<Manifest> {
  try {
    const resource = await cloudinary.api.resource(MANIFEST_PUBLIC_ID, {
      resource_type: "raw",
    });

    const response = await axios.get(resource.secure_url, {
      responseType: "json",
      timeout: 15000,
      // The manifest can legitimately be `{}` — treat any 2xx as success.
      validateStatus: (status) => status >= 200 && status < 300,
    });

    if (response.data && typeof response.data === "object") {
      return response.data as Manifest;
    }
    return {};
  } catch (error: any) {
    // Not found yet (first run) — start with an empty manifest.
    if (error?.http_code === 404 || error?.response?.status === 404) {
      return {};
    }
    console.error("⚠️ Failed to load library manifest from Cloudinary:", error?.message || error);
    return {};
  }
}

async function persistManifest(manifest: Manifest): Promise<void> {
  const json = JSON.stringify(manifest);

  await new Promise<void>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: MANIFEST_PUBLIC_ID,
        overwrite: true,
        invalidate: true,
      },
      (error) => (error ? reject(error) : resolve())
    );
    uploadStream.end(Buffer.from(json, "utf8"));
  });
}

export async function listRecords(): Promise<LibraryRecord[]> {
  const manifest = await fetchManifest();
  return Object.values(manifest);
}

export async function getRecord(id: string): Promise<LibraryRecord | null> {
  const manifest = await fetchManifest();
  return manifest[id] ?? null;
}

export async function upsertRecord(
  id: string,
  patch: Partial<LibraryRecord>
): Promise<LibraryRecord> {
  const manifest = await fetchManifest();
  const existing = manifest[id] ?? { id };
  const updated: LibraryRecord = {
    ...existing,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  manifest[id] = updated;
  await persistManifest(manifest);
  return updated;
}

export async function deleteRecord(id: string): Promise<void> {
  const manifest = await fetchManifest();
  if (manifest[id]) {
    delete manifest[id];
    await persistManifest(manifest);
  }
}
