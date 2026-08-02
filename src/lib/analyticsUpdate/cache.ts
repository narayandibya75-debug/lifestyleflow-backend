import { AnalyticsResponse } from "./types";

let cache: AnalyticsResponse | null = null;
let expires = 0;

export function getCache() {
  if (Date.now() < expires) {
    return cache;
  }

  return null;
}

export function setCache(
  data: AnalyticsResponse,
  ttl: number
) {
  cache = data;
  expires = Date.now() + ttl;
}