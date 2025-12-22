import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";

const app = express();
app.use(express.json());

const MUSIC_DIR = "./music";
const VIDEO_DURATION = 15;      // seconds output
const FADE_IN = 0.3;            // seconds (micro)
const FADE_OUT = 0.3;           // seconds (micro)
const MUSIC_VOLUME = 0.25;      // 0.25 = -12dB-ish (good BG music)

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

app.post("/loop", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });

    const id = crypto.randomUUID();
    const videoPath = `/tmp/${id}_in.mp4`;
    const outPath = `/tmp/${id}_out.mp4`;

    // Download video
    const curlCmd = `curl -L "${videoUrl}" -o "${videoPath}"`;
    exec(curlCmd, { timeout: 30000 }, (err) => {
      if (err) {
        console.error("curl error:", err);
        return res.status(500).json({ error: "video download failed" });
      }

      // Pick random music
      const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.toLowerCase().endsWith(".mp3"));
      if (!tracks.length) return res.status(500).json({ error: "no music found" });

      const musicFile = pickRandom(tracks);
      const musicPath = path.join(MUSIC_DIR, musicFile);

      // random audio start offset (0–8s)
      const audioOffset = Math.floor(Math.random() * 8);

      // Real loop video by repeating input forever, then trim to exact duration
      const fadeOutStart = Math.max(0, VIDEO_DURATION - FADE_OUT);

      const ffmpegCmd = `
ffmpeg -y -hide_banner -loglevel error \
-stream_loop -1 -i "${videoPath}" \
-ss ${audioOffset} -i "${musicPath}" \
-filter_complex "
[0:v]trim=duration=${VIDEO_DURATION},setpts=PTS-STARTPTS[v];
[1:a]volume=${MUSIC_VOLUME},atrim=duration=${VIDEO_DURATION},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${fadeOutStart}:d=${FADE_OUT}[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} \
-pix_fmt yuv420p -movflags +faststart "${outPath}"
`;

      exec(ffmpegCmd, { timeout: 60000 }, (err2) => {
        if (err2) {
          console.error("ffmpeg error:", err2);
          return res.status(500).json({ error: "ffmpeg failed" });
        }

        res.sendFile(outPath, () => {
          try { fs.unlinkSync(videoPath); } catch {}
          try { fs.unlinkSync(outPath); } catch {}
        });
      });
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log("🎬 Video Looper + Music Engine running");
});
