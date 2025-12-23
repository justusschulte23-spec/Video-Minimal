import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";

const app = express();
app.use(express.json());

// 🔥 PUBLIC VIDEO HOSTING
const PUBLIC_DIR = "./public/videos";
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
app.use("/videos", express.static(PUBLIC_DIR));

const MUSIC_DIR = "./music";
const VIDEO_DURATION = 15;
const FADE_IN = 0.3;
const FADE_OUT = 0.3;
const MUSIC_VOLUME = 0.25;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

app.post("/loop", async (req, res) => {
  try {
    const { videoUrl, returnBinary = false } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    const videoPath = `/tmp/${id}_in.mp4`;
    const outPath = `/tmp/${id}_out.mp4`;
    const publicPath = path.join(PUBLIC_DIR, `${id}.mp4`);

    // Download input video
    exec(`curl -L "${videoUrl}" -o "${videoPath}"`, { timeout: 30000 }, (err) => {
      if (err) return res.status(500).json({ error: "video download failed" });

      const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3"));
      if (!tracks.length) return res.status(500).json({ error: "no music found" });

      const musicPath = path.join(MUSIC_DIR, pickRandom(tracks));
      const audioOffset = Math.floor(Math.random() * 8);
      const fadeOutStart = VIDEO_DURATION - FADE_OUT;

      const ffmpegCmd = `
ffmpeg -y -loglevel error \
-stream_loop -1 -i "${videoPath}" \
-ss ${audioOffset} -i "${musicPath}" \
-filter_complex "
[0:v]trim=duration=${VIDEO_DURATION},setpts=PTS-STARTPTS[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},asetpts=PTS-STARTPTS,
afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} \
-pix_fmt yuv420p -movflags +faststart "${outPath}"
`;

      exec(ffmpegCmd, { timeout: 60000 }, (err2) => {
        if (err2) return res.status(500).json({ error: "ffmpeg failed" });

        // Move to public
        fs.copyFileSync(outPath, publicPath);

        const videoUrlPublic = `${req.protocol}://${req.get("host")}/videos/${id}.mp4`;

        // CLEANUP TMP
        fs.unlinkSync(videoPath);
        fs.unlinkSync(outPath);

        // 🔥 OPTION A: JSON (TikTok / IG / FB / YT)
        if (!returnBinary) {
          return res.json({
            video_url: videoUrlPublic,
            duration: VIDEO_DURATION,
            format: "mp4"
          });
        }

        // 🔥 OPTION B: Binary (optional)
        res.sendFile(publicPath);
      });
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log("🎬 Video Looper + Public URL Engine running");
});
