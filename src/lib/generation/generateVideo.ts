// /lib/generation/generateVideo.ts

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { WritableStream } from "stream/web";

import { PipelineRunner } from "./PipelineRunner";
import { SSEEmitter } from "./SSEEmitter";
import { GenerationParams } from "./types";

interface GenerateVideoOptions {
  topic: string;

  style?: string;

  length?: number;

  language?: string;

  voiceGender?: "female" | "male";

  uploadMode?: "upload" | "local";

  autoPublish?: boolean;

  visualSource?: "pixel" | "ai";

  publish?: {
    youtube: {
      enabled: boolean;
      visibility: "public" | "private" | "unlisted";
      mode: "now" | "scheduled";
      scheduledAt?: string | null;
    };

    instagram: {
      enabled: boolean;
      mode: "now" | "scheduled";
      scheduledAt?: string | null;
    };
  };
}

export async function generateVideo(
  options: GenerateVideoOptions
): Promise<string> {
  const {
    topic,

    style = "Tech",

    length = 60,

    language = "en",

    voiceGender = "female",

    uploadMode = "upload",

    autoPublish = true,

    visualSource = "pixel",

    publish = {
      youtube: {
        enabled: true,
        visibility: "public",
        mode: "now",
        scheduledAt: null,
      },

      instagram: {
        enabled: true,
        mode: "now",
        scheduledAt: null,
      },
    },
  } = options;

  const generationId = uuidv4();

  const params: GenerationParams = {
    topic,
    style,
    length,

    language,

    voiceGender,

    uploadMode,

    autoPublish,

    visualSource,

    publish,
  };

  const sseWriter = new WritableStream<Uint8Array>({
    write() {
      return Promise.resolve();
    },
  }).getWriter();

  const sse = new SSEEmitter(sseWriter);

  const pipeline = new PipelineRunner(
    sse,
    params,
    generationId
  );

  await pipeline.run();

  return generationId;
}

export async function getVideoStatus(
  generationId: string
): Promise<any> {
  const metadataPath = path.join(
    process.cwd(),
    "public",
    "generated",
    generationId,
    "metadata.json"
  );

  try {
    const metadata = JSON.parse(
      fs.readFileSync(metadataPath, "utf8")
    );

    return {
      id: generationId,
      status: metadata.status || "unknown",
      topic: metadata.topic,
      style: metadata.style,
      length: metadata.length,
      createdAt: metadata.createdAt,
      videoPath: metadata.video,
      thumbnail: metadata.thumbnail,
      youtubeUrl: metadata.youtubeUrl,
      instagramPermalink: metadata.instagramPermalink,
      ...metadata,
    };
  } catch {
    return {
      id: generationId,
      status: "not_found",
      error: "Generation not found",
    };
  }
}

export async function listGenerations(): Promise<any[]> {
  const generatedDir = path.join(
    process.cwd(),
    "public",
    "generated"
  );

  try {
    if (!fs.existsSync(generatedDir)) {
      return [];
    }

    const generations = fs.readdirSync(generatedDir);

    const results = [];

    for (const gen of generations) {
      const metadataPath = path.join(
        generatedDir,
        gen,
        "metadata.json"
      );

      if (!fs.existsSync(metadataPath)) continue;

      try {
        const metadata = JSON.parse(
          fs.readFileSync(metadataPath, "utf8")
        );

        results.push({
          id: gen,
          topic: metadata.topic,
          status: metadata.status,
          createdAt: metadata.createdAt,
          thumbnail: metadata.thumbnail,
        });
      } catch (err) {
        console.error(
          `Failed to read metadata for ${gen}:`,
          err
        );
      }
    }

    return results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
    );
  } catch (err) {
    console.error(err);
    return [];
  }
}