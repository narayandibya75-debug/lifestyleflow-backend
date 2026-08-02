export interface TrendItem {
  id: string;

  title: string;

  description?: string;

  source:
    | "GitHub"
    | "HackerNews"
    | "Google"
    | "Reddit"
    | "YouTube";

  url: string;

  score?: number;

  stars?: number;

  language?: string;

  createdAt?: string;
}