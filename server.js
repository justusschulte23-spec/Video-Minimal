import express from "express";
import { renderFakeMotion } from "./renderer.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/render", async (req, res) => {
  try {
    const { image_url, duration = 16 } = req.body;
    if (!image_url) {
      return res.status(400).json({ error: "image_url missing" });
    }

    const videoPath = await renderFakeMotion(image_url, duration);
    res.sendFile(videoPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log("Shorts Fake Motion Engine running on", PORT)
);
