import express from "express";
import { renderFakeMotion } from "./renderer.js";

const app = express();
app.use(express.json());

app.post("/render", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl missing" });
    }

    const videoPath = await renderFakeMotion(imageUrl);

    res.sendFile(videoPath);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Fake Motion Engine listening on ${PORT}`);
});
