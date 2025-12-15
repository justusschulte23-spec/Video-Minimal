import fetch from "node-fetch";
import fs from "fs";
import { exec } from "child_process";
import { randomUUID } from "crypto";

export async function renderFakeMotion(imageUrl, duration) {
  const id = randomUUID();
  const img = `/tmp/${id}.jpg`;
  const out = `/tmp/${id}.mp4`;

  const res = await fetch(imageUrl);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(img, Buffer.from(buf));

  const cmd = `
ffmpeg -y -loop 1 -i ${img} \
-filter_complex "
zoompan=
z='1.0+0.015*sin(2*PI*t/5)':
x='iw/2-(iw/zoom/2)+6*sin(2*PI*t/9)':
y='ih/2-(ih/zoom/2)+4*cos(2*PI*t/7)':
d=1:s=1080x1920
" \
-t ${duration} -r 30 -pix_fmt yuv420p ${out}
`;

  await execAsync(cmd);
  return out;
}

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, err => (err ? reject(err) : resolve()));
  });
}
