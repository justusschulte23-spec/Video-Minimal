import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

/* -------------------- dirname -------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------- APP -------------------- */
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

/* -------------------- HELPERS -------------------- */
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

const pickMusicOrFail = (res) => {
  const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3"));
  if (!tracks.length) {
    res.status(500).json({ error: "no music found" });
    return null;
  }
  return path.join(MUSIC_DIR, pickRandom(tracks));
};

const run = (cmd) =>
  new Promise((resolve, reject) =>
    exec(cmd, { timeout: 120000 }, (err, out, errOut) =>
      err ? reject(errOut || err) : resolve()
    )
  );

/* =================================================
   ================= VIDEO LOOP ====================
   ================================================= */
app.post("/loop", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    const inPath = `/tmp/${id}_in.mp4`;
    const outFile = `${id}.mp4`;
    const outPath = path.join(OUTPUT_DIR, outFile);

    await run(`curl -L "${videoUrl}" -o "${inPath}"`);

    const music = pickMusicOrFail(res);
    if (!music) return;

    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    await run(`
ffmpeg -y \
-stream_loop -1 -i "${inPath}" \
-i "${music}" \
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
      video_url: `${PUBLIC_BASE_URL}/videos/${outFile}`,
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
    const outFile = `${id}.mp4`;
    const outPath = path.join(OUTPUT_DIR, outFile);

    await run(`curl -L "${imageUrl}" -o "${imgPath}"`);

    const music = pickMusicOrFail(res);
    if (!music) return;

    const fadeOutStart = VIDEO_DURATION - FADE_OUT;

    await run(`
ffmpeg -y \
-loop 1 -framerate 30 -i "${imgPath}" \
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
-r 30 -t ${VIDEO_DURATION} \
-movflags +faststart "${outPath}"
`);

    const size = fs.statSync(outPath).size;

    res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${outFile}`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size
    });

  } catch (e) {
    res.status(500).json({ error: "image loop failed", details: String(e) });
  }
});

/* -------------------- SERVE -------------------- */
app.get("/videos/:file", (req, res) => {
  const p = path.join(OUTPUT_DIR, req.params.file);
  if (!fs.existsSync(p)) return res.status(404).send("Not found");
  res.sendFile(p);
});

/* -------------------- START -------------------- */
app.listen(process.env.PORT || 8080, () =>
  console.log("🎬 Motion + Static Image Looper ready")
);
