// src/lib/storage/rehydrate.ts
//
// Deferred actions (scheduled YouTube/Instagram publish, manual "Publish"
// click from the library, /youtube/retry) run in a later request than the
// one that generated the video, by which point PipelineRunner has already
// deleted the local temp folder (see PipelineRunner.cleanupLocalFolder).
// These flows still expect public/generated/<id>/metadata.json and
// final_video.mp4 to exist on disk, so this helper recreates them on demand
// from the Cloudinary-backed manifest + the already-uploaded video URL.
//
// This is what makes "never rely on local disk persistence" true in
// practice: local disk becomes a rebuildable cache, not a source of truth.

import fs from "fs";
import path from "path";
import { getRecord } from "./libraryStore";
import { downloadFileToLocal } from "./uploadCloudinary";

function folderFor(id: string) {
  return path.join(process.cwd(), "public", "generated", id);
}

/**
 * Ensures public/generated/<id>/metadata.json exists locally, restoring it
 * from the manifest if needed. Returns the folder path.
 */
export async function ensureLocalMetadata(id: string): Promise<string> {
  const folder = folderFor(id);
  const metadataPath = path.join(folder, "metadata.json");

  if (fs.existsSync(metadataPath)) {
    return folder;
  }

  const record = await getRecord(id);
  if (!record) {
    throw new Error(`No generation found for id: ${id}`);
  }

  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(metadataPath, JSON.stringify(record, null, 2), "utf8");

  if (record.script) {
    fs.writeFileSync(
      path.join(folder, "content.json"),
      typeof record.script === "string" ? record.script : JSON.stringify(record.script),
      "utf8"
    );
  }

  return folder;
}

/**
 * Ensures the rendered video file exists locally (downloading it back from
 * Cloudinary if it was already cleaned up), for flows like the YouTube
 * uploader that read the raw file from disk instead of a URL.
 */
export async function ensureLocalVideoFile(id: string): Promise<string> {
  const folder = await ensureLocalMetadata(id);
  const videoPath = path.join(folder, "final_video.mp4");

  if (fs.existsSync(videoPath)) {
    return videoPath;
  }

  const record = await getRecord(id);
  if (!record?.videoUrl) {
    throw new Error(`No stored video URL for id: ${id}, cannot rehydrate final_video.mp4`);
  }

  console.log(`♻️ Rehydrating local video for ${id} from Cloudinary...`);
  await downloadFileToLocal(record.videoUrl, videoPath);
  return videoPath;
}

/**
 * Ensures the thumbnail exists locally, downloading it back from Cloudinary
 * if needed. Best-effort — returns null if there's no thumbnail on record.
 */
export async function ensureLocalThumbnail(id: string): Promise<string | null> {
  const folder = await ensureLocalMetadata(id);
  const thumbnailPath = path.join(folder, "thumbnail.jpg");

  if (fs.existsSync(thumbnailPath)) {
    return thumbnailPath;
  }

  const record = await getRecord(id);
  if (!record?.thumbnailUrl) {
    return null;
  }

  await downloadFileToLocal(record.thumbnailUrl, thumbnailPath);
  return thumbnailPath;
}
