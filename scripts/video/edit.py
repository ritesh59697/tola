# Cuts the recordings into scenes, drops the waits between them, lays each narration line over its scene,
# and burns in captions timed to the voice's own word timings.
# Usage: python3 edit.py <takeDir>... <out.mp4>
import glob, json, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

takes, out = sys.argv[1:-1], sys.argv[-1]
here = os.path.dirname(os.path.abspath(__file__))
durations = json.load(open(f"{here}/durations.json"))
lines = json.load(open(f"{here}/narration.json"))
settings = {
    "width": 1920, "height": 1080, "fps": 30,
    "lead": 0.3,            # seconds of picture before the voice starts
    "tail": 0.6,            # seconds of picture after the voice ends
    "maxWords": 9,          # words per caption
    "minWordsAtComma": 4,   # break at a comma only once a caption has this many words
    "minTailWords": 3,      # a shorter last caption joins the one before it
    "trimStart": 0.2, "trimEnd": 0.4,  # keep clear of scene edges
    # After a cross-site page change, the recording's timeline ran ahead of the script's marks; measured from the frames.
    "shift": {"explorer": -1.5, "slider": -1.5},
    "font": "/System/Library/Fonts/Avenir Next.ttc", "fontIndex": 2, "fontSize": 46,
    "bottomMargin": 70, "padX": 34, "padY": 18, "radius": 14,
    "box": (20, 22, 20, 205), "text": (255, 255, 255, 255),
    "closeCard": "ritesh59697.github.io/tola", "closeCardSeconds": 3.0,
}
font = ImageFont.truetype(settings["font"], settings["fontSize"], index=settings["fontIndex"])
capdir = f"{takes[-1]}/captions"
os.makedirs(capdir, exist_ok=True)


def caption_png(text, path, size=None):
    W, H = settings["width"], settings["height"]
    f = font if size is None else ImageFont.truetype(settings["font"], size, index=settings["fontIndex"])
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    w, h = r - l, b - t
    x0 = (W - w) // 2 - settings["padX"]
    y1 = H - settings["bottomMargin"]
    y0 = y1 - h - 2 * settings["padY"]
    d.rounded_rectangle((x0, y0, W - x0, y1), radius=settings["radius"], fill=settings["box"])
    d.text(((W - w) // 2 - l, y0 + settings["padY"] - t), text, font=f, fill=settings["text"])
    img.save(path)


def chunks(key):
    """Groups the spoken words into captions, keeping the line's own punctuation."""
    text, words = lines[key], json.load(open(f"{here}/w_{key}.json"))
    cursor, spans = 0, []
    for w in words:
        i = text.find(w["text"], cursor)
        if i < 0:
            i = cursor
        j = i + len(w["text"])
        while j < len(text) and re.match(r"[,.;:!?'’)]", text[j]):
            j += 1
        spans.append((i, j, w))
        cursor = j
    groups, cur = [], []
    for i, j, w in spans:
        cur.append((i, j, w))
        piece = text[i:j]
        if len(cur) >= settings["maxWords"] or re.search(r"[.;:!?]$", piece) or (piece.endswith(",") and len(cur) >= settings["minWordsAtComma"]):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    merged = []
    for g in groups:
        if merged and len(g) < settings["minTailWords"] and len(merged[-1]) + len(g) <= settings["maxWords"] + 2:
            merged[-1] = merged[-1] + g
        else:
            merged.append(g)
    groups = merged
    out = []
    for g in groups:
        out.append({"text": text[g[0][0]:g[-1][1]].strip(), "start": g[0][2]["start"], "end": g[-1][2]["end"]})
    for a, b in zip(out, out[1:]):  # hold each caption until the next one starts
        a["end"] = b["start"]
    return out


scenes = []  # (name, video, start, end); the first complete take of each scene wins
for take in takes:
    marks = json.load(open(f"{take}/marks.json"))["marks"]
    video = glob.glob(f"{take}/*.webm")[0]
    ends = {m["name"]: m["t"] for m in marks if m["kind"] == "end"}
    for m in marks:
        if m["kind"] == "start" and m["name"] in ends and m["name"] not in [x[0] for x in scenes]:
            scenes.append((m["name"], video, m["t"], ends[m["name"]]))

lead, W, H, fps = settings["lead"], settings["width"], settings["height"], settings["fps"]
parts = []
for n, (name, video, s, e) in enumerate(scenes):
    d = settings["shift"].get(name, 0)
    s, e = s + d + settings["trimStart"], e + d - settings["trimEnd"]
    caps = chunks(name)
    voice_end = lead + durations[name]
    length = max(e - s, voice_end + settings["tail"])
    if name == "close":
        length = voice_end + settings["closeCardSeconds"]
    caps[-1]["end"] = durations[name] + settings["tail"] / 2
    inputs, overlays = [], []
    for k, c in enumerate(caps):
        path = f"{capdir}/{name}_{k}.png"
        caption_png(c["text"], path)
        inputs += ["-i", path]
        overlays.append((lead + c["start"], lead + c["end"]))
    if name == "close":
        path = f"{capdir}/{name}_card.png"
        caption_png(settings["closeCard"], path, size=int(settings["fontSize"] * 1.4))
        inputs += ["-i", path]
        overlays.append((voice_end, length))
    graph = [f"[0:v]fps={fps},scale={W}:{H}:flags=lanczos,tpad=stop_mode=clone:stop_duration={max(0, length - (e - s)):.3f}[v0]"]
    for k, (a, b) in enumerate(overlays):
        graph.append(f"[v{k}][{k + 2}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[v{k + 1}]")
    graph.append(f"[v{len(overlays)}]format=yuv420p[v]")
    graph.append(f"[1:a]adelay={int(lead * 1000)}|{int(lead * 1000)},apad,atrim=0:{length:.3f},aresample=48000[a]")
    seg = f"{take}/seg_{n:02d}.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}", "-i", video,
                    "-i", f"{here}/v_{name}.mp3", *inputs, "-filter_complex", ";".join(graph),
                    "-map", "[v]", "-map", "[a]", "-t", f"{length:.3f}", "-r", str(fps),
                    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", seg], check=True)
    parts.append(seg)
    print(f"{name}: picture {e - s:.1f}s, voice {durations[name]:.1f}s, segment {length:.1f}s, {len(caps)} captions")

with open(f"{take}/list.txt", "w") as f:
    f.writelines(f"file '{os.path.abspath(p)}'\n" for p in parts)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", f"{take}/list.txt", "-c", "copy", "-movflags", "+faststart", out], check=True)
print("total", subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).decode().strip(), "s")
