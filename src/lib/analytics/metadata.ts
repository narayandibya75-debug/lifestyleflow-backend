import fs from "fs";
import path from "path";
import { MetadataFile } from "./types";

export function readMetadata() {
  const generatedFolder = path.join(
    process.cwd(),
    "public",
    "generated"
  );

  if (!fs.existsSync(generatedFolder)) {
    return [];
  }

  const folders = fs.readdirSync(generatedFolder);

  const metadata: MetadataFile[] = [];

  for (const folder of folders) {
    const file = path.join(
      generatedFolder,
      folder,
      "metadata.json"
    );

    if (!fs.existsSync(file)) continue;

    metadata.push(
      JSON.parse(
        fs.readFileSync(file, "utf8")
      )
    );
  }

  return metadata;
}