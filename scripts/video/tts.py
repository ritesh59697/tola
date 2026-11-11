# Reads each narration line with a neural voice and keeps every word's timing, for captions.
# Usage: python3 tts.py <voice> [rate]
import asyncio, json, os, subprocess, sys
import edge_tts

here = os.path.dirname(os.path.abspath(__file__))
voice = sys.argv[1]
rate = sys.argv[2] if len(sys.argv) > 2 else "+0%"
lines = json.load(open(f"{here}/narration.json"))


async def speak(key, text):
    words, audio = [], bytearray()
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary").stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            # Offsets come in 100-nanosecond units.
            words.append({"text": chunk["text"], "start": chunk["offset"] / 1e7, "end": (chunk["offset"] + chunk["duration"]) / 1e7})
    open(f"{here}/v_{key}.mp3", "wb").write(audio)
    json.dump(words, open(f"{here}/w_{key}.json", "w"), indent=1)


async def main():
    durations = {}
    for key, text in lines.items():
        await speak(key, text)
        durations[key] = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f"{here}/v_{key}.mp3"]).decode())
    json.dump(durations, open(f"{here}/durations.json", "w"), indent=1)
    print(durations, round(sum(durations.values()), 1))

asyncio.run(main())
