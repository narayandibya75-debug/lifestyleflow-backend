// src/controllers/generateController.ts
//
// Ported from the original Next.js route: app/api/generate/route.ts
// Business logic is untouched — only the request/response layer changed
// from NextRequest/NextResponse (Web API) to Express (req/res).

import { Request, Response } from "express";
import { SSEEmitter } from "../lib/generation/SSEEmitter";
import { PipelineRunner } from "../lib/generation/PipelineRunner";
import { normalizeGenerationParams } from "../lib/generation/types";

export async function generateHandler(req: Request, res: Response) {
  // Set up SSE response headers (same headers as the original Next.js route)
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  // SSEEmitter expects a WritableStreamDefaultWriter<Uint8Array> (Web Streams
  // API), exactly like it received from Next.js's TransformStream. We adapt
  // Express's `res` (a Node http.ServerResponse) into that same interface so
  // SSEEmitter itself needs zero changes.
  const webWritable = new WritableStream<Uint8Array>({
    write(chunk) {
      res.write(chunk);
    },
    close() {
      res.end();
    },
  });
  const writer = webWritable.getWriter();
  const sse = new SSEEmitter(writer);

  const query = req.query;
  const generationId =
    (query.generationId as string | undefined) ?? undefined;
  const voiceGenderParam = query.voiceGender as string | undefined;
  const voiceGender = voiceGenderParam === "male" ? "male" : "female";

  const params = normalizeGenerationParams({
    topic: (query.topic as string) ?? "",
    style: (query.style as string) ?? "Tech",
    length: Number((query.length as string) ?? "60"),
    language: (query.language as string) ?? "en",
    visualSource:
      (query.visualSource as "pixel" | "ai") ?? "pixel",
    voiceGender,

    autoPublish: query.autoPublish === "true",

    youtubeEnabled: query.youtubeEnabled === "true",

    youtubeVisibility:
      (query.youtubeVisibility as "public" | "private" | "unlisted") ??
      "private",

    youtubeMode: (query.youtubeMode as "now" | "scheduled") ?? "now",

    youtubeScheduledAt:
      (query.youtubeScheduledAt as string) || undefined,

    instagramEnabled: query.instagramEnabled === "true",

    instagramMode: (query.instagramMode as "now" | "scheduled") ?? "now",

    instagramScheduledAt:
      (query.instagramScheduledAt as string) || undefined,
  });

  console.log("Visibility received:", query.visibility);

  // Run pipeline asynchronously (identical to original)
  (async () => {
    let runner: PipelineRunner | undefined;

    try {
      runner = new PipelineRunner(sse, params, generationId);
      await runner.run();
    } catch (e: any) {
      console.error("Pipeline error:", e);
      await sse.error(e.message);
    } finally {
      await sse.close();
    }
  })();

  // Keep the connection open; Express doesn't need an explicit return value
  // here because we've already written headers via res.writeHead above.
  req.on("close", () => {
    // Client disconnected — SSEEmitter's internal writes will start
    // no-op-ing/erroring gracefully once res is no longer writable.
  });
}
