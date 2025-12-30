import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

/* -------------------- ESM dirname fix -------------------- */
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
  const tracks = fs.readdirSync(MUSIC_DIR).filter((f) => f.endsWith(".mp3"));
  if (!tracks.length) {
    res.status(500).json({ error: "no music found in ./music" });
    return null;
  }
  return path.join(MUSIC_DIR, pickRandom(tracks));
}

function inferImageExt(url) {
  // quick & dirty: jpg/png/webp fallback
  const u = (url || "").toLowerCase();
  if (u.includes(".png")) return "png";
  if (u.includes(".webp")) return "webp";
  if (u.includes(".jpeg")) return "jpg";
  if (u.includes(".jpg")) return "jpg";
  return "jpg";
}

function runCmd(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

/* =========================================================
   =============== VIDEO LOOP (BESTEHEND) ==================
   ========================================================= */
app.post("/loop", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    const inputPath = `/tmp/${id}_in.mp4`;
    const outputFile = `${id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    // download with timeout
    await runCmd(`curl -L --max-time 40 "${videoUrl}" -o "${inputPath}"`, {
      timeout: 45000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const musicPath = pickMusicOrFail(res);
    if (!musicPath) return;

    const audioOffset = Math.floor(Math.random() * 8);
    const fadeOutStart = Math.max(0, VIDEO_DURATION - FADE_OUT);

    const ffmpegCmd = `
ffmpeg -y -hide_banner -loglevel error \
-stream_loop -1 -i "${inputPath}" \
-ss ${audioOffset} -i "${musicPath}" \
-filter_complex "
[0:v]trim=duration=${VIDEO_DURATION},setpts=PTS-STARTPTS[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},asetpts=PTS-STARTPTS,
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} \
-pix_fmt yuv420p -movflags +faststart "${outputPath}"
`;

    await runCmd(ffmpegCmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

    // cleanup
    try { fs.unlinkSync(inputPath); } catch {}

    const size = fs.statSync(outputPath).size;

    return res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${outputFile}`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size,
    });
  } catch (e) {
    // show real error
    return res.status(500).json({
      error: "video loop failed",
      details: e?.stderr || e?.err?.message || e?.message || String(e),
    });
  }
});

/* =========================================================
   =============== IMAGE LOOP (NEU) =========================
   ========================================================= */
app.post("/image-loop", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "imageUrl missing" });

    const id = crypto.randomUUID();
    const ext = inferImageExt(imageUrl);
    const imagePath = `/tmp/${id}.${ext}`;
    const outputFile = `${id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    await runCmd(`curl -L --max-time 40 "${imageUrl}" -o "${imagePath}"`, {
      timeout: 45000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const musicPath = pickMusicOrFail(res);
    if (!musicPath) return;

    const audioOffset = Math.floor(Math.random() * 8);
    const fadeOutStart = Math.max(0, VIDEO_DURATION - FADE_OUT);

    // wichtig: -loop 1 + sicherer scale/pad für 9:16 ohne Verzerren
    const ffmpegCmd = `
ffmpeg -y -hide_banner -loglevel error \
-loop 1 -i "${imagePath}" \
-ss ${audioOffset} -i "${musicPath}" \
-filter_complex "
[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,
pad=1080:1920:(ow-iw)/2:(oh-ih)/2,
format=yuv420p,setsar=1[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},asetpts=PTS-STARTPTS,
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-r 30 -t ${VIDEO_DURATION} \
-movflags +faststart "${outputPath}"
`;

    await runCmd(ffmpegCmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

    try { fs.unlinkSync(imagePath); } catch {}

    const size = fs.statSync(outputPath).size;

    return res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${outputFile}`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size,
    });
  } catch (e) {
    return res.status(500).json({
      error: "image loop failed",
      details: e?.stderr || e?.err?.message || e?.message || String(e),
    });
  }
});

/* -------------------- SERVE VIDEOS -------------------- */
app.get("/videos/:file", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  res.sendFile(filePath);
});

/* -------------------- START -------------------- */
app.listen(process.env.PORT || 8080, () => {
  console.log("🎬 Video + Image Looper running");
});
