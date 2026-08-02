# Dockerfile — backend (Express/TS + Python + FFmpeg)
#
# This backend shells out to `python` (child_process.spawn — see
# src/lib/generation/PipelineRunner.ts -> runPython) for the video
# generation pipeline, and those scripts call ffmpeg. All three (Node,
# Python, ffmpeg) have to live in the same container, one process per
# request stays simple, and it keeps this image portable across ANY
# Docker-compatible host — Render Free, Railway, Fly.io, DigitalOcean App
# Platform, a bare VPS, or plain `docker run` on a laptop. Nothing here
# assumes a Render-specific feature (Blueprints, paid persistent disks,
# etc.) — see render.yaml and DEPLOYMENT.md for why.
#
# Generated files are written to a temp folder during processing and
# uploaded to Cloudinary immediately after (see
# src/lib/storage/uploadCloudinary.ts), then deleted — so this image
# deliberately has NO volume/disk requirement. Any container filesystem
# works, ephemeral or not.

# ---------------------------------------------------------------------------
# Stage 1 — build the TypeScript backend
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — production runtime (Node + Python + FFmpeg)
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

# System deps: python3, pip, ffmpeg, curl (for the healthcheck).
# `python-is-python3` provides a `python` -> `python3` symlink, since
# PipelineRunner.ts spawns the bare `python` command.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Node production deps only (no devDependencies/build tools) ---
COPY package*.json ./
RUN npm ci --omit=dev

# --- Python deps, isolated in a venv ---
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# --- Compiled app + Python scripts (no source .ts, no test/dev files) ---
COPY --from=build /app/dist ./dist
COPY python ./python
COPY data ./data

# Local disk is a scratch area only (see comment above) — Cloudinary is the
# real storage layer, so no VOLUME is declared here on purpose.
RUN mkdir -p /app/public/generated

# Run as a non-root user in production.
RUN useradd --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-4000}/api/health || exit 1

CMD ["node", "dist/server.js"]
