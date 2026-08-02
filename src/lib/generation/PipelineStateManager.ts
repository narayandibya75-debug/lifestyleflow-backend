import {
  DEFAULT_PIPELINE_STATE,
  PipelineState,
  PipelineStepKey,
} from "./types";

import {
  loadPipeline,
  savePipeline,
} from "@/lib/pipeline";

export class PipelineStateManager {
  state: PipelineState;

  constructor(private folder: string) {
    this.state = this.loadState();
  }

  private loadState(): PipelineState {
    try {
      const loaded = loadPipeline(this.folder) as Partial<PipelineState> | null;

      return {
        ...DEFAULT_PIPELINE_STATE,
        ...(loaded ?? {}),
      } as PipelineState;
    } catch (err) {
      console.warn(
        "Pipeline state missing or corrupted. Starting fresh."
      );

      return {
        ...DEFAULT_PIPELINE_STATE,
      };
    }
  }

  isPending(key: PipelineStepKey): boolean {
    return this.state[key] === true;
  }

  isCompleted(key: PipelineStepKey): boolean {
    return this.state[key] === false;
  }

  markDone(key: PipelineStepKey) {
    this.state[key] = false;
    this.save();
  }

  markPending(key: PipelineStepKey) {
    this.state[key] = true;
    this.save();
  }

  reset() {
    this.state = {
      ...DEFAULT_PIPELINE_STATE,
    };

    this.save();
  }

  save() {
    savePipeline(
      this.folder,
      this.state
    );
  }
}