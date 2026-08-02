// src/controllers/publishController.ts
// Ported from: app/api/publish/route.ts
//
// This is a deferred action — the user can click "Publish" on a video from
// the library well after the generation request finished, by which point
// PipelineRunner has already deleted the local temp folder. We read the
// video's record from the Cloudinary-backed manifest, and rehydrate.ts
// pulls the raw file back down from Cloudinary only if uploadVideo() (the
// YouTube path) actually needs it on disk.

import { Request, Response } from "express";
import { getRecord, upsertRecord } from "../lib/storage/libraryStore";
import { uploadVideo } from "../lib/uploadYoutube";
import { uploadInstagram } from "../lib/uploadInstagram";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "An unknown error occurred";
  }
}

export async function publishHandler(req: Request, res: Response) {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: "Missing video id." });
    }

    const record = await getRecord(id);

    if (!record) {
      return res.status(404).json({ success: false, error: "Metadata not found." });
    }

    // Already published?
    if (record.status === "published") {
      return res.json({
        success: true,
        youtubeUrl: record.youtubeUrl,
        instagramUrl: record.instagramPermalink,
      });
    }

    // Upload YouTube (uploadVideo() rehydrates the local file from
    // Cloudinary internally if it isn't already on disk — see
    // lib/storage/rehydrate.ts)
    const youtube = await uploadVideo(id);

    const updates: Record<string, unknown> = {
      youtubeId: (youtube as any).youtubeId ?? "",
      youtubeUrl: (youtube as any).youtubeUrl ?? "",
    };

    // Upload Instagram (uses the Cloudinary URL directly, no local file needed)
    if (record.videoUrl) {
      try {
        const instagram = await uploadInstagram({
          generationId: id,
          cloudinaryUrl: record.videoUrl,
          uploadMode: "immediate",
        });

        updates.instagramMediaId = instagram.mediaId ?? "";
        updates.instagramPermalink = instagram.permalink ?? "";
        updates.instagramStatus = instagram.status ?? "published";
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        console.error("Instagram upload failed:", message);
        updates.instagramStatus = "failed";
        updates.instagramError = message;
      }
    }

    updates.status = "published";
    updates.uploadedAt = new Date().toISOString();

    const updated = await upsertRecord(id, updates);

    return res.json({
      success: true,
      youtubeUrl: updated.youtubeUrl,
      instagramUrl: updated.instagramPermalink,
    });
  } catch (err: unknown) {
    console.error(err);
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Publish failed.",
    });
  }
}
