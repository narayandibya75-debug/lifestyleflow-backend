import fs from "fs";
import path from "path";
import { GENERATED_FOLDER } from "./constants";
import { Metadata } from "./types";

export function loadMetadata(): Metadata[] {
  if (!fs.existsSync(GENERATED_FOLDER)) {
    return [];
  }

  const folders = fs.readdirSync(GENERATED_FOLDER);

  return folders
    .map((folder) => {
      const file = path.join(
        GENERATED_FOLDER,
        folder,
        "metadata.json"
      );

      if (!fs.existsSync(file)) {
        return null;
      }

      return JSON.parse(
        fs.readFileSync(file, "utf8")
      ) as Metadata;
    })
    .filter(Boolean) as Metadata[];
}