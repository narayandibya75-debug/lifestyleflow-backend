import fs from "fs";
import { google } from "googleapis";
import { oauth2Client } from "@/lib/youtube";
import { TOKEN_PATH } from "./constants";

export function createYoutubeClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    return null;
  }

  oauth2Client.setCredentials(
    JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"))
  );

  return google.youtube({
    version: "v3",
    auth: oauth2Client,
  });
}

export async function fetchVideos(
  ids: string[]
) {
  const youtube = createYoutubeClient();

  if (!youtube || ids.length === 0) {
    return [];
  }

  const response = await youtube.videos.list({
    part: ["snippet", "statistics"],
    id: ids,
  });

  return response.data.items ?? [];
}

export async function fetchSubscribers() {
  const youtube = createYoutubeClient();

  if (!youtube) return 0;

  const response = await youtube.channels.list({
    mine: true,
    part: ["statistics"],
  });

  return Number(
    response.data.items?.[0]?.statistics
      ?.subscriberCount ?? 0
  );
}