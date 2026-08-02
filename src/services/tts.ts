import { spawn } from "child_process";

export async function generateVoice(folder: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("python", [
      "python/generate_audio.py",
      folder,
    ]);

    child.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error("TTS failed"));
    });
  });
}