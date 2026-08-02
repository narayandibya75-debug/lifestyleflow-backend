// src/lib/storage/uploadCloudinary.ts
//
// Uploads generated media (final video + thumbnail) to Cloudinary and
// downloads it back down to local disk on demand. This is the boundary
// that keeps the app "storage-agnostic": PipelineRunner writes to a
// temporary local folder while processing, then everything that needs to
// survive past that request (or past a container restart) goes through
// here to Cloudinary. Nothing downstream should assume local disk is
// persistent — see rehydrate.ts for the read-back side of this contract.

import { cloudinary, CLOUDINARY_ROOT_FOLDER } from "./cloudinaryClient";
import fs from "fs";
import path from "path";
import axios from "axios";

function assertNonEmptyFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error(`File is empty (0 bytes): ${filePath}`);
  }
  return stats;
}

export async function uploadVideoToCloudinary(filePath: string): Promise<string> {
  const startTime = Date.now();

  console.log("☁️ Starting Cloudinary video upload...");
  console.log(`📁 File path: ${filePath}`);

  const stats = assertNonEmptyFile(filePath);
  console.log(`📦 File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

  try {
    console.log("📤 Uploading video to Cloudinary...");

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "video",
      folder: CLOUDINARY_ROOT_FOLDER,
      overwrite: true,
      use_filename: true,
      unique_filename: false,
      timeout: 120000,
    });

    const uploadDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ Video upload completed in ${uploadDuration}s`);

    if (!result?.secure_url || !result.secure_url.startsWith("https://")) {
      console.error("❌ Invalid Cloudinary response:", JSON.stringify(result, null, 2));
      throw new Error("Cloudinary upload failed: No secure_url in response");
    }

    console.log(`✅ Video uploaded: ${result.secure_url}`);
    return result.secure_url;
  } catch (error) {
    console.error("❌ Cloudinary video upload failed:", error);
    throw new Error(
      `Cloudinary upload failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function uploadThumbnailToCloudinary(filePath: string): Promise<string> {
  console.log("☁️ Starting Cloudinary thumbnail upload...");

  if (!fs.existsSync(filePath)) {
    // Thumbnails are best-effort — a missing thumbnail shouldn't fail the
    // whole pipeline, since the video itself already uploaded successfully.
    console.warn(`⚠️ Thumbnail not found, skipping upload: ${filePath}`);
    return "";
  }
  assertNonEmptyFile(filePath);

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "image",
      folder: `${CLOUDINARY_ROOT_FOLDER}/thumbnails`,
      overwrite: true,
      use_filename: true,
      unique_filename: false,
      timeout: 60000,
    });

    if (!result?.secure_url) {
      throw new Error("Cloudinary upload failed: No secure_url in response");
    }

    console.log(`✅ Thumbnail uploaded: ${result.secure_url}`);
    return result.secure_url;
  } catch (error) {
    console.error("❌ Cloudinary thumbnail upload failed:", error);
    // Non-fatal — return empty string and let the caller decide.
    return "";
  }
}

/**
 * Downloads a remote file (typically a Cloudinary-hosted URL) to a local
 * path, creating parent directories as needed. Used to rehydrate a working
 * folder when a deferred action (scheduled publish, retry, manual re-publish)
 * needs the raw file again after the original temp folder was cleaned up.
 */
export async function downloadFileToLocal(url: string, destPath: string): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const response = await axios.get(url, { responseType: "stream", timeout: 120000 });

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on("finish", () => resolve());
    writer.on("error", reject);
  });
}
