import express from "express";
import { exec } from "child_process";
import fs from "fs";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

/**
 * POST /loop
 * {
 *   videoUrl: "https://cdn....mp4",
 *   loops: 3,
 *   music: true
 * }
 */
app.post("/loop", async (req, res) => {
  try {
    const { videoUrl, loops = 3, music = true } = req.body;

    if (!videoUrl || typeof videoUrl !== "string") {
      return res.status(400).json({ error: "videoUrl missing or invalid" });
    }

    const id = crypto.randomUUID();
    const inputPath = `/tmp/${id}_input.mp4`;
    const outputPath = `/tmp/${id}_output.mp4`;

    // download video
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error("Failed to download video");
    fs.writeFileSync(inputPath, Buffer.from(await videoRes.arrayBuffer()));

    const safeLoops = Math.max(1, Math.min(Number(loops), 5));

    let musicInput = "";
    let audioMap = "";

    if (music) {
      const track = pickMusic();
      musicInput = `-stream_loop -1 -i "/app/music/${track}"`;
      audioMap = `-map 0:v:0 -map 1:a:0 -shortest -c:a aac -b:a 128k`;
    }

    const cmd = `
ffmpeg -y -hide_banner -loglevel error \
-stream_loop ${safeLoops - 1} -i "${inputPath}" \
${musicInput} \
-c:v copy \
${audioMap} \
-movflags +faststart \
"${outputPath}"
`;

    exec(cmd, { timeout: 30000 }, (err) => {
      if (err) {
        console.error("FFmpeg error:", err);
        return res.status(500).json({ error: err.message });
      }

      res.sendFile(outputPath, () => {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
      });
    });

  } catch (e) {
    console.error("LOOP ERROR:", e);
    res.status(500).json({ error: e.message });
  }
});

function pickMusic() {
  const files = fs.readdirSync("/app/music").filter(f => f.endsWith(".mp3"));
  if (!files.length) throw new Error("No music files found");
  return files[Math.floor(Math.random() * files.length)];
}

app.listen(process.env.PORT || 8080, () => {
  console.log("Video-Minimal running (Looper + Music)");
});
