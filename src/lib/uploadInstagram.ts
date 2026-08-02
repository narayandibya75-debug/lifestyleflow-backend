import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import {
  createReelContainer,
  waitForContainerReady,
  publishReel,
  getMedia,
} from "./instagram";

// Types
export interface UploadJob {
  id: string;
  generationId: string;
  platform: "instagram" | "youtube" | "tiktok" | "facebook" | "linkedin" | "threads";
  scheduledAt: string | null;
  status: "scheduled" | "queued" | "uploading" | "processing" | "completed" | "failed" | "retrying" | "cancelled";
  retries: number;
  maxRetries?: number;
  createdAt: string;
  updatedAt: string;
  metadata: {
    cloudinaryUrl: string;
    caption?: string;
    title?: string;
    description?: string;
    tags?: string[];
    [key: string]: any;
  };
  error?: string;
  errorDetails?: any;
  mediaId?: string;
  permalink?: string;
  publishedAt?: string;
}

export interface QueueStore {
  jobs: UploadJob[];
}

export interface UploadResult {
  success: boolean;
  queued?: boolean;
  uploaded?: boolean;
  platform: string;
  status: "scheduled" | "queued" | "uploading" | "processing" | "completed" | "failed" | "retrying" | "cancelled";
  scheduledAt?: string | null;
  mediaId?: string;
  permalink?: string;
  error?: string;
  jobId?: string;
  generationId?: string;
  publishedAt?: string;
}

export interface UploadOptions {
  generationId: string;
  cloudinaryUrl: string;
  caption?: string;
  uploadMode: "immediate" | "scheduled";
  scheduledAt?: string | null;
  metadata?: any;
  maxRetries?: number;
  onProgress?: (stage: string, message: string) => void;
}

// Constants
const QUEUE_PATH = path.join(process.cwd(), "data", "upload-queue.json");
const QUEUE_TEMP_PATH = path.join(process.cwd(), "data", "upload-queue.tmp");

// Atomic write function
async function atomicWrite(filePath: string, data: any): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  const dataStr = JSON.stringify(data, null, 2);

  try {
    await fs.promises.writeFile(tempPath, dataStr, "utf8");

    try {
      await fs.promises.rename(tempPath, filePath);
    } catch (renameError) {
      await fs.promises.copyFile(tempPath, filePath);
      await fs.promises.unlink(tempPath);
    }
  } catch (error) {
    try {
      await fs.promises.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// Load queue with atomic read
async function loadQueue(): Promise<QueueStore> {
  try {
    await fs.promises.access(QUEUE_PATH);
  } catch {
    // Queue doesn't exist, create it
    const emptyQueue: QueueStore = { jobs: [] };
    await atomicWrite(QUEUE_PATH, emptyQueue);
    return emptyQueue;
  }

  try {
    const raw = await fs.promises.readFile(QUEUE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    console.error("Failed to read queue, creating new:", error);
    const emptyQueue: QueueStore = { jobs: [] };
    await atomicWrite(QUEUE_PATH, emptyQueue);
    return emptyQueue;
  }
}

// Save queue with atomic write
async function saveQueue(queue: QueueStore): Promise<void> {
  await atomicWrite(QUEUE_PATH, queue);
}

// Process a single Instagram job
export async function processInstagramJob(job: UploadJob): Promise<UploadResult> {
  const metadataPath = path.join(
    process.cwd(),
    "public",
    "generated",
    job.generationId,
    "metadata.json"
  );

  console.log(`🔄 Processing Instagram job ${job.id} for generation ${job.generationId}`);

  try {
    // Load metadata
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));

    // Validate Cloudinary URL
    const cloudinaryUrl = job.metadata.cloudinaryUrl;
    if (!cloudinaryUrl || typeof cloudinaryUrl !== "string") {
      throw new Error("Cloudinary URL is missing or invalid");
    }

    // Check if it's a valid Cloudinary URL
    const isValidCloudinaryUrl =
      cloudinaryUrl.startsWith("https://") &&
      (cloudinaryUrl.includes("cloudinary.com") ||
        cloudinaryUrl.includes("res.cloudinary.com"));

    if (!isValidCloudinaryUrl) {
      throw new Error(
        `Invalid Cloudinary URL: ${cloudinaryUrl.substring(0, 50)}... (must be a valid Cloudinary URL)`
      );
    }

    // Update metadata status
    metadata.instagramStatus = "uploading";
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    // Build caption
    const title = metadata.translatedTitle ?? metadata.title ?? "";
    const description = metadata.translatedDescription ?? metadata.description ?? "";
    const hashtags =
      metadata.hashtags ??
      (metadata.tags || [])
        .map((t: string) => `#${t.replace(/\s+/g, "")}`)
        .join(" ");

    let caption = job.metadata.caption || [
      title,
      "",
      description,
      "",
      hashtags,
    ]
      .filter(Boolean)
      .join("\n");

    caption = caption.substring(0, 2200);

    // Store Cloudinary URL
    metadata.cloudinaryUrl = cloudinaryUrl;
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    // Create Reel Container
    console.log("🎬 Creating Instagram Reel container...");
    const creationId = await createReelContainer(cloudinaryUrl, caption);
    console.log("✅ Container created:", creationId);

    // Store creation ID
    metadata.instagramCreationId = creationId;
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    // Wait until ready with retry
    console.log("⏳ Waiting for container to be ready...");
    let containerReady = false;
    let retryCount = 0;
    const maxRetries = 5;
    let lastError: Error | null = null;

    while (!containerReady && retryCount < maxRetries) {
      try {
        await waitForContainerReady(creationId);
        containerReady = true;
        console.log("✅ Container is ready!");
      } catch (error) {
        retryCount++;
        lastError = error as Error;
        const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 15000);

        console.log(
          `⏳ Container not ready yet (attempt ${retryCount}/${maxRetries}). Waiting ${waitTime}ms...`
        );

        if (retryCount < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    if (!containerReady) {
      throw new Error(
        `Container ${creationId} not ready after ${maxRetries} attempts. Last error: ${lastError?.message || "Unknown error"}`
      );
    }

    // Publish
    console.log("📤 Publishing Reel...");
    const mediaId = await publishReel(creationId);
    console.log("✅ Reel published with ID:", mediaId);

    // Get Reel Details
    console.log("🔍 Fetching published reel details...");
    let media;
    try {
      media = await getMedia(mediaId);
      console.log("✅ Reel details retrieved");
    } catch (error) {
      console.warn("⚠️ Could not retrieve media details, but publish succeeded");
      media = {
        id: mediaId,
        permalink: `https://www.instagram.com/p/${mediaId}/`,
      };
    }

    // Update metadata
    metadata.instagramStatus = "uploaded";
    metadata.instagramMediaId = mediaId;
    metadata.instagramUrl = media.permalink || metadata.instagramUrl;
    metadata.instagramPermalink = media.permalink || metadata.instagramPermalink;
    metadata.instagramUploadedAt = new Date().toISOString();
    metadata.instagramCaption = caption;
    metadata.instagramRetryCount = retryCount;

    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    console.log("✅ Instagram upload completed successfully!");

    return {
      success: true,
      uploaded: true,
      platform: "instagram",
      status: "completed",
      mediaId,
      permalink: metadata.instagramPermalink,
      publishedAt: new Date().toISOString(),
      generationId: job.generationId,
    };
  } catch (error: any) {
    console.error("❌ Instagram upload failed:", error);

    // Update metadata with error
    try {
      const metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
      metadata.instagramStatus = "failed";
      metadata.instagramError = error.message || "Unknown error";
      metadata.instagramErrorDetails = {
        status: error.status,
        code: error.code,
        timestamp: new Date().toISOString(),
      };
      metadata.instagramFailedAt = new Date().toISOString();
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (metadataError) {
      console.error("Failed to update metadata:", metadataError);
    }

    throw error;
  }
}

// Main upload function
export async function uploadInstagram(options: UploadOptions): Promise<UploadResult> {
  const {
    generationId,
    cloudinaryUrl,
    caption,
    uploadMode,
    scheduledAt,
    metadata: additionalMetadata,
    maxRetries,
    onProgress,
  } = options;

  console.log(`📤 UploadInstagram called for generation ${generationId} with mode: ${uploadMode}`);

  // Helper for progress events
  const emitProgress = (stage: string, message: string) => {
    if (onProgress) {
      onProgress(stage, message);
    }
    console.log(`[${stage}] ${message}`);
  };

  const metadataPath = path.join(
    process.cwd(),
    "public",
    "generated",
    generationId,
    "metadata.json"
  );

  try {
    // Load metadata
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));

    // Check if already uploaded
    if (metadata.instagramStatus === "uploaded" || metadata.instagramMediaId) {
      console.log("⏭️ Instagram upload already completed. Skipping duplicate upload.");
      return {
        success: true,
        uploaded: true,
        platform: "instagram",
        status: "completed",
        mediaId: metadata.instagramMediaId,
        permalink: metadata.instagramPermalink,
        generationId,
        publishedAt: metadata.instagramUploadedAt,
      };
    }

    // Handle scheduled upload
    if (uploadMode === "scheduled") {
      emitProgress("Queued", `Scheduling Instagram upload for ${scheduledAt}`);

      // Create upload job
      const job: UploadJob = {
        id: uuidv4(),
        generationId,
        platform: "instagram",
        scheduledAt: scheduledAt || null,
        status: "scheduled",
        retries: 0,
        maxRetries: maxRetries || 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          cloudinaryUrl,
          caption,
          ...additionalMetadata,
        },
      };

      // Load queue
      const queue = await loadQueue();

      // Check for existing job
      const existingJobIndex = queue.jobs.findIndex(
        j => j.generationId === generationId && j.platform === "instagram"
      );

      if (existingJobIndex !== -1) {
        // Update existing job
        queue.jobs[existingJobIndex] = job;
      } else {
        // Add new job
        queue.jobs.push(job);
      }

      // Save queue
      await saveQueue(queue);

      // Update metadata
      metadata.instagramStatus = "scheduled";
      metadata.instagramScheduledAt = scheduledAt;
      metadata.uploadQueueId = job.id;
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      emitProgress("Scheduled", `Instagram upload scheduled for ${scheduledAt || "unspecified time"}`);

      return {
        success: true,
        queued: true,
        platform: "instagram",
        status: "scheduled",
        scheduledAt: scheduledAt || null,
        jobId: job.id,
        generationId,
      };
    }

    // Immediate upload
    emitProgress("Preparing", "Starting immediate Instagram upload...");

    // Validate Cloudinary URL
    if (!cloudinaryUrl || typeof cloudinaryUrl !== "string") {
      throw new Error("Cloudinary URL is missing or invalid");
    }

    const isValidCloudinaryUrl =
      cloudinaryUrl.startsWith("https://") &&
      (cloudinaryUrl.includes("cloudinary.com") ||
        cloudinaryUrl.includes("res.cloudinary.com"));

    if (!isValidCloudinaryUrl) {
      throw new Error(
        `Invalid Cloudinary URL: ${cloudinaryUrl.substring(0, 50)}... (must be a valid Cloudinary URL)`
      );
    }

    emitProgress("Validating", "Cloudinary URL validated successfully");

    // Process immediate upload using the existing logic
    const result = await processInstagramJob({
      id: uuidv4(),
      generationId,
      platform: "instagram",
      scheduledAt: null,
      status: "queued",
      retries: 0,
      maxRetries: maxRetries || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        cloudinaryUrl,
        caption,
        ...additionalMetadata,
      },
    });

    emitProgress("Completed", "Instagram upload completed successfully");
    return result;
  } catch (error: any) {
    console.error("❌ Instagram upload failed:", error);

    // Update metadata with error
    try {
      const metadata = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
      metadata.instagramStatus = "failed";
      metadata.instagramError = error.message || "Unknown error";
      metadata.instagramFailedAt = new Date().toISOString();
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch (metadataError) {
      console.error("Failed to update metadata:", metadataError);
    }

    return {
      success: false,
      platform: "instagram",
      status: "failed",
      error: error.message || "Unknown error",
      generationId,
    };
  }
}

// Export for backward compatibility
export default uploadInstagram;