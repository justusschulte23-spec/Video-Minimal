import express from "express";
import { exec } from "child_process";
import fs from "fs";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json());

app.post("/render", async (req, res) => {
  const startTime = Date.now();

  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl missing" });
    }

    const id = crypto.randomUUID();
    const imgPath = `/tmp/${id}.jpg`;
    const outPath = `/tmp/${id}.mp4`;

    // Fetch image
    const img = await fetch(imageUrl);
    if (!img.ok) {
      return res.status(400).json({ error: "failed to fetch image" });
    }
    fs.writeFileSync(imgPath, Buffer.from(await img.arrayBuffer()));

    /**
     * STABLE FAKE MOTION (SERVER SAFE)
     * - no zoompan
     * - deterministic duration
     * - finishes reliably
     * - Railway compatible
     */

    const cmd = `
ffmpeg -y -hide_banner -loglevel error -loop 1 -i "${imgPath}" \
-vf "
scale=1200:2133,
crop=1080:1920:
  (1200-1080)/2 + 2*sin(2*PI*t/12):
  (2133-1920)/2 + 2*cos(2*PI*t/14),
fps=30,
eq=brightness=0.006*sin(2*PI*t/9):contrast=1.015:saturation=1.02,
noise=alls=3:
