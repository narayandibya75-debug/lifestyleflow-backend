import { MetadataFile } from "./types";

export function buildSummary(metadata: MetadataFile[]) {
  let uploaded = 0;
  let failed = 0;
  let scheduled = 0;

  for (const video of metadata) {
    switch (video.status) {
      case "uploaded":
        uploaded++;
        break;

      case "failed":
        failed++;
        break;

      case "scheduled":
        scheduled++;
        break;
    }
  }

  return {
    totalVideos: metadata.length,
    uploaded,
    failed,
    scheduled,
  };
}