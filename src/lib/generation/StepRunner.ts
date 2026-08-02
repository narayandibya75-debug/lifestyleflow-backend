// /lib/generation/StepRunner.ts

import {
  StepDefinition,
} from "./types";

import { MetadataManager } from "./MetadataManager";
import { PipelineStateManager } from "./PipelineStateManager";

// Define the interface for the SSE emitter
export interface ISSEEmitter {
  stepUpdate(step: number, message: string): Promise<void> | void;
  completed(youtubeUrl: string, instagramUrl: string): Promise<void> | void;
  error(message: string): Promise<void> | void;
  close(): Promise<void> | void;
}

export class StepRunner {
  constructor(
    private sse: ISSEEmitter,  // Use interface instead of concrete class
    private metadata: MetadataManager,
    private pipeline: PipelineStateManager
  ) {}

  async run(def: StepDefinition) {
    // Skip already completed steps
    if (!this.pipeline.isPending(def.key)) {
      await this.sse.stepUpdate(
        def.step,
        def.skippedMessage
      );
      return;
    }

    await this.sse.stepUpdate(
      def.step,
      def.runningMessage
    );

    this.metadata.update({
      currentStep: def.metadataStep,
      status: "processing",
    });

    try {
      await def.run();

      this.pipeline.markDone(def.key);

      this.metadata.update({
        currentStep: def.metadataStep,
        lastCompletedStep: def.key,
      });

    } catch (error) {

      this.metadata.update({
        status: "failed",
        failedStep: def.key,
        failedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });

      throw error;
    }
  }
}