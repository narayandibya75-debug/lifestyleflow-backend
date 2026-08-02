import { TrendItem } from "./types";

export async function getGithubTrending(): Promise<TrendItem[]> {
  try {
    const res = await fetch(
      "https://api.github.com/search/repositories?q=created:>2026-07-01&sort=stars&order=desc&per_page=10",
      {
        headers: {
          Accept: "application/vnd.github+json",
        },
      }
    );

    const data = await res.json();

    return (
      data.items?.map((repo: any) => ({
        id: repo.id.toString(),

        title: repo.full_name,

        description: repo.description,

        source: "GitHub",

        url: repo.html_url,

        stars: repo.stargazers_count,

        language: repo.language,

        score: repo.stargazers_count,
      })) || []
    );
  } catch (err) {
    console.error("GitHub Trending Error", err);

    return [];
  }
}