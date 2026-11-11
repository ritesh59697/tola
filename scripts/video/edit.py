# Cuts the recording into its scenes, drops the waits between them, and lays each narration line over its scene.
# Usage: python3 edit.py <takeDir> <out.mp4>
import json, subprocess, sys, glob, os

takes, out = sys.argv[1:-1], sys.argv[-1]
here = os.path.dirname(os.path.abspath(__file__))
durations = json.load(open(f"{here}/durations.json"))
lead = 0.3  # narration starts just after the cut

scenes = []  # (name, take, video, start, end), first complete take of each scene wins
for take in takes:
    marks = json.load(open(f"{take}/marks.json"))["marks"]
    video = glob.glob(f"{take}/*.webm")[0]
    ends = {m["name"]: m["t"] for m in marks if m["kind"] == "end"}
    for m in marks:
        if m["kind"] == "start" and m["name"] in ends and m["name"] not in [x[0] for x in scenes]:
            scenes.append((m["name"], take, video, m["t"], ends[m["name"]]))
take = takes[-1]

parts = []
for i, (name, _, video, s, e) in enumerate(scenes):
    length = max(e - s, durations[name] + lead + 0.4)
    seg = f"{take}/seg_{i:02d}.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{s:.3f}", "-t", f"{e - s:.3f}", "-i", video,
        "-i", f"{here}/n_{name}.aiff",
        "-filter_complex",
        f"[0:v]fps=30,scale=1920:1080:flags=lanczos,tpad=stop_mode=clone:stop_duration={max(0, length - (e - s)):.3f},format=yuv420p[v];"
        f"[1:a]adelay={int(lead * 1000)}|{int(lead * 1000)},apad,atrim=0:{length:.3f},aresample=48000[a]",
        "-map", "[v]", "-map", "[a]", "-t", f"{length:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "160k", seg,
    ], check=True)
    parts.append(seg)
    print(name, f"{s:.1f}-{e:.1f}", f"-> {length:.1f}s")

with open(f"{take}/list.txt", "w") as f:
    f.writelines(f"file '{os.path.abspath(p)}'\n" for p in parts)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", f"{take}/list.txt", "-c", "copy", "-movflags", "+faststart", out], check=True)
print("total", subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).decode().strip(), "s")
