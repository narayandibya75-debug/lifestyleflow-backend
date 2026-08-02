import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { oauth2Client } from "./youtube";

export async function getVideoAnalytics(videoId: string) {
  const tokenPath = path.join(
    process.cwd(),
    "data",
    "youtube-token.json"
  );

  oauth2Client.setCredentials(
    JSON.parse(fs.readFileSync(tokenPath, "utf8"))
  );

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client,
  });

  const res = await youtube.videos.list({
    part: ["statistics", "snippet"],
    id: [videoId],
  });

  if (!res.data.items?.length) {
    return null;
  }

  const item = res.data.items[0];

  return {
    views: Number(item.statistics?.viewCount || 0),
    likes: Number(item.statistics?.likeCount || 0),
    comments: Number(item.statistics?.commentCount || 0),
    title: item.snippet?.title,
    thumbnail:
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.default?.url,
  };
}