import { spawn } from "child_process";

export async function generateCaptions(folder: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("python", [
      "python/generate_ass_subtitles.py",
      folder,
    ]);

    child.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error("Caption generation failed"));
    });
  });
}