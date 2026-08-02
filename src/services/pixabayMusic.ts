import fs from "fs";
import path from "path";

const API_KEY = process.env.PIXABAY_API_KEY!;

export async function downloadBackgroundMusic(
  folder: string,
  keywords: string[]
) {
  const query = keywords.join(" ");

  console.log(`🎵 Searching Pixabay Music: ${query}`);

  const url =
    `https://pixabay.com/api/audio/?key=${API_KEY}&q=${encodeURIComponent(query)}&per_page=10`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to search Pixabay Music.");
  }

  const data = await response.json();

  if (!data.hits || data.hits.length === 0) {
    throw new Error("No music found.");
  }

  // Highest downloads first
  data.hits.sort(
    (a: any, b: any) => (b.downloads ?? 0) - (a.downloads ?? 0)
  );

  const music = data.hits[0];

  const audioUrl =
    music.audio ??
    music.audio_url ??
    music.previewURL ??
    music.url;

  if (!audioUrl)
    throw new Error("No downloadable audio URL.");

  console.log("Downloading:", music.name);

  const audioResponse = await fetch(audioUrl);

  if (!audioResponse.ok) {
    throw new Error("Failed downloading audio.");
  }

  const buffer = Buffer.from(await audioResponse.arrayBuffer());

  const output = path.join(folder, "background.mp3");

  await fs.promises.writeFile(output, buffer);

  console.log("✅ Background music saved.");

  return music;
}