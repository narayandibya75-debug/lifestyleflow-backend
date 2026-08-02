// src/controllers/trendsController.ts
// Ported from: app/api/trends/route.ts

import { Request, Response } from "express";
import { getGithubTrending } from "../lib/trends/github";
import { getHackerNewsTrending } from "../lib/trends/hackernews";

export async function trendsHandler(_req: Request, res: Response) {
  const github = await getGithubTrending();
  const hackerNews = await getHackerNewsTrending();

  const trends = [...github, ...hackerNews].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0)
  );

  return res.json(trends);
}
