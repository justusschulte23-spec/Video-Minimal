import express from "express";
import { exec } from "child_process";
import fs from "fs";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "10mb" }));

function execP(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

async function downloadTo(url, filePath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`failed to fetch: ${url} (${r.status})`);
  fs.writeFileSync(filePath, Buffer.from(await r.arrayBuffer()));
}

async function probeDurationSeconds(filePath) {
  // ffprobe returns seconds as float
  const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=nw=1:nk=1 "${filePath}"`;
  const { stdout } = await execP(cmd, { timeout: 15000 });
  const dur = parseFloat(String(stdout).trim());
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`ffprobe could not read duration for ${filePath} (got "${stdout}")`);
  }
  return dur;
}

/**
 * POST /loop
 * Body:
 * {
 *   videoUrl: string (required),
 *   loops: number (default 3),
 *   fade: number seconds (default 0.35),
 *   width: 1080, height: 1920, fps: 30,
 *   audioUrl: string (optional),
 *   musicVolume: 0..1 (default 0.22)
 * }
 */
app.post("/loop", async (req, res) => {
  const id = crypto.randomUUID();
  const inPath = `/tmp/in_${id}.mp4`;
  const musicPath = `/tmp/music_${id}`;
  const outPath = `/tmp/out_${id}.mp4`;

  try {
    const {
      videoUrl,
      loops = 3,
      fade = 0.35,
      width = 1080,
      height = 1920,
      fps = 30,
      audioUrl,
      musicVolume = 0.22,
    } = req.body || {};

    if (!videoUrl) return res.status(400).json({ error: "videoUrl missing" });
    const L = Math.max(2, Math.min(10, Number(loops) || 3)); // 2..10
    const F = Math.max(0.10, Math.min(1.0, Number(fade) || 0.35)); // 0.10..1.0

    // 1) Download input MP4
    await downloadTo(videoUrl, inPath);

    // 2) Probe duration
    const clipDur = await probeDurationSeconds(inPath);

    // Safety: fade must be smaller than clip duration
    const fadeSafe = Math.min(F, Math.max(0.10, clipDur * 0.25));
    const totalDur = (clipDur * L) - (fadeSafe * (L - 1));

    // 3) Build xfade chain
    // We reuse the same input multiple times by listing it multiple times as inputs.
    // That’s easiest + predictable.
    // We'll create L inputs: -i inPath repeated L times.
    const inputs = Array.from({ length: L }, () => `-i "${inPath}"`).join(" ");

    // Normalize each input stream: scale/fps/format/setpts
    const norm = (i) =>
      `[${i}:v]scale=${width}:${height},fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`;

    const normParts = Array.from({ length: L }, (_, i) => norm(i)).join(";");

    // Chain xfade:
    // offset for i-th transition (between i-1 and i) is:
    // offset = i*clipDur - i*fade
    // because each fade overlaps and shortens the total timeline.
    let chain = "";
    for (let i = 1; i < L; i++) {
      const offset = (i * clipDur) - (i * fadeSafe);
      const a = i === 1 ? `[v0][v1]` : `[x${i - 1}][v${i}]`;
      const out = i === L - 1 ? `[vout]` : `[x${i}]`;
      chain += `${a}xfade=transition=fade:duration=${fadeSafe}:offset=${offset}${out}`;
      if (i !== L - 1) chain += ";";
    }

    // 4) Optional music
    let audioInput = "";
    let audioFilter = "";
    let mapAudio = "";
    if (audioUrl) {
      // download audio (we don't assume extension; just store .bin)
      const musicFile = `${musicPath}.bin`;
      await downloadTo(audioUrl, musicFile);

      // Add as extra input: index = L
      audioInput = `-stream_loop -1 -i "${musicFile}"`;

      // Trim and set volume; output to [aout]
      // If your input clip has audio and you want to keep it: we can amix.
      // Right now: music only, clean + stable.
      audioFilter = `;[${L}:a]atrim=0:${totalDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${Number(musicVolume) || 0.22}[aout]`;
      mapAudio = `-map "[aout]" -c:a aac -b:a 160k`;
    }

    const filter = `${normParts};${chain}${audioFilter}`;

    // 5) Render
    const cmd = `
ffmpeg -y -hide_banner -loglevel error \
${inputs} ${audioInput} \
-filter_complex "${filter}" \
-map "[vout]" ${mapAudio} \
-t ${totalDur.toFixed(3)} \
-r ${fps} -pix_fmt yuv420p -movflags +faststart \
"${outPath}"
`.trim();

    await execP(cmd, { timeout: 120000 });

    res.sendFile(outPath, () => {
      // cleanup
      try { fs.unlinkSync(inPath); } catch {}
      try { fs.unlinkSync(outPath); } catch {}
      try { fs.unlinkSync(`${musicPath}.bin`); } catch {}
    });

  } catch (e) {
    console.error("LOOP ERROR:", e?.stderr || e);
    res.status(500).json({
      error: e?.err?.message || e?.message || "unknown error",
      ffmpeg_stderr: e?.stderr ? String(e.stderr).slice(-2000) : undefined,
    });

    // cleanup on failure
    try { fs.unlinkSync(inPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
    try { fs.unlinkSync(`${musicPath}.bin`); } catch {}
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Video-Minimal running (MP4 Looper + optional music)");
});
