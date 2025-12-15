import express from "express";
import fetch from "node-fetch";
import { exec } from "child_process";
import fs from "fs";

const app = express();
app.use(express.json());

app.post("/render", async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) return res.status(400).json({ error: "image_url missing" });

    // 1. Bild laden
    const img = await fetch(image_url);
    const buffer = await img.arrayBuffer();
    fs.writeFileSync("input.jpg", Buffer.from(buffer));

    // 2. Minimal Motion ffmpeg
    const cmd = `
    ffmpeg -y -loop 1 -i input.jpg \
    -filter_complex "
      scale=1080:1920,
      zoompan=z='min(zoom+0.0005,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=400,
      fps=25
    " \
    -t 16 \
    -pix_fmt yuv420p out.mp4
    `;

    exec(cmd, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "ffmpeg failed" });
      }
      res.sendFile(process.cwd() + "/out.mp4");
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Minimal Motion API running")
);
