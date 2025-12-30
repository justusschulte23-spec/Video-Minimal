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

// WICHTIG: größere JSON Bodies erlauben (Base64 kann groß sein)
app.use(express.json({ limit: "50mb" }));
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

function pickMusicOrFail(res) {
  const tracks = fs.readdirSync(MUSIC_DIR).filter((f) => f.endsWith(".mp3"));
  if (!tracks.length) {
    res.status(500).json({ error: "no music found in ./music" });
    return null;
  }
  return path.join(MUSIC_DIR, pickRandom(tracks));
}

function runCmd(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

function mimeToExt(mime = "") {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "jpg";
}

function inferImageExtFromUrl(url = "") {
  const u = url.toLowerCase();
  if (u.includes(".png")) return "png";
  if (u.includes(".webp")) return "webp";
  if (u.includes(".jpeg")) return "jpg";
  if (u.includes(".jpg")) return "jpg";
  return "jpg";
}

/* =========================================================
   ===================== VIDEO LOOP ========================
   =========================================================
   Input: { videoUrl: "https://....mp4" }
   Output: { video_url, duration, format, binary_available, file_size }
*/
app.post("/loop", async (req, res) => {
  let inputPath = null;
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    inputPath = `/tmp/${id}_in.mp4`;
    const outputFile = `${id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    // Download video
    await runCmd(`curl -L --max-time 60 "${videoUrl}" -o "${inputPath}"`, {
      timeout: 70000,
      maxBuffer: 20 * 1024 * 1024,
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

    await runCmd(ffmpegCmd, { timeout: 180000, maxBuffer: 20 * 1024 * 1024 });
    safeUnlink(inputPath);

    const size = fs.statSync(outputPath).size;
    return res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${outputFile}`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size,
    });
  } catch (e) {
    safeUnlink(inputPath);
    return res.status(500).json({
      error: "video loop failed",
      details: e?.stderr || e?.err?.message || e?.message || String(e),
    });
  }
});

/* =========================================================
   ===================== IMAGE LOOP ========================
   =========================================================
   EMPFOHLEN (funktioniert auch wenn URL 403):
   Input:
   {
     "imageBase64": "<BASE64 OHNE data:... prefix ODER MIT prefix>",
     "imageMime": "image/jpeg"   // optional
   }

   Optional (nur wenn URL wirklich öffentlich erreichbar):
   { "imageUrl": "https://.....jpg" }
*/
app.post("/image-loop", async (req, res) => {
  let imagePath = null;
  try {
    const { imageUrl, imageBase64, imageMime } = req.body || {};

    const id = crypto.randomUUID();
    const outputFile = `${id}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    // 1) Bildquelle herstellen (URL oder Base64)
    if (imageBase64) {
      // erlaubt sowohl "data:image/jpeg;base64,AAAA" als auch nur "AAAA"
      const hasPrefix = typeof imageBase64 === "string" && imageBase64.startsWith("data:");
      let b64 = imageBase64;

      let mime = imageMime || "image/jpeg";
      if (hasPrefix) {
        const m = imageBase64.match(/^data:(.+?);base64,(.*)$/);
        if (!m) return res.status(400).json({ error: "invalid data url" });
        mime = m[1] || mime;
        b64 = m[2];
      }

      const ext = mimeToExt(mime);
      imagePath = `/tmp/${id}.${ext}`;
      fs.writeFileSync(imagePath, Buffer.from(b64, "base64"));
    } else if (imageUrl) {
      // URL Mode (kann bei Leonardo 403 geben)
      const ext = inferImageExtFromUrl(imageUrl);
      imagePath = `/tmp/${id}.${ext}`;

      // Versuch mit brauchbaren Headers (hilft manchmal, aber nicht bei echten Private-CDNs)
      await runCmd(
        `curl -L --max-time 60 -H "User-Agent: Mozilla/5.0" -H "Accept: image/*,*/*;q=0.8" "${imageUrl}" -o "${imagePath}"`,
        { timeout: 70000, maxBuffer: 20 * 1024 * 1024 }
      );

      // Quick sanity check: wenn HTML statt Bild → fail early
      const head = fs.readFileSync(imagePath, { encoding: "utf8" }).slice(0, 200).toLowerCase();
      if (head.includes("<html") || head.includes("access denied") || head.includes("forbidden")) {
        safeUnlink(imagePath);
        return res.status(403).json({
          error: "imageUrl not fetchable (likely 403 from source)",
          hint: "Use imageBase64 mode (n8n downloads image, then send base64 to this endpoint).",
        });
      }
    } else {
      return res.status(400).json({ error: "imageUrl missing (or provide imageBase64)" });
    }

    // 2) Musik
    const musicPath = pickMusicOrFail(res);
    if (!musicPath) return;

    const audioOffset = Math.floor(Math.random() * 8);
    const fadeOutStart = Math.max(0, VIDEO_DURATION - FADE_OUT);

    // 3) FFmpeg: Bild → 15s MP4 9:16 ohne Verzerrung, mit Musik
    const ffmpegCmd = `
ffmpeg -y -hide_banner -loglevel error \
-loop 1 -framerate 30 -i "${imagePath}" \
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
-t ${VIDEO_DURATION} -r 30 \
-movflags +faststart "${outputPath}"
`;

    await runCmd(ffmpegCmd, { timeout: 180000, maxBuffer: 20 * 1024 * 1024 });

    safeUnlink(imagePath);

    const size = fs.statSync(outputPath).size;
    return res.json({
      video_url: `${PUBLIC_BASE_URL}/videos/${outputFile}`,
      duration: VIDEO_DURATION,
      format: "mp4",
      binary_available: true,
      file_size: size,
    });
  } catch (e) {
    safeUnlink(imagePath);
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
