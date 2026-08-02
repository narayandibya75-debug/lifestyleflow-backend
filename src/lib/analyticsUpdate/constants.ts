import path from "path";

export const GENERATED_FOLDER = path.join(
  process.cwd(),
  "public",
  "generated"
);

export const TOKEN_PATH = path.join(
  process.cwd(),
  "data",
  "youtube-token.json"
);

export const CACHE_TIME = 60_000;