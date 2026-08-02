import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

const MODELS = [
  "models/gemini-3.5-flash",
  "models/gemini-3-flash-preview",
  "models/gemini-2.5-pro",
  "models/gemini-2.5-flash",
  "models/gemini-2.0-flash",
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  fr: "French",
  de: "German",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};

// Rules appended to every prompt that must return JSON
const JSON_SAFETY_RULES = `
CRITICAL JSON SAFETY RULES:

• The entire response MUST be a single valid, parseable JSON object and nothing else.
• NEVER use a double quote (") inside any string value, for any reason — including code examples, dialogue, or emphasized words. Use a single quote (') instead. Example: write console.log('hi') not console.log("hi").
• Keep every string value on a single line. Do not put literal line breaks inside a string; use a space instead.
• Do not add trailing commas before } or ].
• Do not wrap the JSON in markdown code fences.
`;

//---------------------------------------------------------
// Gemini Model Manager
//---------------------------------------------------------

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type ModelState = {
  name: string;
  failures: number;
  disabledUntil: number;
};

const MODEL_POOL: ModelState[] = MODELS.map(name => ({
  name,
  failures: 0,
  disabledUntil: 0,
}));

let ACTIVE_MODEL: ModelState | null = null;

function availableModels() {
  const now = Date.now();

  return MODEL_POOL.filter(
    m => m.disabledUntil <= now
  ).sort((a, b) => a.failures - b.failures);
}

function markSuccess(model: ModelState) {
  model.failures = 0;
  model.disabledUntil = 0;
  ACTIVE_MODEL = model;

  console.log(
    `✅ Active Gemini Model → ${model.name}`
  );
}

function markFailure(
  model: ModelState,
  retryable: boolean
) {
  model.failures++;

  if (retryable) {
    model.disabledUntil =
      Date.now() +
      Math.min(
        30000,
        5000 * model.failures
      );
  }
}

async function tryModel(
  model: ModelState,
  prompt: string
) {
  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {

      console.log(
        `🧠 ${model.name} (${attempt}/${MAX_RETRIES})`
      );

      const response =
        await ai.models.generateContent({
          model: model.name,
          contents: prompt,
        });

      if (!response.text?.trim()) {
        throw new Error("Empty response");
      }

      markSuccess(model);

      return response.text;

    } catch (err: any) {

      const status = err?.status;

      console.log(
        `❌ ${model.name}`,
        status ?? err.message
      );

      //---------------------------------------------------
      // Permanent failure
      //---------------------------------------------------

      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404
      ) {

        markFailure(model, false);

        throw err;
      }

      //---------------------------------------------------
      // Retry temporary overload
      //---------------------------------------------------

      if (
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        !status
      ) {

        if (attempt < MAX_RETRIES) {

          const wait =
            1000 * Math.pow(2, attempt);

          console.log(
            `⏳ Waiting ${wait}ms...`
          );

          await sleep(wait);

          continue;
        }

        markFailure(model, true);

        throw err;
      }

      markFailure(model, false);

      throw err;
    }
  }

  throw new Error("Unexpected model failure");
}

export async function generateWithRetry(
  prompt: string
) {

  //-------------------------------------------------------
  // Use cached model first
  //-------------------------------------------------------

  if (ACTIVE_MODEL) {

    try {

      return await tryModel(
        ACTIVE_MODEL,
        prompt
      );

    } catch {

      console.log(
        `⚠ Active model failed. Switching...`
      );

      ACTIVE_MODEL = null;
    }
  }

  //-------------------------------------------------------
  // Search next available model
  //-------------------------------------------------------

  const models = availableModels();

  for (const model of models) {

    try {

      return await tryModel(
        model,
        prompt
      );

    } catch {

      continue;
    }
  }

  //-------------------------------------------------------
  // Nobody alive
  //-------------------------------------------------------

  console.log(
    "Sleeping before resetting model pool..."
  );

  await sleep(10000);

  MODEL_POOL.forEach(m => {
    m.disabledUntil = 0;
  });

  for (const model of MODEL_POOL) {

    try {

      return await tryModel(
        model,
        prompt
      );

    } catch {

      continue;
    }
  }

  throw new Error(
    "All Gemini models are unavailable."
  );
}
function cleanJsonString(text: string) {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

// Escapes double quotes that appear *inside* a JSON string value instead of
// closing it. Walks the text tracking whether we're inside a string; when a
// quote is found mid-string, we look ahead past whitespace — if the next
// character is a JSON structural character (, } ] :) it's a real closing
// quote, otherwise it's a stray literal quote (e.g. from a code snippet or
// quoted word) and gets escaped instead.
function repairUnescapedQuotes(text: string): string {
  let result = "";
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"' && text[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        result += char;
        continue;
      }

      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const nextChar = text[j];
      const closesString =
        nextChar === undefined || [",", "}", "]", ":"].includes(nextChar);

      if (closesString) {
        inString = false;
        result += char;
      } else {
        result += '\\"';
      }
    } else {
      result += char;
    }
  }

  return result;
}

function logParseFailureContext(text: string, error: unknown) {
  const match = error instanceof Error && /position (\d+)/.exec(error.message);
  if (match) {
    const pos = Number(match[1]);
    const start = Math.max(0, pos - 120);
    const end = Math.min(text.length, pos + 40);
    console.error(
      `JSON parse failed near position ${pos}. Context:\n---\n` +
        text.slice(start, pos) +
        " <<< HERE >>> " +
        text.slice(pos, end) +
        "\n---"
    );
  } else {
    console.error("JSON parse failed. Raw response:\n", text);
  }
}

// Tries a direct parse first, then falls back to the quote-repair pass
// before giving up. Logs useful context either way so a future failure is
// diagnosable from the logs instead of just a bare SyntaxError.
function safeJsonParse(raw: string) {
  const cleaned = cleanJsonString(raw);

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    console.warn("Initial JSON.parse failed, attempting quote repair...");

    try {
      return JSON.parse(repairUnescapedQuotes(cleaned));
    } catch (secondError) {
      logParseFailureContext(cleaned, secondError);
      throw secondError;
    }
  }
}

// ============================================================
// NEW: Scene interface with updated fields
// ============================================================
interface Scene {
  scene: number;
  voice: string;
  visual_prompt: string;
  pixel_search_prompt: string;
  search_keywords: string[];
  camera: string;
  mood: string;
  asset_type: "image" | "video";
  duration: number;
  importance: "low" | "medium" | "high";
  transition: "fade" | "zoom" | "cut" | "wipe" | "blur";
}
// ============================================================
// UPDATED: Normalize scene with new fields
// ============================================================
function normalizeScene(raw: any, index: number): Scene {
  const scene = typeof raw?.scene === "number" ? raw.scene : index + 1;

  const validCameras = [
    "slow push in", "slow dolly", "handheld", "top down",
    "drone", "orbit", "macro", "close up", "wide shot",
    "cinematic pan", "static"
  ];
  const camera = validCameras.includes(raw?.camera?.toLowerCase())
    ? raw.camera.toLowerCase()
    : "static";

  const validMoods = [
    "happy", "sad", "dark", "dramatic", "cinematic",
    "energetic", "luxury", "mysterious", "peaceful", "epic"
  ];
  const mood = validMoods.includes(raw?.mood?.toLowerCase())
    ? raw.mood.toLowerCase()
    : "cinematic";

  const validImportance = ["low", "medium", "high"];
  const importance = validImportance.includes(raw?.importance?.toLowerCase())
    ? raw.importance.toLowerCase()
    : "medium";

  const validTransitions = ["fade", "zoom", "cut", "wipe", "blur"];
  const transition = validTransitions.includes(raw?.transition?.toLowerCase())
    ? raw.transition.toLowerCase()
    : "fade";

  let duration = typeof raw?.duration === "number" ? raw.duration : 5;
  duration = Math.min(Math.max(duration, 4), 6);

  return {
    scene,
    voice: typeof raw?.voice === "string" ? raw.voice : "",
    visual_prompt: typeof raw?.visual_prompt === "string" ? raw.visual_prompt : "",
    pixel_search_prompt: typeof raw?.pixel_search_prompt === "string" ? raw.pixel_search_prompt : "",
    search_keywords: Array.isArray(raw?.search_keywords)
      ? raw.search_keywords.filter((x: any) => typeof x === "string")
      : [],
    camera,
    mood,
    asset_type: "video",
    duration,
    importance,
    transition,
  };
}
// ============================================================
// UPDATED: generateLifestyleContent with new prompt
// ============================================================
export async function generateLifestyleContent(
  topic: string,
  style: string,
  length: number,
  language: string
) {
  const sceneCount =
    length === 15
      ? 3
      : length === 30
      ? 6
      : length === 45
      ? 9
      : length === 60
      ? 12
      : length === 90
      ? 18
      : 24;
  
  const languageName = LANGUAGE_NAMES[language] ?? "English";

  const prompt = `
You are an expert YouTube Shorts creator and Scene Planner for a hybrid video pipeline.

Create ONE viral ${length}-second YouTube Short.

Language: ${languageName}

IMPORTANT RULES:
• Generate ALL narration in ${languageName}.
• Caption must be in ${languageName}.
• Hashtags should be relevant to ${languageName} speakers.
• voice MUST be in ${languageName}.
• visual_prompt MUST ALWAYS be in English because AI image/video models perform best in English.
• pixel_search_prompt MUST ALWAYS be in English.
• pixel_search_prompt must be a concise stock-footage search phrase derived directly from the narration of that scene.
• search_keywords must be highly related to the narration and useful for stock footage lookup.
• If the topic involves code, commands, or quoted text of any kind, describe it in words or use single quotes only — see the JSON safety rules below.

Topic: ${topic}
Video Style: ${style}
Also generate background music information.

background_music:

search_query:
A Pixabay music search phrase in English.

Examples:
cinematic inspirational background
technology ambient
soft emotional piano
epic trailer
corporate background
lofi chill
travel cinematic

mood:
One word describing the music.

genre:
One word.

energy:
low
medium
high
Generate exactly ${sceneCount} scenes.

For EVERY scene generate:

scene:
Sequential scene number.

voice:
One narration beat only, natural and specific, no filler.

duration:
Scene duration in seconds.

asset_type:
Always "video".

camera:
Describe the camera movement.

mood:
Describe the emotional mood.

importance:
low, medium, or high.

transition:
fade, zoom, cut, glitch, or blur.

visual_prompt:
A highly detailed cinematic prompt in English suitable for AI video generation.
Include:
subject, environment, lighting, camera angle, camera movement, composition, colors, style, realism, vertical framing.

pixel_search_prompt:
A short literal stock-footage query phrase, 6 to 14 words, English only.
It must describe exactly what should be visible in the clip and should closely match the narration.
Use concrete objects, people, places, actions, and environment.
Avoid abstract language.

search_keywords:
5 to 8 short English keywords or phrases for stock footage search.
These must be tightly related to the narration and should include the main subject, action, environment, and context.

${JSON_SAFETY_RULES}
Return ONLY valid JSON with this exact structure:

{
  "topic": "...",
  "caption": "...",
  "hashtags": "...",

  "background_music": {
    "search_query": "cinematic inspirational background",
    "mood": "inspirational",
    "genre": "cinematic",
    "energy": "medium"
  },

  "scenes": [
    {
      "scene": 1,
      "voice": "...",
      "duration": 5,
      "asset_type": "video",
      "camera": "slow cinematic dolly",
      "mood": "futuristic",
      "importance": "high",
      "transition": "fade",
      "visual_prompt": "...",
      "pixel_search_prompt": "...",
      "search_keywords": [
        "...",
        "...",
        "..."
      ]
    }
  ]
}
`;
  const raw = await generateWithRetry(prompt);
  const content = safeJsonParse(raw);

  content.scenes = Array.isArray(content.scenes)
    ? content.scenes.map((s: any, i: number) => normalizeScene(s, i))
    : [];

  content.script = content.scenes
    .map((scene: Scene) => scene.voice)
    .join(" ");

  return JSON.stringify(content, null, 2);
}

// ============================================================
// generateYoutubeMetadata (unchanged)
// ============================================================
export async function generateYoutubeMetadata(
  topic: string,
  script: string,
  style: string,
  length: number,
  language: string,
  visibility: string
) {

  const languageName = LANGUAGE_NAMES[language] ?? "English";

const prompt = `
You are a professional YouTube SEO expert fluent in multiple global and regional languages.

Generate optimized YouTube metadata.

IMPORTANT LANGUAGE CONSTRAINTS:
1. Generate the Title strictly in ${languageName}.
2. Generate the Description strictly in ${languageName}.
3. Generate the Tags strictly in ${languageName}.

CRITICAL SCRIPT & GRAMMAR RULES FOR NON-ENGLISH LANGUAGES:
- You must use the official, native script of ${languageName} (e.g., proper Devanagari for Hindi, proper native script for regional or global languages).
- Ensure absolute grammatical correctness, full character formations, and flawless spellings. 
- Avoid broken text, dropped symbols/matras, or phonetic/transliterated shortcuts (e.g., do not spell out words incorrectly due to character combining errors).
- The text must read naturally to a native speaker of ${languageName}.
- Do NOT use English vocabulary or Latin alphabets unless the language itself is English.

Topic:
${topic}

Style:
${style}

Length:
${length} seconds

Script:
${script}

${JSON_SAFETY_RULES}
Return ONLY valid JSON.

{
  "title": "",
  "description": "",
  "tags": []
}

Rules

Generate exactly 10 tags.

Each tag 1-3 words.

No emojis.

No #.

No duplicates.

visibility:
${visibility}
`;

  try {
    const raw = await generateWithRetry(prompt);
const metadata = safeJsonParse(raw);

// Translate ONLY the title if the language is not English
if (language !== "en") {

    const translated = await generateWithRetry(`
You are a professional native ${languageName} translator.

Translate the following English YouTube title into fluent ${languageName}.

Rules:

- Use ONLY native ${languageName}.
- Never transliterate English words.
- Use proper spelling.
- Use proper grammar.
- Keep the original meaning.
- Make it sound like a real YouTube title.
- Do NOT add emojis.
- Do NOT add quotation marks.
- Do NOT explain anything.
- Return ONLY the translated title.

English title:

${metadata.title}
`);

    metadata.title = translated
        .replace(/```/g, "")
        .replace(/"/g, "")
        .trim();
}

return {
  title: metadata.title ?? `${topic}`,
  description: metadata.description ?? `Generated AI video about ${topic}.`,
  tags: Array.isArray(metadata.tags) ? metadata.tags : [],
  visibility,
};
  } catch (e) {
    console.error(e);

    return {
      title: `${topic}`,
      description: `Generated AI video about ${topic}.`,
      tags: [
        topic,
        style,
        "shorts",
        "youtube shorts",
        "ai video",
      ],
      visibility,
    };
  }
}