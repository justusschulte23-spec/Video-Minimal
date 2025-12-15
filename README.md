# Shorts Fake Motion Engine

Turns a single 9:16 image into a 16s TikTok-ready video
using perceptual fake motion (breathing + drift).

POST /render
{
  "image_url": "https://...",
  "duration": 16
}
