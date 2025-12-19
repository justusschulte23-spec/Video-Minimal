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

    // Download image
    const img = await fetch(imageUrl);
    if (!img.ok) return res.status(400).json({ error: "failed to fetch imageUrl" });
    fs.writeFileSync(imgPath, Buffer.from(await img.arrayBuffer()));

    /**
     * NEXT-LVL FAKE MOTION (STABLE + HOOKY + WATCH-WORTHY)
     * - 16s output (480 frames @30fps)
     * - renders 17s internally then trims 0.5s off each side for seamless loop feel
     * - "Hook punch" in first ~0.8s (fast but smooth push-in), then settles into cinematic drift
     * - slow handheld drift (no jitter), breathing illusion via micro zoom modulation
     * - subtle light life + fine grain + micro vignette
     * - NO face/body morphing (pure camera illusion)
     */
    const cmd = `
ffmpeg -y -hide_banner -loglevel error -loop 1 -i "${imgPath}" \
-filter_complex "
[0:v]
scale=1080:1920,
format=yuv420p,
fps=30,
zoompan=
  z='
     (1.060 - 0.025*min(on,24)/24)
     + 0.010*sin(2*PI*on/480)
   ':
  x='iw/2-(iw/zoom/2) + 3.5*sin(2*PI*on/720)':
  y='ih/2-(ih/zoom/2) + 2.5*cos(2*PI*on/640)':
  d=510:s=1080x1920:fps=30,
trim=start=0.5:end=16.5,
setpts=PTS-STARTPTS,

eq=
  brightness='0.010*sin(2*PI*t/7.0)':
  contrast=1.020:
  saturation=1.030,

vignette=
  angle=PI/4:
  x=0.5:y=0.5:
  strength='0.12 + 0.02*sin(2*PI*t/8.0)',

noise=alls=4:allf=t,

unsharp=5:5:0.20:5:5:0.00
[outv]
" \
-map "[outv]" -t 16 -r 30 -movflags +faststart -pix_fmt yuv420p "${outPath}"
`;

    exec(cmd, { timeout: 30000 }, (err) => {
      if (err) {
        console.error(err);
        try { fs.existsSync(imgPath) && fs.unlinkSync(imgPath); } catch {}
        return res.status(500).json({ error: err.message });
      }

      res.sendFile(outPath, () => {
        try { fs.existsSync(imgPath) && fs.unlinkSync(imgPath); } catch {}
        try { fs.existsSync(outPath) && fs.unlinkSync(outPath); } catch {}
      });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Fake Motion Engine running");
});
