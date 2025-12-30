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
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/* -------------------- Helpers -------------------- */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* =========================================================
   =============== VIDEO LOOP (BESTEHEND) ==================
   ========================================================= */
app.post("/loop", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) {
      return res.status(400).json({ error: "videoUrl missing" });
    }

    const id = crypto.randomUUID();
    const inputPath = `/tmp/${id}_in.mp4`;
    const outputFile = `${id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    exec(`curl -L "${videoUrl}" -o "${inputPath}"`, (err) => {
      if (err) return res.status(500).json({ error: "video download failed" });

      const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3"));
      if (!tracks.length) return res.status(500).json({ error: "no music" });

      const musicPath = path.join(MUSIC_DIR, pickRandom(tracks));
      const audioOffset = Math.floor(Math.random() * 8);
      const fadeOutStart = VIDEO_DURATION - FADE_OUT;

      const cmd = `
ffmpeg -y \
-stream_loop -1 -i "${inputPath}" \
-ss ${audioOffset} -i "${musicPath}" \
-filter_complex "
[0:v]trim=duration=${VIDEO_DURATION},setpts=PTS-STARTPTS[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} \
-pix_fmt yuv420p -movflags +faststart "${outputPath}"
`;

      exec(cmd, () => {
        const size = fs.statSync(outputPath).size;
        res.json({
          video_url: `${PUBLIC_BASE_URL}/videos/${outputFile}`,
          duration: VIDEO_DURATION,
          format: "mp4",
          binary_available: true,
          file_size: size
        });
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================
   =============== IMAGE LOOP (NEU) =========================
   ========================================================= */
app.post("/image-loop", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl missing" });
    }

    const id = crypto.randomUUID();
    const imagePath = `/tmp/${id}.img`;
    const outputFile = `${id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    exec(`curl -L "${imageUrl}" -o "${imagePath}"`, (err) => {
      if (err) return res.status(500).json({ error: "image download failed" });

      const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3"));
      if (!tracks.length) return res.status(500).json({ error: "no music" });

      const musicPath = path.join(MUSIC_DIR, pickRandom(tracks));
      const audioOffset = Math.floor(Math.random() * 8);
      const fadeOutStart = VIDEO_DURATION - FADE_OUT;

      const cmd = `
ffmpeg -y \
-loop 1 -i "${imagePath}" \
-ss ${audioOffset} -i "${musicPath}" \
-filter_complex "
[0:v]scale=1080:1920,format=yuv420p[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},
afade=t=in:st=0:d=${FADE_IN},
afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} \
-movflags +faststart "${outputPath}"
`;

      exec(cmd, () => {
        const size = fs.statSync(outputPath).size;
        res.json({
          video_url: `${PUBLIC_BASE_URL}/videos/${outputFile}`,
          duration: VIDEO_DURATION,
          format: "mp4",
          binary_available: true,
          file_size: size
        });
      });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
