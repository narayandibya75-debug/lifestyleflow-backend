// src/lib/absoluteMediaUrl.ts
//
// In the original single-app Next.js setup, `/generated/<id>/thumbnail.jpg`
// style paths worked as plain relative URLs because the API and the static
// files were served from the same origin. Now that the backend is a
// separate origin from the frontend, any such relative path needs to be
// made absolute so the browser (running on the Vercel-hosted frontend)
// fetches it from the right place.
export function absoluteMediaUrl(relativeOrAbsolute?: string): string | undefined {
  if (!relativeOrAbsolute) return relativeOrAbsolute;

  // Already absolute (e.g. a Cloudinary or YouTube-hosted URL) — leave as-is.
  if (/^https?:\/\//i.test(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }

  const base = process.env.BACKEND_URL ?? "http://localhost:4000";
  const path = relativeOrAbsolute.startsWith("/")
    ? relativeOrAbsolute
    : `/${relativeOrAbsolute}`;

  return `${base}${path}`;
}
