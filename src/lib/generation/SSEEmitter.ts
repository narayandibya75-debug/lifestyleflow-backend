// --------------------------------------------------------------------------
// SSEEmitter: the single place responsible for formatting/sending SSE events
// --------------------------------------------------------------------------

export class SSEEmitter {
  private encoder = new TextEncoder();
  // Once true, every method becomes a no-op. Set on an explicit close() and
  // also set defensively if a write ever fails (e.g. the client navigated
  // away and the underlying stream is already closed/errored) so we never
  // throw from a second write or a redundant close.
  private closed = false;

  constructor(private writer: WritableStreamDefaultWriter<Uint8Array>) {}

  private async send(payload: Record<string, unknown>) {
    if (this.closed) return;

    try {
      await this.writer.write(
        this.encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
      );
    } catch (err) {
      // The client disconnected (or the stream errored) between our check
      // and the write. Treat this as "already closed" rather than letting
      // it bubble up as an unhandled rejection.
      this.closed = true;
      console.warn("SSEEmitter: write skipped, stream no longer writable.", err);
    }
  }

  async stepUpdate(step: number, message?: string) {
    await this.send({ type: "STEP_UPDATE", step, message });
  }

async completed(
  youtubeUrl: string,
  instagramUrl?: string
) {
  await this.send({
    type: "COMPLETED",
    youtubeUrl,
    instagramUrl,
    uploadedPlatforms: {
      youtube: !!youtubeUrl,
      instagram: !!instagramUrl,
    },
  });
}
  async error(message: string) {
    await this.send({ type: "ERROR", message });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.writer.close();
    } catch (err) {
      // Already closed/errored on the client side — nothing to do.
      console.warn("SSEEmitter: close() skipped, writer already closed.", err);
    }
  }
}

export interface ISSEEmitter {
  stepUpdate(step: number, message?: string): Promise<void>;
  completed(youtubeUrl?: string, instagramUrl?: string): Promise<void>;
  error(message: string): Promise<void>;
  close(): Promise<void>;
}