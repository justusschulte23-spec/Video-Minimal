import express from "express";
import { exec } from "child_process";
import fs from "fs";
import crypto from "crypto";
import path from "path";

const app = express();
app.use(express.json());

const MUSIC_DIR = "./music";
const VIDEO_DURATION = 15; // Sekunden
const AUDIO_DURATION = 17; // leicht länger für Fade

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

    // Video laden
    const curlCmd = `curl -L "${videoUrl}" -o "${videoPath}"`;
    exec(curlCmd, (err) => {
      if (err) return res.status(500).json({ error: "video download failed" });

      // Musik zufällig wählen
      const tracks = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith(".mp3"));
      if (!tracks.length) return res.status(500).json({ error: "no music found" });

      const musicFile = pickRandom(tracks);
      const musicPath = path.join(MUSIC_DIR, musicFile);

      // zufälliger Audio-Start (0–8s)
      const audioOffset = Math.floor(Math.random() * 8);

      const ffmpegCmd = `
ffmpeg -y -hide_banner -loglevel error \
-i "${videoPath}" \
-ss ${audioOffset} -i "${musicPath}" \
-filter_complex "
[0:v]tpad=stop_mode=clone:stop_duration=5[v];
[1:a]afade=t=in:st=0:d=0.5,afade=t=out:st=${AUDIO_DURATION - 0.5}:d=0.5[a]
" \
-map "[v]" -map "[a]" \
-t ${VIDEO_DURATION} \
-pix_fmt yuv420p -movflags +faststart "${outPath}"
`;

      exec(ffmpegCmd, { timeout: 30000 }, (err2) => {
        if (err2) {
          console.error(err2);
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
