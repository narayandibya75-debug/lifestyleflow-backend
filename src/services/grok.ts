import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

export async function generateLifestyleContent(
  topic: string,
  style: string,
  length: number,
  language: string
) {
  const prompt = `
Create a ${length}-second YouTube Shorts script.

Topic: ${topic}
Style: ${style}
Language: ${language}

Return ONLY valid JSON.
`;

  const response = await client.chat.completions.create({
    model: "grok-4",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.8,
  });

  return response.choices[0].message.content ?? "";
}

export async function generateYoutubeMetadata(
  topic: string,
  script: string,
  style: string,
  length: number,
  language: string,
  visibility: string
) {
  const prompt = `
Generate YouTube metadata.

Topic: ${topic}

Script:
${script}

Return ONLY JSON.

{
  "title":"",
  "description":"",
  "tags":[""],
  "visibility":"${visibility}"
}
`;

  const response = await client.chat.completions.create({
    model: "grok-4",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
  });

  return JSON.parse(response.choices[0].message.content ?? "{}");
}