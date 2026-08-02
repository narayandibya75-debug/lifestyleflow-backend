export interface Metadata {
  youtubeId?: string;
  youtubeUrl?: string;
  title?: string;
  thumbnail?: string;
  createdAt?: string;
  uploadedAt?: string;
}

export interface VideoAnalytics {
  youtubeId: string;
  title: string;
 thumbnail: string;
 youtubeUrl?: string;

  views: number;
  likes: number;
  comments: number;

  uploadedAt: string;
}

export interface AnalyticsResponse {
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  subscribers: number;
  watchHours: string;
  dailyViews: {
    date: string;
    views: number;
  }[];
  videos: VideoAnalytics[];
}