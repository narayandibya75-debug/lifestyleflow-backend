// src/controllers/authController.ts
// Ported from: app/api/auth/youtube/route.ts, app/api/auth/callback/youtube/route.ts
//
// NOTE: this duplicates youtubeConnect/youtubeCallback in youtubeController.ts
// almost exactly — that duplication already existed in the original app
// (two separate route trees hitting Google OAuth), so it's preserved as-is
// per "do not rewrite business logic unless necessary."

import { Request, Response } from "express";
import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI
);

export async function authYoutube(_req: Request, res: Response) {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
    prompt: "consent",
  });

  return res.redirect(url);
}

export async function authYoutubeCallback(req: Request, res: Response) {
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
