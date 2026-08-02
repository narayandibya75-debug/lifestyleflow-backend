// src/routes/index.ts
import { Router } from "express";

import { generateHandler } from "../controllers/generateController";
import {
  listLibrary,
  getLibraryItem,
  deleteLibraryItem,
  scheduleLibraryItem,
} from "../controllers/libraryController";
import { publishHandler } from "../controllers/publishController";
import { calendarHandler, draftsHandler } from "../controllers/calendarController";
import { trendsHandler } from "../controllers/trendsController";
import {
  youtubeStatus,
  youtubeConnect,
  youtubeCallback,
  youtubeUpload,
  youtubeRetry,
} from "../controllers/youtubeController";
import { authYoutube, authYoutubeCallback } from "../controllers/authController";
import {
  analyticsHandler,
  analyticsUpdateHandler,
} from "../controllers/analyticsController";

const router = Router();

// Health
router.get("/health", (_req, res) => res.json({ status: "ok" }));

// Generation (SSE) — GET, matches the original EventSource-based frontend call
router.get("/generate", generateHandler);

// Library
router.get("/library", listLibrary);
router.get("/library/:id", getLibraryItem);
router.post("/library/delete", deleteLibraryItem);
router.post("/library/schedule", scheduleLibraryItem);

// Publish
router.post("/publish", publishHandler);

// Calendar / Drafts
router.get("/calendar", calendarHandler);
router.get("/drafts", draftsHandler);

// Trends
router.get("/trends", trendsHandler);

// YouTube
router.get("/youtube/status", youtubeStatus);
router.get("/youtube/connect", youtubeConnect);
router.get("/youtube/callback", youtubeCallback);
router.post("/youtube/upload", youtubeUpload);
router.post("/youtube/retry", youtubeRetry);

// Auth (separate OAuth entry points that already existed alongside /youtube/*)
router.get("/auth/youtube", authYoutube);
router.get("/auth/callback/youtube", authYoutubeCallback);

// Analytics
router.get("/analytics", analyticsHandler);
router.get("/analytics/update", analyticsUpdateHandler);

export default router;
