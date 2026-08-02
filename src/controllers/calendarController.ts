// src/controllers/calendarController.ts
// Ported from: app/api/calendar/route.ts, app/api/drafts/route.ts
//
// Reads the Cloudinary-backed manifest (lib/storage/libraryStore.ts)
// instead of scanning public/generated on local disk — see
// libraryController.ts for the same rationale.

import { Request, Response } from "express";
import { listRecords } from "../lib/storage/libraryStore";

export async function calendarHandler(_req: Request, res: Response) {
  const records = await listRecords();

  const videos = records
    .filter((record) => !!record.schedule)
    .map((record) => ({
      id: record.id,
      topic: record.topic,
      title: record.title,
      thumbnail: record.thumbnailUrl,
      status: record.status,
      autoPublish: record.autoPublish ?? false,
      youtubeUrl: record.youtubeUrl,
      instagramPermalink: record.instagramPermalink,
      schedule: record.schedule,
    }));

  return res.json(videos);
}

export async function draftsHandler(_req: Request, res: Response) {
  const records = await listRecords();

  const drafts = records
    .filter((record) => record.status === "draft")
    .map((record) => ({
      id: record.id,
      topic: record.topic,
      title: record.title || record.topic,
      thumbnail: record.thumbnailUrl || "/placeholder.png",
      createdAt: record.createdAt,
      status: record.status,
      autoPublish: record.autoPublish ?? false,
      youtubeUrl: record.youtubeUrl,
      instagramPermalink: record.instagramPermalink,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );

  return res.json(drafts);
}
