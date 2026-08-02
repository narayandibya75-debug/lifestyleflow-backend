import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { oauth2Client } from "./youtube";
import { translateText } from "./translation";
import { ensureLocalMetadata, ensureLocalVideoFile, ensureLocalThumbnail } from "./storage/rehydrate";

// NLLB to YouTube language code mapping
const YOUTUBE_LANGUAGE_MAP: { [key: string]: string } = {
  // Dravidian languages
  "tel_Telu": "te",     // Telugu
  "tam_Taml": "ta",     // Tamil
  "kan_Knda": "kn",     // Kannada
  "mal_Mlym": "ml",     // Malayalam
  
  // Indo-Aryan languages
  "hin_Deva": "hi",     // Hindi
  "ben_Beng": "bn",     // Bengali
  "mar_Deva": "mr",     // Marathi
  "guj_Gujr": "gu",     // Gujarati
  "pan_Guru": "pa",     // Punjabi
  "ory_Orya": "or",     // Odia
  "urd_Arab": "ur",     // Urdu
  "sin_Sinh": "si",     // Sinhala
  "npi_Deva": "ne",     // Nepali
  "eng_Latn": "en",     // English
  "spa_Latn": "es",     // Spanish
  "fra_Latn": "fr",     // French
  "deu_Latn": "de",     // German
  "ita_Latn": "it",     // Italian
  "por_Latn": "pt",     // Portuguese
  "rus_Cyrl": "ru",     // Russian
  "zho_Hans": "zh",     // Chinese (Simplified)
  "jpn_Jpan": "ja",     // Japanese
  "kor_Hang": "ko",     // Korean
};

// Map language names to NLLB codes
const LANGUAGE_TO_NLLB: { [key: string]: string } = {
  "telugu": "tel_Telu",
  "tamil": "tam_Taml",
  "hindi": "hin_Deva",
  "kannada": "kan_Knda",
  "malayalam": "mal_Mlym",
  "english": "eng_Latn",
  "bengali": "ben_Beng",
  "marathi": "mar_Deva",
  "gujarati": "guj_Gujr",
  "urdu": "urd_Arab",
  "punjabi": "pan_Guru",
  "odia": "ory_Orya",
  "sinhala": "sin_Sinh",
  "nepali": "npi_Deva",
  "spanish": "spa_Latn",
  "french": "fra_Latn",
  "german": "deu_Latn",
  "italian": "ita_Latn",
  "portuguese": "por_Latn",
  "russian": "rus_Cyrl",
  "chinese": "zho_Hans",
  "japanese": "jpn_Jpan",
  "korean": "kor_Hang",
};

// Short code to NLLB mapping (for when metadata uses "te" instead of "telugu")
const SHORT_CODE_TO_NLLB: { [key: string]: string } = {
  "en": "eng_Latn",
  "hi": "hin_Deva",
  "te": "tel_Telu",
  "ta": "tam_Taml",
  "kn": "kan_Knda",
  "ml": "mal_Mlym",
  "mr": "mar_Deva",
  "bn": "ben_Beng",
  "gu": "guj_Gujr",
  "pa": "pan_Guru",
  "or": "ory_Orya",
  "ur": "urd_Arab",
  "si": "sin_Sinh",
  "ne": "npi_Deva",
  "es": "spa_Latn",
  "fr": "fra_Latn",
  "de": "deu_Latn",
  "it": "ita_Latn",
  "pt": "por_Latn",
  "ru": "rus_Cyrl",
  "zh": "zho_Hans",
  "ja": "jpn_Jpan",
  "ko": "kor_Hang",
};

// Detect language from metadata - supports both full names and short codes
function detectTargetLanguage(metadata: any): string {
  // Check multiple possible fields
  const value = 
    metadata.targetLanguage ||
    metadata.language ||
    metadata.lang ||
    "en";

  const normalized = value.toLowerCase().trim();
  
  // First try: short code (e.g., "te", "hi")
  if (SHORT_CODE_TO_NLLB[normalized]) {
    const nllbCode = SHORT_CODE_TO_NLLB[normalized];
    console.log(`🎯 Language detected from short code: ${normalized} → ${nllbCode}`);
    return nllbCode;
  }
  
  // Second try: full name (e.g., "telugu", "hindi")
  if (LANGUAGE_TO_NLLB[normalized]) {
    const nllbCode = LANGUAGE_TO_NLLB[normalized];
    console.log(`🎯 Language detected from full name: ${normalized} → ${nllbCode}`);
    return nllbCode;
  }
  
  // Default to English
  console.log(`🎯 Language not recognized: ${value}, defaulting to English`);
  return "eng_Latn";
}

// Get YouTube language code from NLLB code
function getYouTubeLanguageCode(nllbCode: string): string {
  return YOUTUBE_LANGUAGE_MAP[nllbCode] || "en";
}

// Simplified text cleaning - only remove problematic characters
function cleanText(text: string): string {
  return String(text)
    .replace(/\s+/g, " ")  // Normalize whitespace
    .trim()
    .substring(0, 100);
}

// Clean tags with Unicode support for all languages
function cleanTag(tag: string): string {
  return String(tag)
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, "") // Keep letters, marks, numbers, spaces
    .trim()
    .substring(0, 30);
}

export async function uploadVideo(id: string) {
  const tokenPath = path.join(
    process.cwd(),
    "data",
    "youtube-token.json"
  );

  const tokens = JSON.parse(
    fs.readFileSync(tokenPath, "utf8")
  );

  oauth2Client.setCredentials(tokens);

  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client,
  });

  const folder = path.join(
    process.cwd(),
    "public",
    "generated",
    id
  );

  // Local disk is never treated as persistent — if the temp folder was
  // already cleaned up (see PipelineRunner.cleanupLocalFolder), pull the
  // metadata/video/thumbnail back down from Cloudinary before reading
  // anything off disk.
  await ensureLocalMetadata(id);
  const metadataPath = path.join(folder, "metadata.json");

  const metadata = JSON.parse(
    fs.readFileSync(metadataPath, "utf8")
  );

  // Read YouTube config from new publish structure
  const yt = metadata.publish?.youtube;

  // If YouTube is disabled, skip upload
  if (!yt || yt.enabled === false) {
    console.log("YouTube upload disabled, skipping...");
    return {
      skipped: true,
      reason: "YouTube publishing is disabled"
    };
  }

  const videoPath = await ensureLocalVideoFile(id);
  const thumbnailPath = (await ensureLocalThumbnail(id)) ?? path.join(folder, "thumbnail.jpg");

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video not found: ${videoPath}`);
  }

  metadata.status = "uploading";

  fs.writeFileSync(
    metadataPath,
    JSON.stringify(metadata, null, 2)
  );

  try {
    console.log("Uploading to YouTube...");

    // Detect target language for translation
    const targetLang = detectTargetLanguage(metadata);
    const sourceLang = "eng_Latn";
    const youtubeLang = getYouTubeLanguageCode(targetLang);

    console.log(`🌐 YouTube language code: ${youtubeLang}`);

    //--------------------------------------------------
    // Translate Title
    //--------------------------------------------------
    console.log("🔄 Translating title...");
    let translatedTitle = metadata.title || `${metadata.topic} Short`;
    
    if (targetLang !== "eng_Latn") {
      try {
        translatedTitle = await translateText(
          metadata.title || `${metadata.topic} Short`,
          sourceLang,
          targetLang
        );
        console.log(`✅ Title translated: ${translatedTitle.substring(0, 50)}...`);
      } catch (error) {
        console.warn("⚠️ Title translation failed, using original:", error);
        translatedTitle = metadata.title || `${metadata.topic} Short`;
      }
    }

    // Clean Title - simplified to preserve punctuation
    const cleanTitle = cleanText(translatedTitle);

    // Validate title
    if (!cleanTitle || cleanTitle.length === 0) {
      throw new Error("Title is empty after cleaning");
    }

    //--------------------------------------------------
    // Translate Description
    //--------------------------------------------------
    console.log("🔄 Translating description...");
    let translatedDescription = metadata.description || `A video about ${metadata.topic}`;
    
    if (targetLang !== "eng_Latn") {
      try {
        translatedDescription = await translateText(
          metadata.description || `A video about ${metadata.topic}`,
          sourceLang,
          targetLang
        );
        console.log(`✅ Description translated (${translatedDescription.length} chars)`);
      } catch (error) {
        console.warn("⚠️ Description translation failed, using original:", error);
        translatedDescription = metadata.description || `A video about ${metadata.topic}`;
      }
    }

    // Clean Description
    const cleanDescription = String(translatedDescription)
      .replace(/\r/g, "")
      .replace(/\u200B/g, "")
      .trim()
      .substring(0, 5000);

    //--------------------------------------------------
    // Extract and Clean Tags - Unicode support for all languages
    //--------------------------------------------------

    // Unicode-aware hashtag regex (works for all languages)
    const hashtagRegex = /#[\p{L}\p{M}\p{N}_]+/gu;
    const hashtagsFromDescription = (translatedDescription || "").match(hashtagRegex) || [];
    const hashtagsFromTitle = (translatedTitle || "").match(hashtagRegex) || [];

    const allTags = [
      ...(metadata.tags || []),
      ...hashtagsFromDescription,
      ...hashtagsFromTitle
    ]
    .map((t: any) => String(t))
    .map((t: string) => t.startsWith('#') ? t.substring(1) : t) // Remove # for YouTube
    .map((t: string) => cleanTag(t))
    .filter((t: string) => t.length > 1);

    // Remove duplicates
    const uniqueTags = Array.from(new Set(allTags));

    // Calculate total characters and filter to respect 450 character limit
    let totalCharacters = 0;
    const finalTags = uniqueTags.filter((tag: string) => {
      if (totalCharacters + tag.length > 450) {
        return false;
      }
      totalCharacters += tag.length;
      return true;
    }).slice(0, 15);

    //--------------------------------------------------
    // Determine category ID based on style
    //--------------------------------------------------
    const styleCategoryMap: { [key: string]: string } = {
      "travel": "24",
      "food": "24", 
      "technology": "28",
      "education": "27",
      "fitness": "26",
      "lifestyle": "26",
      "comedy": "23",
      "news": "25",
      "music": "24",
      "gaming": "24",
      "science": "28",
      "history": "27",
      "nature": "24",
      "spiritual": "24",
      "motivation": "26",
      "business": "28",
    };
    
    const categoryId = metadata.style && styleCategoryMap[metadata.style.toLowerCase()] 
      ? styleCategoryMap[metadata.style.toLowerCase()] 
      : "24"; // Default to Entertainment

    console.log(`📂 Category ID: ${categoryId}`);

    //--------------------------------------------------
    // Build Request Body
    //--------------------------------------------------

    const requestBody: any = {
      snippet: {
        title: cleanTitle,
        description: cleanDescription,
        categoryId: categoryId,
      },
      status: {},
    };

    // Determine privacy and scheduling based on mode
    if (yt.mode === "scheduled") {
      // YouTube scheduled publishing requires private visibility
      requestBody.status = {
        privacyStatus: "private",
        publishAt: yt.scheduledAt,
      };
      console.log(`📅 Video scheduled for: ${yt.scheduledAt}`);
    } else {
      // mode === "now" - immediate upload
      requestBody.status = {
        privacyStatus: yt.visibility,
      };
      console.log(`🔓 Video privacy: ${yt.visibility}`);
    }

    // Only add tags if we have them
    if (finalTags.length > 0) {
      requestBody.snippet.tags = finalTags;
    }

    // Only add language if we have a valid YouTube language code (and it's not English)
    if (youtubeLang && youtubeLang !== "en") {
      requestBody.snippet.defaultLanguage = youtubeLang;
      // Note: defaultAudioLanguage is intentionally omitted
      // YouTube validates this against the actual audio, which we don't know
    }

    //--------------------------------------------------
    // Debug Output - Log the full payload
    //--------------------------------------------------

    console.log("========== Upload Payload ==========");
    console.log(JSON.stringify(requestBody, null, 2));
    console.log("====================================");

    console.log("========== Upload Summary ==========");
    console.log({
      title: cleanTitle,
      titleLength: cleanTitle.length,
      descriptionLength: cleanDescription.length,
      tagsCount: finalTags.length,
      tags: finalTags.slice(0, 5),
      totalTagCharacters: totalCharacters,
      privacy: yt.mode === "scheduled" ? "private (scheduled)" : yt.visibility,
      scheduledAt: yt.mode === "scheduled" ? yt.scheduledAt : null,
      categoryId: categoryId,
      targetLanguage: targetLang,
      youtubeLanguage: youtubeLang,
    });
    console.log("====================================");

    //--------------------------------------------------
    // Upload
    //--------------------------------------------------

    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: requestBody,
      media: {
        body: fs.createReadStream(videoPath),
      },
    });

    const videoId = response.data.id;

    if (!videoId) {
      throw new Error("Upload succeeded but YouTube returned no video ID.");
    }

    console.log("✅ Video Uploaded:", videoId);
    console.log("🔗 Video URL:", `https://youtu.be/${videoId}`);

    //--------------------------------------------------
    // Upload Thumbnail
    //--------------------------------------------------

    if (fs.existsSync(thumbnailPath)) {
      try {
        await youtube.thumbnails.set({
          videoId,
          media: {
            mimeType: "image/jpeg",
            body: fs.createReadStream(thumbnailPath),
          },
        });
        console.log("✅ Thumbnail uploaded.");
      } catch (thumbError) {
        console.warn("⚠️ Thumbnail upload failed:", thumbError);
      }
    }

    //--------------------------------------------------
    // Save metadata
    //--------------------------------------------------

    metadata.status = "uploaded";
    metadata.youtubeId = videoId;
    metadata.youtubeUrl = `https://youtu.be/${videoId}`;
    metadata.thumbnailUploaded = fs.existsSync(thumbnailPath);
    metadata.uploadedAt = new Date().toISOString();
    metadata.tagsUsed = finalTags;
    metadata.translatedTitle = cleanTitle;
    metadata.translatedDescription = cleanDescription;
    metadata.translationLanguage = targetLang;
    metadata.youtubeLanguage = youtubeLang;
    metadata.originalTitle = metadata.title;
    metadata.originalDescription = metadata.description;
    metadata.categoryId = categoryId;

    fs.writeFileSync(
      metadataPath,
      JSON.stringify(metadata, null, 2)
    );

    return metadata;

  } catch (error: any) {

    console.error("========== YOUTUBE ERROR ==========");
    console.dir(error?.response?.data, {
      depth: null,
    });
    console.error(error);
    console.error("===================================");

    metadata.status = "failed";
    metadata.lastError =
      error?.response?.data?.error?.message ??
      error.message;
    metadata.failedAt = new Date().toISOString();
    metadata.analytics = {
      views: 0,
      likes: 0,
      comments: 0,
      subscribers: 0,
      ctr: 0,
      averageViewDuration: 0,
      watchTimeHours: 0,
      fetchedAt: null,
    };

    fs.writeFileSync(
      metadataPath,
      JSON.stringify(metadata, null, 2)
    );

    throw error;
  }
}