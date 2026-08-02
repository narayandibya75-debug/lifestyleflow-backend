import fs from "fs";
import path from "path";

import {
  PipelineState,
  DEFAULT_PIPELINE_STATE,
} from "@/lib/generation/types";

function getPipelineFile(folder: string) {
  return path.join(folder, "pipeline.json");
}

export function loadPipeline(folder: string): PipelineState {
  const file = getPipelineFile(folder);

  if (!fs.existsSync(file)) {
    return { ...DEFAULT_PIPELINE_STATE };
  }

  try {
    const state = JSON.parse(
      fs.readFileSync(file, "utf8")
    );

    return {
      ...DEFAULT_PIPELINE_STATE,
      ...state,
    };
  } catch (err) {
    console.error(
      "pipeline.json is corrupted. Resetting pipeline.",
      err
    );

    return {
      ...DEFAULT_PIPELINE_STATE,
    };
  }
}

export function savePipeline(
  folder: string,
  state: PipelineState
) {
  const file = getPipelineFile(folder);
  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(state, null, 2),
    "utf8"
  );

  fs.renameSync(tmp, file);
}