# Video Minimal – Shorts Video Looper

Creates TikTok / Shorts ready videos by looping short clips
and optionally adding copyright-free background music.

## Features
- Loop short MP4 videos to 15–20 seconds
- Optional baked-in background music
- Fully FFmpeg safe
- API-ready for n8n, Make, Zapier
- Designed for Shorts / Reels / TikTok

---

## API

### POST /loop

**Request**
```json
{
  "videoUrl": "https://cdn.example.com/input.mp4",
  "loops": 3,
  "music": true
}
