import { spawn } from "child_process";
import path from "path";

// Language code mapping for NLLB
export const NLLB_LANGUAGES: { [key: string]: string } = {
  // Indo-Aryan languages
  english: "eng_Latn",
  hindi: "hin_Deva",
  urdu: "urd_Arab",
  bengali: "ben_Beng",
  marathi: "mar_Deva",
  gujarati: "guj_Gujr",
  odia: "ory_Orya",
  punjabi: "pan_Guru",
  
  // Dravidian languages
  telugu: "tel_Telu",
  tamil: "tam_Taml",
  kannada: "kan_Knda",
  malayalam: "mal_Mlym",
  
  // Other South Asian languages
  sinhala: "sin_Sinh",
  nepali: "npi_Deva",
  
  // Southeast Asian languages
  indonesian: "ind_Latn",
  malay: "zsm_Latn",
  thai: "tha_Thai",
  vietnamese: "vie_Latn",
  tagalog: "tgl_Latn",
  
  // East Asian languages
  chinese: "zho_Hans",
  japanese: "jpn_Jpan",
  korean: "kor_Hang",
  
  // European languages
  spanish: "spa_Latn",
  french: "fra_Latn",
  german: "deu_Latn",
  italian: "ita_Latn",
  portuguese: "por_Latn",
  russian: "rus_Cyrl",
};

export function getLanguageCode(language: string): string {
  const lang = language.toLowerCase();
  return NLLB_LANGUAGES[lang] || "eng_Latn";
}

/**
 * Translate text using Hugging Face Inference API
 * This is the recommended approach for systems without GPU
 */
export async function translateText(
  text: string,
  sourceLang: string = "eng_Latn",
  targetLang: string = "tel_Telu"
): Promise<string> {
  // If text is empty or target is English, return as-is
  if (!text || text.trim().length === 0 || targetLang === "eng_Latn") {
    return text;
  }

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ HUGGINGFACE_API_KEY not found. Skipping translation.");
    return text;
  }

  const model = process.env.HUGGINGFACE_MODEL || "facebook/nllb-200-distilled-600M";

  try {
    console.log(`🔄 Translating to ${targetLang}...`);
    
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${model}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: text,
          parameters: {
            src_lang: sourceLang,
            tgt_lang: targetLang,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limiting
      if (response.status === 429) {
        console.warn("⚠️ Rate limited by Hugging Face API. Waiting 2 seconds...");
        await new Promise(resolve => setTimeout(resolve, 2000));
        return translateText(text, sourceLang, targetLang); // Retry
      }
      
      throw new Error(`Hugging Face API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Handle different response formats
    let translation = text;
    if (Array.isArray(result) && result.length > 0) {
      translation = result[0]?.translation_text || text;
    } else if (result.translation_text) {
      translation = result.translation_text;
    } else {
      translation = text;
    }

    console.log(`✅ Translation complete (${translation.length} chars)`);
    return translation;

  } catch (error) {
    console.error("❌ Translation error:", error);
    return text; // Return original text on error
  }
}

/**
 * Batch translate multiple texts (more efficient)
 */
export async function translateBatch(
  texts: string[],
  sourceLang: string = "eng_Latn",
  targetLang: string = "tel_Telu"
): Promise<string[]> {
  if (!texts || texts.length === 0 || targetLang === "eng_Latn") {
    return texts;
  }

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    console.warn("⚠️ HUGGINGFACE_API_KEY not found. Skipping translations.");
    return texts;
  }

  const model = process.env.HUGGINGFACE_MODEL || "facebook/nllb-200-distilled-600M";

  try {
    console.log(`🔄 Batch translating ${texts.length} texts to ${targetLang}...`);
    
    // For batch translation, we send them as separate requests
    const translations = await Promise.all(
      texts.map(async (text) => {
        if (!text || text.trim().length === 0) {
          return text;
        }
        
        try {
          const response = await fetch(
            `https://api-inference.huggingface.co/models/${model}`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                inputs: text,
                parameters: {
                  src_lang: sourceLang,
                  tgt_lang: targetLang,
                },
              }),
            }
          );

          if (!response.ok) {
            return text;
          }

          const result = await response.json();
          if (Array.isArray(result) && result.length > 0) {
            return result[0]?.translation_text || text;
          }
          return result.translation_text || text;
        } catch {
          return text;
        }
      })
    );

    console.log(`✅ Batch translation complete`);
    return translations;

  } catch (error) {
    console.error("❌ Batch translation error:", error);
    return texts;
  }
}