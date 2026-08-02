import { google } from "googleapis";

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  // NOTE: was `NEXT_PUBLIC_APP_URL` in the old Next.js monolith. That prefix
  // is a Next.js-only convention for client-exposed vars and has no meaning
  // in this Express backend, so it's renamed to BACKEND_URL. Update your
  // Google Cloud Console OAuth redirect URI to match this backend's public
  // URL (e.g. https://your-backend.onrender.com/api/youtube/callback).
  `${process.env.BACKEND_URL}/api/youtube/callback`
);

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];