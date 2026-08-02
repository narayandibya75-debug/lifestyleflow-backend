export interface VideoAnalytics {
  youtubeId?: string;
  youtubeUrl?: string;

  instagramMediaId?: string;
  instagramPermalink?: string;
  instagramStatus?: string;

  title: string;
  thumbnail: string;

  uploadedAt: string;

  views: number;
  likes: number;
  comments: number;

  status?: string;
}

export interface MetadataFile {
  topic: string;
  status: string;

  youtubeId?: string;
  youtubeUrl?: string;

  instagramMediaId?: string;
  instagramPermalink?: string;
  instagramStatus?: string;
  instagramError?: string;

  cloudinaryUrl?: string;

  title: string;
  thumbnail: string;

  uploadedAt?: string;
  createdAt: string;
}

export interface DashboardAnalytics {
  totalViews: number;
  totalLikes: number;
  totalComments: number;

  totalYoutubeVideos: number;
  totalInstagramVideos: number;

  dailyViews: {
    date: string;
    views: number;
  }[];

  videos: {
    id: string;

    title: string;
    thumbnail: string;

    youtubeUrl?: string;
    instagramUrl?: string;

    youtubeViews?: number;
    instagramViews?: number;

    uploadedAt: string;
  }[];
}