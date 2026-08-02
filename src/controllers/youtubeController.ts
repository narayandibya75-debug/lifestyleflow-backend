// src/controllers/youtubeController.ts
// Ported from: app/api/youtube/status/route.ts, app/api/youtube/connect/route.ts,
//              app/api/youtube/callback/route.ts, app/api/youtube/upload/route.ts,
//              app/api/youtube/retry/route.ts

import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { google } from "googleapis";

import { oauth2Client, SCOPES } from "../lib/youtube";
import { uploadVideo } from "../lib/uploadYoutube";
import { getRecord, upsertRecord } from "../lib/storage/libraryStore";

export async function youtubeStatus(_req: Request, res: Response) {
  const tokenPath = path.join(process.cwd(), "data", "youtube-token.json");

  return res.json({
    connected: fs.existsSync(tokenPath),
  });
}

export async function youtubeConnect(_req: Request, res: Response) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  return res.redirect(authUrl);
}

export async function youtubeCallback(req: Request, res: Response) {
  const code = req.query.code as string | undefined;

  if (!code) {
    return res.status(400).json({ error: "Authorization code missing." });
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  try {
    const { tokens } = await client.getToken(code);

    console.log("\n🔑 ====== YOUR REFRESH TOKEN ====== 🔑");
    console.log(tokens.refresh_token);
    console.log("=====================================\n");

    return res.json({
      message:
        "Authorization complete! Copy the refresh token from your terminal log.",
      token: tokens.refresh_token,
    });
  } catch (error: any) {
    console.error("OAuth Exchange Failed:", error);
    return res.status(500).json({ error: error.message });
  }
}

export async function youtubeUpload(req: Request, res: Response) {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Missing video id" });
    }

    const result = await uploadVideo(id);

    return res.json({
      success: true,
      videoId: result.youtubeId,
      url: result.youtubeUrl,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function youtubeRetry(req: Request, res: Response) {
  try {
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: "Missing video id" });
    }

    const record = await getRecord(id);

    if (!record) {
      return res.status(404).json({ success: false, error: "Metadata not found" });
    }

    await upsertRecord(id, { status: "retrying" });

    // uploadVideo() rehydrates the local metadata/video file from Cloudinary
    // if the local temp folder was already cleaned up — see
    // lib/storage/rehydrate.ts
    const result: any = await uploadVideo(id);

    await upsertRecord(id, {
      status: "completed",
      youtubeId: result.youtubeId,
      youtubeUrl: result.youtubeUrl,
      youtubeStatus: "completed",
    });

    return res.json({
      success: true,
      youtubeId: result.youtubeId,
      youtubeUrl: result.youtubeUrl,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
