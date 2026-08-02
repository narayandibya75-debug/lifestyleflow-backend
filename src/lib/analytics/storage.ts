import fs from "fs";
import path from "path";

export function calculateStorage() {
  const generatedFolder = path.join(
    process.cwd(),
    "public",
    "generated"
  );

  let storage = 0;

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);

    for (const file of files) {
      const full = path.join(dir, file);

      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        walk(full);
      } else {
        storage += stat.size;
      }
    }
  }

  walk(generatedFolder);

  return storage;
}