import sys
import json
from pathlib import Path

import torch
from transformers import (
    AutoTokenizer,
    AutoModelForSeq2SeqLM,
)

class NLLBTranslator:
    def __init__(self, model_name="facebook/nllb-200-distilled-600M"):
        """
        Initialize NLLB-200 model.
        Options:
        - facebook/nllb-200-distilled-600M (faster, smaller)
        - facebook/nllb-200-1.3B (better quality, larger)
        - facebook/nllb-200-3.3B (best quality, largest)
        """
        print(f"Loading NLLB-200 model: {model_name}...", file=sys.stderr)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Using device: {self.device}", file=sys.stderr)
        
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(model_name).to(self.device)
        print("✅ Model loaded successfully", file=sys.stderr)
    
    def translate(self, text, source_lang="eng_Latn", target_lang="tel_Telu"):
        """
        Translate text from source language to target language.
        
        Language codes (NLLB format):
        - eng_Latn: English
        - tel_Telu: Telugu
        - hin_Deva: Hindi
        - tam_Taml: Tamil
        - kan_Knda: Kannada
        - mal_Mlym: Malayalam
        - urd_Arab: Urdu
        - ben_Beng: Bengali
        - mar_Deva: Marathi
        - guj_Gujr: Gujarati
        - ory_Orya: Odia
        - pan_Guru: Punjabi
        - etc.
        """
        if not text or len(text.strip()) == 0:
            return ""
        
        # Set tokenizer source language
        self.tokenizer.src_lang = source_lang
        
        # Truncate long texts (model has 1024 token limit)
        inputs = self.tokenizer(
            text, 
            return_tensors="pt", 
            truncation=True, 
            max_length=1024
        ).to(self.device)
        
        # Generate translation with deterministic settings
        with torch.no_grad():
            translated_tokens = self.model.generate(
                **inputs,
                forced_bos_token_id=self.tokenizer.lang_code_to_id[target_lang],
                max_length=1024,
                num_beams=5,
                do_sample=False,
                early_stopping=True,
            )
        
        # Decode translation
        translation = self.tokenizer.batch_decode(
            translated_tokens, 
            skip_special_tokens=True
        )[0]
        
        return translation

def main():
    if len(sys.argv) < 4:
        print("Usage: python translate.py <text> <source_lang> <target_lang>", file=sys.stderr)
        print("Example: python translate.py 'Hello world' eng_Latn tel_Telu", file=sys.stderr)
        print(json.dumps({"error": "Missing required arguments. Usage: python translate.py <text> <source_lang> <target_lang>"}, ensure_ascii=False))
        sys.exit(1)
    
    text = sys.argv[1]
    source_lang = sys.argv[2]
    target_lang = sys.argv[3]
    
    # Handle empty text
    if not text or text == '""' or text == "''":
        print(json.dumps({"translation": ""}, ensure_ascii=False))
        return
    
    try:
        # Initialize translator (only once, reuse for multiple translations)
        translator = NLLBTranslator()
        
        result = translator.translate(text, source_lang, target_lang)
        
        # Output as JSON for easy parsing in Node.js
        print(json.dumps({"translation": result}, ensure_ascii=False))
        
    except Exception as e:
        # On failure, output error JSON
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()