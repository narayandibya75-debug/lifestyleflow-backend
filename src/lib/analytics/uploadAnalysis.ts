import { VideoAnalytics } from "./types";

export function analyzeUploadTimes(videos: VideoAnalytics[]) {
  const hourStats: Record<number, { views: number; count: number }> = {};
  const dayStats: Record<string, { views: number; count: number }> = {};

  for (const video of videos) {
    const date = new Date(video.uploadedAt);

    const hour = date.getHours();

    const day = date.toLocaleDateString("en-US", {
      weekday: "long",
    });

    if (!hourStats[hour]) {
      hourStats[hour] = {
        views: 0,
        count: 0,
      };
    }

    hourStats[hour].views += video.views;
    hourStats[hour].count++;

    if (!dayStats[day]) {
      dayStats[day] = {
        views: 0,
        count: 0,
      };
    }

    dayStats[day].views += video.views;
    dayStats[day].count++;
  }

  let bestHour = 0;
  let bestHourAverage = 0;

  Object.entries(hourStats).forEach(([hour, stats]) => {
    const avg = stats.views / stats.count;

    if (avg > bestHourAverage) {
      bestHourAverage = avg;
      bestHour = Number(hour);
    }
  });

  let bestDay = "N/A";
  let bestDayAverage = 0;

  Object.entries(dayStats).forEach(([day, stats]) => {
    const avg = stats.views / stats.count;

    if (avg > bestDayAverage) {
      bestDayAverage = avg;
      bestDay = day;
    }
  });

  return {
    bestUploadTime: {
      hour: bestHour,
      averageViews: Math.round(bestHourAverage),
      videosAnalyzed: videos.length,
    },

    bestUploadDay: {
      day: bestDay,
      averageViews: Math.round(bestDayAverage),
    },
  };
}