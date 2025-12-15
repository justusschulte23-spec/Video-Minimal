import express from "express";
import { exec } from "child_process";
import fs from "fs";
import fetch from "node-fetch";

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
    fs.writeFileSync(imgPath, Buffer.from(await img.arrayBuffer()));

   const cmd = `
ffmpeg -y -loop 1 -i ${imgPath} \
-vf "
scale=1080:1920,
zoompan=
z='1.02+0.015*sin(2*PI*on/240)':
x='iw/2-(iw/zoom/2)+8*sin(2*PI*on/360)':
y='ih/2-(ih/zoom/2)+6*cos(2*PI*on/300)':
d=480:s=1080x1920,
fps=30
" \
-t 16 -pix_fmt yuv420p ${outPath}
`;

    exec(cmd, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.sendFile(outPath);
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 8080);
