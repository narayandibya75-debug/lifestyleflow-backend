// src/controllers/libraryController.ts
// Ported from: app/api/library/route.ts, app/api/library/[id]/route.ts,
//              app/api/library/delete/route.ts, app/api/library/schedule/route.ts
//
// Reads/writes the Cloudinary-backed manifest (lib/storage/libraryStore.ts)
// instead of scanning public/generated on local disk, since that folder is
// not guaranteed to persist across restarts or be shared across instances.

import { Request, Response } from "express";
import {
  listRecords,
  getRecord,
  upsertRecord,
  deleteRecord,
} from "../lib/storage/libraryStore";

export async function listLibrary(_req: Request, res: Response) {
  const records = await listRecords();

  const videos = records
    // Only list generations that actually finished rendering a video.
    .filter((record) => !!record.videoUrl)
    .map((record) => ({
      id: record.id,
      topic: record.topic,
      createdAt: record.createdAt,
      status: record.status,
      video: record.videoUrl,
      thumbnail: record.thumbnailUrl,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );

  return res.json(videos);
}

export async function getLibraryItem(req: Request, res: Response) {
  const id = req.params.id as string;

  const record = await getRecord(id);

  if (!record) {
    return res.status(404).json({ error: "Video not found" });
  }

  let script: unknown = {};
  if (typeof record.script === "string") {
    try {
      script = JSON.parse(record.script);
    } catch {
      script = record.script;
    }
  } else if (record.script) {
    script = record.script;
  }

  return res.json({
    metadata: record,
    script,
    video: record.videoUrl,
    thumbnail: record.thumbnailUrl,
  });
}

export async function deleteLibraryItem(req: Request, res: Response) {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: "Missing video id." });
    }

    await deleteRecord(id);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
}

export async function scheduleLibraryItem(req: Request, res: Response) {
  try {
    const { id, date, time, visibility } = req.body;

    if (!id || !date || !time || !visibility) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const record = await getRecord(id);

    if (!record) {
      return res.status(404).json({ error: "Video not found." });
    }

    const schedule = {
      topic: record.topic ?? "",
      date,
      time,
      visibility,
      status: "scheduled",
      createdAt: new Date().toISOString(),
    };

    await upsertRecord(id, { schedule });

    return res.json({ success: true, schedule });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to save schedule." });
  }
}
