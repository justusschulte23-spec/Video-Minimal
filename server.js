import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

/* -------------------- dirname fix -------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------- App -------------------- */
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

/* -------------------- CONFIG -------------------- */
const MUSIC_DIR = "./music";
const VIDEO_DURATION = 15;
const FADE_IN = 0.3;
const FADE_OUT = 0.3;
const MUSIC_VOLUME = 0.25;

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  "https://video-minimal-production.up.railway.app";

const OUTPUT_DIR = "/tmp/videos";
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickMusicOrFail(res) {
  const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3"));
  if (!tracks.length) {
    res.status(500).json({ error: "no music found" });
    return null;
  }
  return path.join(MUSIC_DIR, pickRandom(tracks));
}

function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) reject(stderr || err.message);
      else resolve(stdout);
    });
  });
}

/* =========================================================
   =============== VIDEO LOOP (OK) =========================
   ========================================================= */
app.post("/loop", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    const input = `/tmp/${id}.mp4`;
    const output = path.join(OUTPUT_DIR, `${id}.mp4`);

    await run(`curl -L "${videoUrl}" -o "${input}"`);

    const music = pickMusicOrFail(res);
    if (!music) return;

    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    await run(`
ffmpeg -y -hide_banner -loglevel error \
-stream_loop -1 -i "${input}" \
-i "${music}" \
-filter_complex "
[0:v]trim=duration=${VIDEO_DURATION},setpts=PTS-STARTPTS[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} -pix_fmt yuv420p -movflags +faststart "${output}"
`);

    const size = fs.statSync(output).size;

    res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${id}.mp4`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size
    });
  } catch (e) {
    res.status(500).json({ error: "video loop failed", details: String(e) });
  }
});

/* =========================================================
   =============== IMAGE LOOP (FIXED) =======================
   ========================================================= */
app.post("/image-loop", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl missing" });

    const id = crypto.randomUUID();
    const raw = `/tmp/${id}_raw`;
    const img = `/tmp/${id}.png`;
    const output = path.join(OUTPUT_DIR, `${id}.mp4`);

    // 1. download whatever Leonardo gives
    await run(`curl -L "${imageUrl}" -o "${raw}"`);

    // 2. normalize to PNG (THIS FIXES 500)
    await run(`ffmpeg -y -i "${raw}" "${img}"`);

    const music = pickMusicOrFail(res);
    if (!music) return;

    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    // 3. create 15s video from image
    await run(`
ffmpeg -y -hide_banner -loglevel error \
-loop 1 -framerate 30 -i "${img}" \
-i "${music}" \
-filter_complex "
[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,
pad=1080:1920:(ow-iw)/2:(oh-ih)/2,
format=yuv420p[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} -r 30 -movflags +faststart "${output}"
`);

    const size = fs.statSync(output).size;

    res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${id}.mp4`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size
    });
  } catch (e) {
    res.status(500).json({
      error: "image loop failed",
      details: String(e)
    });
  }
});

/* -------------------- SERVE -------------------- */
app.get("/videos/:file", (req, res) => {
  const p = path.join(OUTPUT_DIR, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.sendFile(p);
});

app.listen(process.env.PORT || 8080, () =>
  console.log("🎬 Video + Image Looper running")
);
