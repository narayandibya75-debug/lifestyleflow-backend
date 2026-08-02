// src/controllers/analyticsController.ts
// Ported from: app/api/analytics/route.ts, app/api/analytics/update/route.ts

import { Request, Response } from "express";

import { readMetadata } from "../lib/analytics/metadata";
import { fetchYoutubeAnalytics } from "../lib/analytics/youtube";
import { calculateStorage } from "../lib/analytics/storage";
import { buildSummary } from "../lib/analytics/summary";
import { analyzeUploadTimes } from "../lib/analytics/uploadAnalysis";

import { CACHE_TIME } from "../lib/analyticsUpdate/constants";
import { getCache, setCache } from "../lib/analyticsUpdate/cache";
import { buildAnalytics } from "../lib/analyticsUpdate/analytics";

export async function analyticsHandler(_req: Request, res: Response) {
  try {
    const metadata = readMetadata();
    const summary = buildSummary(metadata);
    const storage = calculateStorage();
    const youtube = await fetchYoutubeAnalytics(metadata);

    const dailyViews = youtube.videos.map((video) => ({
      date: new Date(video.uploadedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      views: video.views,
    }));

    const uploadAnalysis = analyzeUploadTimes(youtube.videos);
    const watchHours = Number((youtube.totals.views * 0.45).toFixed(1));

    return res.json({
      ...summary,
      totalViews: youtube.totals.views,
      totalLikes: youtube.totals.likes,
      totalComments: youtube.totals.comments,
      subscribers: youtube.subscribers,
      watchHours,
      storage,
      dailyViews,
      videos: youtube.videos,
      ...uploadAnalysis,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load analytics." });
  }
}

export async function analyticsUpdateHandler(_req: Request, res: Response) {
  const cached = getCache();

  if (cached) {
    return res.json(cached);
  }

  const analytics = await buildAnalytics();
  setCache(analytics, CACHE_TIME);

  return res.json(analytics);
}
