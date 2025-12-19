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
     * FINAL STABLE FAKE MOTION
     * - NO visible zoom in/out
     * - single slow push
     * - sub-pixel drift only
     * - zero jitter
     * - watchable 16s
     */

    const cmd = `
ffmpeg -y -hide_banner -loglevel error -loop 1 -i "${imgPath}" \
-vf "
scale=1080:1920,
format=yuv420p,
fps=30,

zoompan=
z='1.02 + 0.00002*on':
x='iw/2-(iw/zoom/2) + 1.2*sin(2*PI*on/900)':
y='ih/2-(ih/zoom/2) + 0.8*cos(2*PI*on/1000)':
d=480:s=1080x1920,

eq=
brightness=0.006*sin(2*PI*t/9):
contrast=1.015:
saturation=1.02,

noise=alls=3:allf=t
" \
-t 16 -movflags +faststart -pix_fmt yuv420p "${outPath}"
`;

    exec(cmd, { timeout: 30000 }, (err) => {
      if (err) {
        console.error(err);
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
  console.log("Fake Motion Engine running (stable mode)");
});
