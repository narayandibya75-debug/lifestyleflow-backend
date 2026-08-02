import {
  AnalyticsResponse,
  VideoAnalytics,
} from "./types";

import { loadMetadata } from "./metadata";
import {
  fetchSubscribers,
  fetchVideos,
} from "./youtube";

export async function buildAnalytics(): Promise<AnalyticsResponse> {

  const metadata = loadMetadata();

  const ids = metadata
    .map((m) => m.youtubeId)
    .filter(Boolean) as string[];

  const youtubeVideos = await fetchVideos(ids);

  const videos: VideoAnalytics[] = [];

  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;

  for (const meta of metadata) {

    const yt = youtubeVideos.find(
      (v) => v.id === meta.youtubeId
    );

    if (!yt) continue;

    const views = Number(
      yt.statistics?.viewCount ?? 0
    );

    const likes = Number(
      yt.statistics?.likeCount ?? 0
    );

    const comments = Number(
      yt.statistics?.commentCount ?? 0
    );

    totalViews += views;
    totalLikes += likes;
    totalComments += comments;

    videos.push({
      youtubeId: meta.youtubeId!,
      youtubeUrl: meta.youtubeUrl,

      title:
        yt.snippet?.title ??
        meta.title ??
        "Untitled",

      thumbnail:
        yt.snippet?.thumbnails?.high?.url ??
        meta.thumbnail ??
        "",

      uploadedAt:
        meta.uploadedAt ??
        meta.createdAt ??
        "",

      views,
      likes,
      comments,
    });
  }

  videos.sort(
    (a, b) =>
      new Date(b.uploadedAt).getTime() -
      new Date(a.uploadedAt).getTime()
  );

  const subscribers =
    await fetchSubscribers();

  return {
    totalVideos: videos.length,

    totalViews,

    totalLikes,

    totalComments,

    subscribers,

    watchHours: (
      totalViews * 0.45
    ).toFixed(1),

    dailyViews: videos.map((v) => ({
      date: new Date(v.uploadedAt)
        .toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      views: v.views,
    })),

    videos,
  };
}