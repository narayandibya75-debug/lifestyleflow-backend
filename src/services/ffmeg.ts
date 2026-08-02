import { spawn } from "child_process";

export async function renderVideo(folder: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("python", [
      "python/video.py",
      folder,
    ]);

    child.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error("Render failed"));
    });
  });
}