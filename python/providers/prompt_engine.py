# python/providers/prompt_engine.py
#
# Turns a scene dict from content.json into a rich, specific cinematic
# prompt for AI video providers. Generic prompts ("a person talking about
# AI") produce generic, unusable footage — the whole point of this module
# is to always assemble environment + subject + camera motion + lighting +
# atmosphere + style, even when the scene itself only gave us a short
# narration line to work with.

import re

# ---------------------------------------------------------------------------
# Vocabulary banks. Picking deterministically (by a hash of the scene text)
# rather than randomly means the same scene always yields the same prompt on
# a retry — useful for debugging and for providers that cache by prompt.
# ---------------------------------------------------------------------------

CAMERA_MOTIONS = [
    "slow cinematic dolly forward",
    "smooth gimbal tracking shot",
    "subtle handheld drift",
    "steady orbital pan around the subject",
    "slow push-in with shallow depth of field",
    "static tripod shot with gentle parallax",
]

LIGHTING_STYLES = [
    "soft natural lighting with warm highlights",
    "dramatic cinematic lighting with strong contrast",
    "diffused overcast daylight",
    "golden hour lighting with long soft shadows",
    "cool studio lighting with subtle rim light",
    "moody low-key lighting with soft fill",
]

ATMOSPHERES = [
    "clean and minimal atmosphere",
    "energetic and dynamic atmosphere",
    "calm, contemplative atmosphere",
    "high-end, polished commercial atmosphere",
    "immersive, slightly futuristic atmosphere",
]

STYLE_SUFFIX = (
    "highly detailed, smooth realistic animation, professional film "
    "quality, color-graded, shallow depth of field, no text, no watermark"
)

# Keyword -> environment hint. Falls back to a generic-but-still-specific
# environment when nothing matches, so we never hand a provider a completely
# bare prompt.
ENVIRONMENT_HINTS = [
    (r"\b(ai|artificial intelligence|robot|technology|tech|software|data|code)\b",
     "a sleek modern tech workspace with glowing screens and holographic interface elements"),
    (r"\b(money|finance|invest|stock|market|business|economy)\b",
     "a high-end modern office with city skyline views through floor-to-ceiling windows"),
    (r"\b(health|fitness|workout|gym|exercise|yoga)\b",
     "a bright, airy fitness studio with natural light streaming in"),
    (r"\b(food|cook|recipe|kitchen|meal|eat)\b",
     "a warm, well-lit modern kitchen with fresh ingredients on the counter"),
    (r"\b(travel|city|country|explore|journey|adventure)\b",
     "a scenic travel destination at golden hour with expansive natural landscape"),
    (r"\b(nature|forest|ocean|mountain|outdoor|sky)\b",
     "a breathtaking natural landscape with dramatic sky and organic textures"),
    (r"\b(home|house|family|relax|comfort)\b",
     "a cozy, tastefully decorated modern home interior with soft ambient light"),
    (r"\b(learn|study|education|school|book|knowledge)\b",
     "a calm, modern study space with warm ambient lighting and clean shelving"),
]

DEFAULT_ENVIRONMENT = "a clean, professionally lit modern environment suited to the subject"


def _pick(bank: list, seed_text: str) -> str:
    """Deterministic pick from `bank`, seeded by `seed_text` so retries and
    reruns for the same scene stay consistent."""
    if not bank:
        return ""
    index = abs(hash(seed_text)) % len(bank)
    return bank[index]


def _infer_environment(text: str) -> str:
    lowered = text.lower()
    for pattern, environment in ENVIRONMENT_HINTS:
        if re.search(pattern, lowered):
            return environment
    return DEFAULT_ENVIRONMENT


def _aspect_ratio_for(video_width: int, video_height: int) -> str:
    if video_height > video_width:
        return "9:16"
    if video_width == video_height:
        return "1:1"
    return "16:9"


def build_cinematic_prompt(scene: dict, config) -> str:
    """Builds a rich, specific cinematic video-generation prompt from a
    scene dict.

    Pulls from (in priority order): scene["visual_prompt"] if the script
    generator already wrote one, otherwise scene["search"]/scene["voice"]
    as the subject-matter seed, plus scene["camera"] / scene["mood"] /
    scene["scene_type"] / scene["duration"] as explicit modifiers.
    """
    keywords = scene.get("keywords")
    keyword_seed = keywords[0] if isinstance(keywords, list) and keywords else ""

    seed_text = (
        scene.get("visual_prompt")
        or scene.get("search")
        or scene.get("voice")
        or keyword_seed
        or "a compelling short-form video subject"
    )

    subject = scene.get("visual_prompt") or seed_text
    environment = _infer_environment(seed_text)

    camera = scene.get("camera") or _pick(CAMERA_MOTIONS, seed_text)
    mood = scene.get("mood")
    lighting = _pick(LIGHTING_STYLES, seed_text + "|lighting")
    atmosphere = (
        f"{mood} atmosphere" if mood else _pick(ATMOSPHERES, seed_text + "|atmosphere")
    )

    scene_type = scene.get("scene_type")
    duration = scene.get("duration")

    aspect_ratio = _aspect_ratio_for(config.video_width, config.video_height)

    parts = [
        environment.capitalize() + ",",
        f"{subject.strip().rstrip('.')},",
        f"{camera},",
        lighting + ",",
        atmosphere + ",",
    ]

    if scene_type:
        parts.append(f"{scene_type} style shot,")

    parts.append(STYLE_SUFFIX + ",")
    parts.append(f"{aspect_ratio} aspect ratio")

    if duration:
        parts.append(f", approx. {duration}s")

    prompt = " ".join(parts)
    # Collapse accidental double spaces/commas from optional fields being empty.
    prompt = re.sub(r"\s+,", ",", prompt)
    prompt = re.sub(r",\s*,", ",", prompt)
    prompt = re.sub(r"\s{2,}", " ", prompt).strip()

    return prompt
