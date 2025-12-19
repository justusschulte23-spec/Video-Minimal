import express from "express";
import { exec } from "child_process";
import fs from "fs";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

app.post("/render", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl missing" });
    }

    const id = crypto.randomUUID();
    const imgPath = `/tmp/${id}.jpg`;
    const outPath = `/tmp/${id}.mp4`;

    const img = await fetch(imageUrl);
    if (!img.ok) {
      return res.status(400).json({ error: "failed to fetch image" });
    }
    fs.writeFileSync(imgPath, Buffer.from(await img.arrayBuffer()));

    /**
     * FINAL SERVER-SAFE FAKE MOTION
     * - NO zoompan
     * - NO trig in crop
     * - deterministic, Railway-proof
     * - smooth, watchable 16s
     */

    const cmd = `
ffmpeg -y -hide_banner -loglevel error -loop 1 -i "${imgPath}" \
-vf "scale=1200:2133,
crop=1080:1920:(1200-1080)/2+0.8*t:(2133-1920)/2+0.6*t,
fps=30,
eq=brightness=0.004*t:contrast=1.015:saturation=1.02,
noise=alls=2:allf=t" \
-t 16 -shortest -pix_fmt yuv420p -movflags +faststart "${outPath}"
`;

    exec(cmd, { timeout: 20000 }, (err) => {
      if (err) {
        console.error("FFmpeg error:", err);
        return res.status(500).json({ error: err.message });
      }

      res.sendFile(outPath, () => {
        try { fs.unlinkSync(imgPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
      });
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Video-Minimal running (stable)");
});
