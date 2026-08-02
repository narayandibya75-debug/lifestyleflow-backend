import { spawn } from "child_process";

export interface DownloadStockOptions {
  // Per-request override for the provider architecture's AI_VIDEO_ENABLED
  // config (python/providers/config.py). Lets the frontend's "Video
  // Source" toggle (pixel vs ai) control this one generation without
  // touching the platform-level env var, which stays the default for any
  // request that doesn't explicitly override it. `undefined` = no
  // override, use whatever's configured at the platform level.
  aiVideoEnabled?: boolean;
}

export function downloadStock(folder: string, options: DownloadStockOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    const env = { ...process.env };
    if (options.aiVideoEnabled !== undefined) {
      env.AI_VIDEO_ENABLED = options.aiVideoEnabled ? "true" : "false";
    }

    const child = spawn("python", ["python/download_stock.py", folder], {
      stdio: "inherit",
      env,
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`download_stock.py exited with code ${code}`));
      }
    });
  });
}

export function downloadMusic(folder: string) {
  return new Promise<void>((resolve) => {
    const child = spawn("python", ["python/download_music.py", folder], {
      stdio: "inherit",
    });

    child.on("error", (err) => {
      console.warn(`⚠️ Could not run download_music.py: ${err.message}`);
      console.warn("⚠️ Continuing without custom music (fallback will be used)");
      resolve(); // Don't fail the pipeline
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log("✅ Music downloaded successfully");
        resolve();
      } else {
        console.warn(`⚠️ download_music.py exited with code ${code}`);
        console.warn("⚠️ Continuing without custom music (fallback will be used)");
        resolve(); // Don't fail the pipeline - fallback music will be used
      }
    });
  });
}