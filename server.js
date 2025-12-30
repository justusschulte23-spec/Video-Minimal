import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

/* -------------------- ESM fix -------------------- */
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

/* -------------------- Helpers -------------------- */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickMusic() {
  const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3"));
  if (!tracks.length) throw new Error("no music found");
  return path.join(MUSIC_DIR, pickRandom(tracks));
}

function run(cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, maxBuffer: 50 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) reject(errOut || err.message);
      else resolve(out);
    });
  });
}

/* =================================================
   ================= VIDEO LOOP ====================
   ================================================= */
app.post("/loop", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    const inPath = `/tmp/${id}.mp4`;
    const outPath = `${OUTPUT_DIR}/${id}.mp4`;

    await run(`curl -L --fail "${videoUrl}" -o "${inPath}"`);

    const music = pickMusic();
    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    await run(`
ffmpeg -y -hide_banner -loglevel error \
-stream_loop -1 -i "${inPath}" \
-i "${music}" \
-filter_complex "
[0:v]trim=duration=${VIDEO_DURATION},setpts=PTS-STARTPTS[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} -pix_fmt yuv420p -movflags +faststart "${outPath}"
`);

    const size = fs.statSync(outPath).size;

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

/* =================================================
   ================= IMAGE LOOP ====================
   ================================================= */
app.post("/image-loop", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl missing" });

    const id = crypto.randomUUID();
    const imgPath = `/tmp/${id}.jpg`;
    const outPath = `${OUTPUT_DIR}/${id}.mp4`;

    /* WICHTIG: ffmpeg dekodiert das Bild, nicht curl */
    await run(`
ffmpeg -y -hide_banner -loglevel error \
-i "${imageUrl}" -frames:v 1 "${imgPath}"
`);

    const music = pickMusic();
    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    await run(`
ffmpeg -y -hide_banner -loglevel error \
-loop 1 -i "${imgPath}" \
-i "${music}" \
-filter_complex "
[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,
pad=1080:1920:(ow-iw)/2:(oh-ih)/2,
format=yuv420p,setsar=1[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-r 30 -t ${VIDEO_DURATION} -movflags +faststart "${outPath}"
`);

    const size = fs.statSync(outPath).size;

    res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${id}.mp4`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size
    });

  } catch (e) {
    res.status(500).json({ error: "image loop failed", details: String(e) });
  }
});

/* -------------------- Serve -------------------- */
app.get("/videos/:file", (req, res) => {
  const p = path.join(OUTPUT_DIR, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.sendFile(p);
});

/* -------------------- Start -------------------- */
app.listen(process.env.PORT || 8080, () => {
  console.log("🎬 Video + Image Looper READY");
});
