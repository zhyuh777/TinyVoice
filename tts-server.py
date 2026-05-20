#!/usr/bin/env python3
"""Edge TTS server for novel-player. Generates MP3 audio files per sentence."""

import sys
import json
import os
import asyncio
import hashlib
import tempfile
import edge_tts

# Voice definitions: 3 male + 3 female
# Descriptions describe voice CHARACTERISTICS, not names
VOICES = {
    # Female voices
    "温暖女声":   "zh-CN-XiaoxiaoNeural",   # warm, gentle, ideal for narrator
    "清亮女声":   "zh-CN-XiaoyiNeural",     # bright, lively, youthful female
    "沉稳女声":   "zh-CN-XiaochenNeural",   # calm, composed, mature female
    # Male voices
    "温润男声":   "zh-CN-YunxiNeural",      # warm, natural, male lead
    "深沉男声":   "zh-CN-YunjianNeural",    # deep, steady, older male
    "明亮男声":   "zh-CN-YunyangNeural",    # bright, energetic, young male
}

DEFAULT_NARRATOR = "温暖女声"
DEFAULT_FEMALE = "温暖女声"
DEFAULT_MALE = "温润男声"


async def synthesize(text, voice_id, output_path, speed="+0%"):
    """Generate MP3 audio for a single sentence."""
    communicate = edge_tts.Communicate(
        text=text,
        voice=voice_id,
        rate=speed,
    )
    await communicate.save(output_path)


def get_voice_id(voice_desc):
    """Resolve voice description to Edge TTS voice ID."""
    return VOICES.get(voice_desc, VOICES[DEFAULT_NARRATOR])


async def generate_sentences(sentences_data, output_dir):
    """Generate MP3 for all sentences. Returns list of output paths."""
    results = []

    for i, sent in enumerate(sentences_data):
        text = sent.get("text", "").strip()
        if not text:
            results.append(None)
            continue

        voice_desc = sent.get("voice", DEFAULT_NARRATOR)
        voice_id = get_voice_id(voice_desc)
        speed = sent.get("speed", "+0%")

        # Generate a unique filename based on content hash
        text_hash = hashlib.md5(f"{text}{voice_id}{speed}".encode()).hexdigest()[:12]
        out_path = os.path.join(output_dir, f"sent_{i:05d}_{text_hash}.mp3")

        try:
            await synthesize(text, voice_id, out_path, speed)
            results.append(out_path)
        except Exception as e:
            # If synthesis fails (e.g., network error), write error and continue
            print(f"ERROR:{i}:{str(e)}", file=sys.stderr)
            results.append(None)

    return results


def main():
    """Main entry: read JSON from stdin, output JSON to stdout."""
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    action = input_data.get("action", "generate")

    if action == "voices":
        # Return available voices with descriptions
        voices_list = [
            {"desc": desc, "id": vid, "gender": "female" if any(
                f in vid.lower() for f in ["xiao", "xiaoxiao", "xiaoyi", "xiaochen"]
            ) else "male"}
            for desc, vid in VOICES.items()
        ]
        print(json.dumps({"voices": voices_list}))

    elif action == "generate":
        sentences = input_data.get("sentences", [])
        output_dir = input_data.get("output_dir", tempfile.mkdtemp())
        os.makedirs(output_dir, exist_ok=True)

        results = asyncio.run(generate_sentences(sentences, output_dir))
        print(json.dumps({"files": results, "output_dir": output_dir}))

    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
