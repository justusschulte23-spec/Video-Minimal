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
    if (!imageUrl) return res.status(400).json({ error: "imageUrl missing" });

    const id = crypto.randomUUID();
    const imgPath = `/tmp/${id}.jpg`;
    const outPath = `/tmp/${id}.mp4`;

    const img = await fetch(imageUrl);
    if (!img.ok) return res.status(400).json({ error: "failed to fetch image" });
    fs.writeFileSync(imgPath, Buffer.from(await img.arrayBuffer()));

    /**
     * FAKE MOTION – SERVER SAFE
     * - sichtbar lebendig
     * - keine verbotenen Variablen
     * - 100 % FFmpeg-konform
     */

    const cmd = `
ffmpeg -y -hide_banner -loglevel error -loop 1 -i "${imgPath}" \
-vf "
scale=1080:1920,
zoompan=
z='1.0+0.035*on/480':
x='iw/2-(iw/zoom/2)+3':
y='ih/2-(ih/zoom/2)+2':
d=480:s=1080x1920,
fps=30,
eq=brightness=0.01:contrast=1.03:saturation=1.05,
noise=alls=4:allf=t
" \
-t 16 -pix_fmt yuv420p -movflags +faststart "${outPath}"
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
  console.log("Video-Minimal running (FFmpeg-safe)");
});
