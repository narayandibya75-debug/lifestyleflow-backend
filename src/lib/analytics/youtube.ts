import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { oauth2Client } from "@/lib/youtube";
import { absoluteMediaUrl } from "@/lib/absoluteMediaUrl";
import { MetadataFile, VideoAnalytics } from "./types";

export async function fetchYoutubeAnalytics(
  metadataList: MetadataFile[]
) {
  const tokenPath = path.join(
    process.cwd(),
    "data",
    "youtube-token.json"
  );

  if (!fs.existsSync(tokenPath)) {
    return {
      subscribers: 0,
      videos: [],
      totals: {
        views: 0,
        likes: 0,
        comments: 0,
      },
    };
  }

  oauth2Client.setCredentials(
    JSON.parse(fs.readFileSync(tokenPath, "utf8"))
  );

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client,
  });

  const videos: VideoAnalytics[] = [];

  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;

  for (const metadata of metadataList) {
    if (!metadata.youtubeId) continue;

    try {
      const response = await youtube.videos.list({
        part: ["snippet", "statistics"],
        id: [metadata.youtubeId],
      });

      const item = response.data.items?.[0];

      if (!item) continue;

      const views = Number(item.statistics?.viewCount ?? 0);
      const likes = Number(item.statistics?.likeCount ?? 0);
      const comments = Number(item.statistics?.commentCount ?? 0);

      totalViews += views;
      totalLikes += likes;
      totalComments += comments;

      videos.push({
        youtubeId: metadata.youtubeId,
        title: item.snippet?.title ?? metadata.title,
        thumbnail:
          item.snippet?.thumbnails?.high?.url ??
          absoluteMediaUrl(metadata.thumbnail),
        youtubeUrl: metadata.youtubeUrl ?? "",
        uploadedAt:
          metadata.uploadedAt ?? metadata.createdAt,
        views,
        likes,
        comments,
        status: metadata.status,
      });
    } catch (err) {
      console.error(err);
    }
  }

  let subscribers = 0;

  try {
    const channel = await youtube.channels.list({
      mine: true,
      part: ["statistics"],
    });

    subscribers = Number(
      channel.data.items?.[0]?.statistics
        ?.subscriberCount ?? 0
    );
  } catch {}

  videos.sort(
    (a, b) =>
      new Date(b.uploadedAt).getTime() -
      new Date(a.uploadedAt).getTime()
  );

  return {
    subscribers,

    videos,

    totals: {
      views: totalViews,
      likes: totalLikes,
      comments: totalComments,
    },
  };
}