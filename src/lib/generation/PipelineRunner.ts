// /lib/generation/PipelineRunner.ts

import fs from "fs";
import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import { spawn } from "child_process";

import {
  uploadVideoToCloudinary,
  uploadThumbnailToCloudinary,
} from "@/lib/storage/uploadCloudinary";
import { upsertRecord } from "@/lib/storage/libraryStore";
import { uploadVideo } from "@/lib/uploadYoutube";
import { downloadStock } from "@/services/pixels";

import {
  generateLifestyleContent,
  generateYoutubeMetadata,
} from "@/services/gemini";

import { MetadataManager } from "./MetadataManager";
import { PipelineStateManager } from "./PipelineStateManager";
import { StepRunner } from "./StepRunner";
import { ISSEEmitter } from "./SSEEmitter";
import { GenerationParams, normalizeGenerationParams } from "./types";

function runPython(script: string, args: string[] = []) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("python", [script, ...args], { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed`));
    });
    child.on("error", reject);
  });
}

export class PipelineRunner {
  private folder: string;
  private timestamp: string;
  private metadata: MetadataManager;
  private pipelineState: PipelineStateManager;
  private stepRunner: StepRunner;
  private scriptJsonString: string = "";

  constructor(
    private sse: ISSEEmitter,
    private params: GenerationParams,
    generationId?: string
  ) {
    this.params = normalizeGenerationParams(params);

    if (generationId) {
      this.folder = path.join(
        process.cwd(),
        "public",
        "generated",
        generationId
      );
      this.timestamp = generationId;
    } else {
      const created = this.createGenerationFolder();
      this.folder = created.folder;
      this.timestamp = created.timestamp;
    }

    this.metadata = new MetadataManager(this.folder);
    this.pipelineState = new PipelineStateManager(this.folder);
    this.stepRunner = new StepRunner(
      this.sse,
      this.metadata,
      this.pipelineState
    );
  }

  private createGenerationFolder() {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "_")
      .split(".")[0];

    const folder = path.join(process.cwd(), "public", "generated", timestamp);
    mkdirSync(folder, { recursive: true });

    return { folder, timestamp };
  }

  private initializeMetadata() {
    const metadataPath = path.join(this.folder, "metadata.json");

    if (fs.existsSync(metadataPath)) {
      const current = this.metadata.read();
      // Safely merge with existing metadata
      current.publish = this.params.publish || current.publish || {};
      // Remove old fields if they exist
      delete current.visibility;
      delete current.scheduledAt;
      this.metadata.write(current);
      return;
    }

    this.metadata.write({
      topic: this.params.topic,
      style: this.params.style,
      length: this.params.length,
      language: this.params.language,
      publish: this.params.publish || {},
      createdAt: new Date().toISOString(),
      status: "running",
    });
  }

  // ✅ FIXED: Safely extract publish configs
  private getPublishConfig() {
    // Initialize if undefined
    if (!this.params.publish) {
      this.params.publish = {
        youtube: {
          enabled: false,
          visibility: 'private',
          mode: 'now',
        },
        instagram: {
          enabled: false,
          mode: 'now',
        },
      };
    }
    
    // Ensure youtube config exists
    if (!this.params.publish.youtube) {
      this.params.publish.youtube = {
        enabled: false,
        visibility: 'private',
        mode: 'now',
      };
    }
    
    // Ensure instagram config exists
    if (!this.params.publish.instagram) {
      this.params.publish.instagram = {
        enabled: false,
        mode: 'now',
      };
    }
    
    // Fallback to flat params if nested values are missing
    const youtubeConfig = this.params.publish.youtube;
    
    if (this.params.youtubeMode && !youtubeConfig.mode) {
      youtubeConfig.mode = this.params.youtubeMode;
    }
    if (this.params.youtubeScheduledAt && !youtubeConfig.scheduledAt) {
      youtubeConfig.scheduledAt = this.params.youtubeScheduledAt;
    }
    
    const instagramConfig = this.params.publish.instagram;
    if (this.params.instagramMode && !instagramConfig.mode) {
      instagramConfig.mode = this.params.instagramMode;
    }
    if (this.params.instagramScheduledAt && !instagramConfig.scheduledAt) {
      instagramConfig.scheduledAt = this.params.instagramScheduledAt;
    }
    
    return this.params.publish;
  }

  private async runScriptStep() {
    await this.stepRunner.run({
      key: "script",
      step: 1,
      metadataStep: "script",
      runningMessage: "Generating AI script",
      skippedMessage: "AI Script already generated. Skipping.",
      run: async () => {
        this.scriptJsonString = await generateLifestyleContent(
          this.params.topic,
          this.params.style,
          this.params.length,
          this.params.language
        );
        if (typeof this.scriptJsonString === "string") {
          this.scriptJsonString = this.scriptJsonString
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();
        }

        if (
          !this.scriptJsonString ||
          this.scriptJsonString.trim() === "" ||
          this.scriptJsonString === "{}"
        ) {
          throw new Error("Grok returned an empty script. Generation aborted.");
        }

        const cleanScriptExcerpt =
          this.scriptJsonString.length > 500
            ? this.scriptJsonString.substring(0, 500) + "... [truncated for metadata prompt]"
            : this.scriptJsonString;

        // ✅ FIXED: Get visibility from publish config with fallback
        const publish = this.getPublishConfig();
        const youtubeVisibility = publish.youtube?.visibility || 'private';

        const youtubeMetadata = await generateYoutubeMetadata(
          this.params.topic,
          cleanScriptExcerpt,
          this.params.style,
          this.params.length,
          this.params.language,
          youtubeVisibility // Now this will always have a value
        );

        writeFileSync(path.join(this.folder, "content.json"), this.scriptJsonString, "utf8");
        writeFileSync(path.join(process.cwd(), "content.json"), this.scriptJsonString, "utf8");

        this.metadata.update({
          status: "processing",
          currentStep: "script",
          youtubeId: "",
          title: youtubeMetadata?.title || `${this.params.topic} Short`,
          description: youtubeMetadata?.description || `A video about ${this.params.topic}`,
          tags: youtubeMetadata?.tags || ["shorts"],
          publish: publish,
          video: "final_video.mp4",
          thumbnail: `/generated/${this.timestamp}/thumbnail.jpg`,
        });
      },
    });
  }

  async run() {
    try {
      this.initializeMetadata();
      await this.runScriptStep();
      
      writeFileSync(
        path.join(this.folder, "content.json"),
        this.scriptJsonString,
        "utf8"
      );

      await this.stepRunner.run({
        key: "voice",
        step: 2,
        metadataStep: "voice",
        runningMessage: "Generating narration",
        skippedMessage: "Narration already generated. Skipping.",
        run: () =>
          runPython("python/generate_audio.py", [
            this.folder,
            this.params.language,
            this.params.voiceGender || "male",
          ]),
      });

      await this.stepRunner.run({
        key: "music_select",
        step: 3,
        metadataStep: "music_download",
        runningMessage: "Selecting background music",
        skippedMessage: "Background music already selected. Skipping.",
        run: () =>
          runPython("python/select_music.py", [this.folder]),
      });

      await this.stepRunner.run({
        key: "music",
        step: 4,
        metadataStep: "music",
        runningMessage: "Mixing background music",
        skippedMessage: "Background music already mixed. Skipping.",
        run: () => runPython("python/add_background_music.py", [this.folder]),
      });

      await this.stepRunner.run({
        key: "stock",
        step: 5,
        metadataStep: "stock",
        runningMessage: "Preparing visual assets",
        skippedMessage: "Visual assets already prepared. Skipping.",
        run: async () => {
          // Both "pixel" and "ai" now go through the same
          // VideoProviderManager-backed download_stock.py (see
          // python/providers/) — the frontend's Video Source toggle just
          // overrides AI_VIDEO_ENABLED for this one generation.
          // "ai" still safely falls back to Pexels if no AI provider is
          // configured/succeeds; "pixel" explicitly forces Pexels-only
          // even if AI_VIDEO_ENABLED=true at the platform level.
          await downloadStock(this.folder, {
            aiVideoEnabled: this.params.visualSource === "ai",
          });

          const downloads = path.join(this.folder, "downloads");
          const clips = fs.readdirSync(downloads)
            .filter(f => f.endsWith(".mp4") || f.endsWith(".png"));

          if (clips.length === 0) {
            throw new Error("No visual assets generated.");
          }
        },
      });

      await this.stepRunner.run({
        key: "timeline",
        step: 6,
        metadataStep: "timeline",
        runningMessage: "Building timeline",
        skippedMessage: "Timeline already built. Skipping.",
        run: async () => {
          await runPython("python/calculate_scene_durations.py", [this.folder]);
          const createTimelineScript = path.join(process.cwd(), "python", "create_timeline.py");
          if (fs.existsSync(createTimelineScript)) {
            await runPython("python/create_timeline.py", [this.folder]);
            const timeline = path.join(this.folder, "timeline.json");
            if (!fs.existsSync(timeline)) {
              throw new Error("Timeline generation failed. timeline.json was not created.");
            }
          }
        },
      });

      await this.stepRunner.run({
        key: "trim",
        step: 7,
        metadataStep: "trim",
        runningMessage: "Preparing clips",
        skippedMessage: "Clips already prepared. Skipping.",
        run: async () => {
          await runPython("python/trim_clips.py", [this.folder]);
          await runPython("python/normalize_clips.py", [this.folder]);
        },
      });

      await this.stepRunner.run({
        key: "captions",
        step: 8,
        metadataStep: "captions",
        runningMessage: "Creating captions",
        skippedMessage: "Captions already generated. Skipping.",
        run: async () => {
          await runPython("python/generate_word_timings.py", [this.folder, this.params.language]);
          await runPython("python/generate_ass_subtitles.py", [this.folder, this.params.language]);
        },
      });

      await this.stepRunner.run({
        key: "merge",
        step: 9,
        metadataStep: "merge",
        runningMessage: "Applying transitions",
        skippedMessage: "Transitions already applied. Skipping.",
        run: () => runPython("python/ffmpeg_xfade.py", [this.folder]),
      });

      await this.stepRunner.run({
        key: "render",
        step: 10,
        metadataStep: "render",
        runningMessage: "Rendering video",
        skippedMessage: "Video already rendered. Skipping.",
        run: () => runPython("python/video.py", [this.folder]),
      });

      await this.stepRunner.run({
        key: "thumbnail",
        step: 11,
        metadataStep: "thumbnail",
        runningMessage: "Generating thumbnail",
        skippedMessage: "Thumbnail already generated. Skipping.",
        run: () => runPython("python/generate_thumbnail.py", [this.folder]),
      });

      // Always attempt to run the upload step based on publish configuration
      await this.runUploadStep();

      const metadata = this.metadata.read();

      await this.sse.completed(
        metadata.youtubeUrl ?? "",
        metadata.instagramPermalink ?? ""
      );

      // Local disk is a temporary working directory, not persistent
      // storage — now that everything that needed the raw file (Cloudinary
      // upload, and any immediate YouTube upload) has run, remove it. The
      // library/calendar/drafts pages read from the manifest synced in
      // runUploadStep(), not from this folder, so deleting it is safe.
      this.cleanupLocalFolder();
    } catch (error) {
      console.error("Pipeline failed:", error);
      this.handleError(error as Error);
      await this.syncLibraryRecord().catch((syncErr) =>
        console.error("Failed to sync failed-generation record:", syncErr)
      );
      throw error;
    }
  }

  /**
   * Mirrors this generation's current metadata into the Cloudinary-backed
   * manifest (see lib/storage/libraryStore.ts) so the library/calendar/
   * drafts pages don't depend on this folder still being on disk.
   */
  private async syncLibraryRecord() {
    const metadata = this.metadata.read();
    const contentPath = path.join(this.folder, "content.json");
    const script = fs.existsSync(contentPath)
      ? fs.readFileSync(contentPath, "utf8")
      : undefined;

    await upsertRecord(this.timestamp, {
      topic: metadata.topic,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      status: metadata.status,
      createdAt: metadata.createdAt,
      videoUrl: metadata.cloudinaryUrl,
      thumbnailUrl: metadata.thumbnailUrl,
      script,
      publish: metadata.publish,
      autoPublish: metadata.autoPublish ?? false,
      youtubeId: metadata.youtubeId,
      youtubeUrl: metadata.youtubeUrl,
      youtubeStatus: metadata.youtubeStatus,
      instagramMediaId: metadata.instagramMediaId,
      instagramPermalink: metadata.instagramPermalink,
      instagramStatus: metadata.instagramStatus,
      error: metadata.error,
    });
  }

  /**
   * Deletes the local temp folder for this generation. Safe to call only
   * after the manifest has been synced (syncLibraryRecord) and the final
   * video has been uploaded to Cloudinary — see runUploadStep().
   */
  private cleanupLocalFolder() {
    try {
      if (fs.existsSync(this.folder)) {
        fs.rmSync(this.folder, { recursive: true, force: true });
        console.log(`🧹 Cleaned up local temp folder: ${this.folder}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to clean up local temp folder: ${this.folder}`, error);
    }
  }

  private handleError(error: Error) {
    this.metadata.markFailed(error.message, {
      topic: this.params.topic,
      createdAt: new Date().toISOString(),
    });
  }

  // ✅ UPDATED: Handle upload step based on publish config only
  private async runUploadStep() {
    const publish = this.getPublishConfig();
    const youtubeConfig: any = publish.youtube || { enabled: false };
    const instagramConfig: any = publish.instagram || { enabled: false };

    const youtubeEnabled = youtubeConfig.enabled ?? false;
    const instagramEnabled = instagramConfig.enabled ?? false;

    // Always upload the finished video (and thumbnail) to Cloudinary,
    // regardless of which platforms are enabled. Local disk is never
    // treated as persistent storage — the library/calendar pages, and any
    // deferred publish later, read from this instead of the local temp
    // folder, which gets deleted at the end of run().
    const finalVideo = path.join(this.folder, "final_video.mp4");
    const thumbnailPath = path.join(this.folder, "thumbnail.jpg");

    try {
      console.log("Uploading final video to Cloudinary...");
      const cloudinaryUrl = await uploadVideoToCloudinary(finalVideo);

      if (!cloudinaryUrl || !cloudinaryUrl.startsWith("https://")) {
        throw new Error("Cloudinary upload failed.");
      }

      const thumbnailUrl = await uploadThumbnailToCloudinary(thumbnailPath);

      this.metadata.update({
        cloudinaryUrl,
        thumbnailUrl: thumbnailUrl || undefined,
      });

      // Persist to the manifest as soon as the video is safely in
      // Cloudinary, so the library/calendar pages have something to show
      // even if a later publish step (YouTube/Instagram) fails.
      await this.syncLibraryRecord();
    } catch (error) {
      console.error("Cloudinary upload failed:", error);
      this.metadata.update({
        status: "failed",
        currentStep: "upload",
        uploadError: error instanceof Error ? error.message : String(error),
      });
      await this.syncLibraryRecord().catch(() => {});
      throw error;
    }

    // If no platforms are enabled, the video is already safely in
    // Cloudinary — mark as completed and return.
    if (!youtubeEnabled && !instagramEnabled) {
      this.metadata.update({
        status: "completed",
        currentStep: "completed",
        uploadedAt: new Date().toISOString(),
      });
      await this.syncLibraryRecord();
      await this.sse.stepUpdate(
        12,
        "No platforms enabled for upload. Video stored in Cloudinary."
      );
      return;
    }

    // YouTube Upload
    if (youtubeEnabled) {
      const isScheduled = youtubeConfig.mode === "scheduled";
      const scheduledAt = isScheduled ? youtubeConfig.scheduledAt : null;

      if (isScheduled) {
        this.metadata.update({
          youtubeScheduledAt: scheduledAt,
          youtubeStatus: "scheduled",
        });

        await this.sse.stepUpdate(
          12,
          `YouTube upload scheduled for ${scheduledAt}`
        );
      } else {
        await this.stepRunner.run({
          key: "youtube_upload",
          step: 12,
          metadataStep: "upload",
          runningMessage: "Uploading to YouTube",
          skippedMessage: "Video already uploaded to YouTube. Skipping.",
          run: async () => {
            console.log("Uploading to YouTube...");

            const youtubeResult = await uploadVideo(this.timestamp);

            this.metadata.update({
              youtubeId: youtubeResult.youtubeId ?? "",
              youtubeUrl: youtubeResult.youtubeUrl ?? "",
              youtubeStatus: "completed",
              youtubeUploadedAt: new Date().toISOString(),
            });
          },
        });
      }
    } else {
      this.metadata.update({
        youtubeStatus: "disabled",
      });
      await this.sse.stepUpdate(
        12,
        "YouTube upload disabled."
      );
    }

    // Instagram Upload
    if (instagramEnabled) {
      const isScheduled = instagramConfig.mode === "scheduled";
      const scheduledAt = isScheduled ? instagramConfig.scheduledAt : null;

      if (isScheduled) {
        this.metadata.update({
          instagramScheduledAt: scheduledAt,
          instagramStatus: "scheduled",
        });

        await this.sse.stepUpdate(
          13,
          `Instagram upload scheduled for ${scheduledAt}`
        );
      } else {
        await this.stepRunner.run({
          key: "instagram_upload",
          step: 13,
          metadataStep: "instagram_upload",
          runningMessage: "Uploading to Instagram",
          skippedMessage: "Instagram upload already completed. Skipping.",
          run: async () => {
            const metadata = this.metadata.read();

            let instagramResult: any = {};

            try {
              const { uploadInstagram } = await import("@/lib/uploadInstagram");

              instagramResult = await uploadInstagram({
                generationId: this.timestamp,
                cloudinaryUrl: metadata.cloudinaryUrl,
                uploadMode: "immediate",
              });

              this.metadata.update({
                instagramMediaId: instagramResult?.mediaId ?? "",
                instagramPermalink: instagramResult?.permalink ?? "",
                instagramStatus: instagramResult?.status ?? "completed",
                instagramUploadedAt: new Date().toISOString(),
              });
            } catch (err) {
              console.error("Instagram upload failed:", err);
              this.metadata.update({
                instagramStatus: "failed",
                instagramError: err instanceof Error ? err.message : String(err),
              });
              throw err;
            }
          },
        });
      }
    } else {
      this.metadata.update({
        instagramStatus: "disabled",
      });
      await this.sse.stepUpdate(
        13,
        "Instagram upload disabled."
      );
    }

    this.metadata.update({
      status: "completed",
      currentStep: "completed",
      uploadedAt: new Date().toISOString(),
    });
    await this.syncLibraryRecord();
  }
}