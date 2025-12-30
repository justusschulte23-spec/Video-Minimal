import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

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

function run(cmd, timeout = 120000) {
  return new Promise((res, rej) =>
    exec(cmd, { timeout, maxBuffer: 50 * 1024 * 1024 }, (e, o, s) =>
      e ? rej(s || e.message) : res(o)
    )
  );
}

/* ================= VIDEO LOOP ================= */
app.post("/loop", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    const inVid = `/tmp/${id}.mp4`;
    const outVid = `${id}.mp4`;
    const outPath = path.join(OUTPUT_DIR, outVid);

    await run(`curl -L "${videoUrl}" -o "${inVid}"`);

    const music = pickRandom(fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3")));
    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    await run(`
ffmpeg -y \
-stream_loop -1 -i "${inVid}" \
-i "${MUSIC_DIR}/${music}" \
-filter_complex "
[0:v]trim=duration=${VIDEO_DURATION},setpts=PTS-STARTPTS[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} \
-pix_fmt yuv420p -movflags +faststart "${outPath}"
`);

    const size = fs.statSync(outPath).size;
    res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${outVid}`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size
    });
  } catch (e) {
    res.status(500).json({ error: "video loop failed", details: e });
  }
});

/* ================= IMAGE LOOP (FIXED) ================= */
app.post("/image-loop", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl missing" });

    const id = crypto.randomUUID();
    const img = `/tmp/${id}.img`;
    const outVid = `${id}.mp4`;
    const outPath = path.join(OUTPUT_DIR, outVid);

    // IMPORTANT: raw download
    await run(`curl -L "${imageUrl}" -o "${img}"`);

    const music = pickRandom(fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3")));
    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    // FORCE IMAGE INPUT
    await run(`
ffmpeg -y \
-f image2 -framerate 1 -i "${img}" \
-i "${MUSIC_DIR}/${music}" \
-filter_complex "
[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,
pad=1080:1920:(ow-iw)/2:(oh-ih)/2,
format=yuv420p[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-r 30 -t ${VIDEO_DURATION} \
-movflags +faststart "${outPath}"
`);

    const size = fs.statSync(outPath).size;
    res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${outVid}`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size
    });
  } catch (e) {
    res.status(500).json({ error: "image loop failed", details: e });
  }
});

app.get("/videos/:file", (req, res) => {
  const f = path.join(OUTPUT_DIR, req.params.file);
  if (!fs.existsSync(f)) return res.sendStatus(404);
  res.sendFile(f);
});

app.listen(process.env.PORT || 8080, () =>
  console.log("🎬 Motion + Static Looper READY")
);
