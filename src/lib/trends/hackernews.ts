import { TrendItem } from "./types";

export async function getHackerNewsTrending(): Promise<TrendItem[]> {
  try {
    const ids = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json"
    ).then((r) => r.json());

    const top = ids.slice(0, 10);

    const stories = await Promise.all(
      top.map(async (id: number) => {
        const story = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`
        ).then((r) => r.json());

        return {
          id: story.id.toString(),

          title: story.title,

          description: `${story.score} points • ${story.descendants || 0} comments`,

          source: "HackerNews",

          url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,

          score: story.score,
        } satisfies TrendItem;
      })
    );

    return stories;
  } catch (err) {
    console.error(err);

    return [];
  }
}