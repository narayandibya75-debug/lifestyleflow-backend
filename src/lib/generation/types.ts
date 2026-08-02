// /lib/generation/types.ts

export type PipelineStepKey =
  | "script"
  | "voice"
  | "music_select"
  | "music"
  | "stock"
  | "timeline"
  | "trim"
  | "captions"
  | "merge"
  | "render"
  | "thumbnail"
  | "youtube_upload"
  | "instagram_upload";

export interface PipelineState {
  script: boolean;
  voice: boolean;
  music_select: boolean;
  music: boolean;
  stock: boolean;
  timeline: boolean;
  trim: boolean;
  captions: boolean;
  merge: boolean;
  render: boolean;
  thumbnail: boolean;
  youtube_upload: boolean;
  instagram_upload: boolean;
}

export const DEFAULT_PIPELINE_STATE: PipelineState = {
  script: true,
  voice: true,
  music_select: true,
  music: true,
  stock: true,
  timeline: true,
  trim: true,
  captions: true,
  merge: true,
  render: true,
  thumbnail: true,
  youtube_upload: true,
  instagram_upload: true,
};

export type PublishMode = "now" | "scheduled";

export interface PlatformPublishSettings {
  enabled: boolean;
  mode: PublishMode;
  scheduledAt?: string | null;
}

export interface YoutubePublishSettings extends PlatformPublishSettings {
  visibility: "public" | "private" | "unlisted";
}

export interface InstagramPublishSettings extends PlatformPublishSettings {}

export interface PublishSettings {
  youtube: YoutubePublishSettings;
  instagram: InstagramPublishSettings;
}

export interface GenerationParams {
  topic: string;
  style: string;
  length: number;
  language: string;
  voiceGender?: "male" | "female"; // Made optional with default
  uploadMode?: "upload" | "local" | "library";
  autoPublish?: boolean; // Made optional
  // ✅ Make publish optional
  publish?: PublishSettings;
  
  // ✅ Add flat fallback properties (for backward compatibility)
  youtubeEnabled?: boolean;
  youtubeVisibility?: "public" | "private" | "unlisted";
  youtubeMode?: PublishMode;
  youtubeScheduledAt?: string;
  instagramEnabled?: boolean;
  instagramMode?: PublishMode;
  instagramScheduledAt?: string;
  visualSource: "pixel" | "ai";
}
// Helper to normalize/construct GenerationParams with sensible defaults
export function normalizeGenerationParams(
  params: Partial<GenerationParams> = {}
): GenerationParams {
  const voiceGender = params.voiceGender ?? "male";
  const uploadMode = params.uploadMode ?? "upload";
  const autoPublish = params.autoPublish ?? false;

  const publish: PublishSettings = params.publish ?? {
    youtube: {
      enabled: params.youtubeEnabled ?? false,
      mode: params.youtubeMode ?? "now",
      visibility: params.youtubeVisibility ?? "public",
      scheduledAt: params.youtubeScheduledAt ?? null,
    },
    instagram: {
      enabled: params.instagramEnabled ?? false,
      mode: params.instagramMode ?? "now",
      scheduledAt: params.instagramScheduledAt ?? null,
    },
  };

  return {
    topic: params.topic ?? "",
    style: params.style ?? "Tech",
    length: params.length ?? 60,
    language: params.language ?? "en",

    voiceGender,
    uploadMode,
    autoPublish,

    visualSource: params.visualSource ?? "pixel",

    publish,

    // Backward compatibility flat props
    youtubeEnabled: publish.youtube.enabled,
    youtubeVisibility: publish.youtube.visibility,
    youtubeMode: publish.youtube.mode,
    youtubeScheduledAt: publish.youtube.scheduledAt ?? undefined,

    instagramEnabled: publish.instagram.enabled,
    instagramMode: publish.instagram.mode,
    instagramScheduledAt: publish.instagram.scheduledAt ?? undefined,
  } as GenerationParams;
}

export interface StepDefinition {
  key: PipelineStepKey;
  step: number;
  metadataStep: string;
  runningMessage: string;
  skippedMessage: string;
  run: () => Promise<void>;
}
