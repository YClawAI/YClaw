# Video Generation Skill

Forge can generate videos via two providers: **xAI Grok Imagine** (fast, 480p/720p) and **Google Veo 3.1** (high-fidelity, 1080p with synced audio).

## Provider 1: xAI Grok Imagine Video

Uses the same `XAI_API_KEY` as image generation. Async — requires polling.

### Capabilities
- **Text-to-video**: Generate video from a text prompt
- **Image-to-video**: Animate a static image (e.g., turn a generated image into motion)
- **Video editing**: Modify existing videos with natural language instructions

### API Reference

**Base URL:** `https://api.x.ai/v1`
**Auth:** `Authorization: Bearer $XAI_API_KEY`

#### Text-to-Video
```
POST /videos/generations
{
  "model": "grok-imagine-video",
  "prompt": "A golden retriever running through a sunny meadow, slow motion",
  "duration": 10,
  "aspect_ratio": "16:9",
  "resolution": "720p"
}
```

**Parameters:**
| Param | Type | Default | Options |
|-------|------|---------|---------|
| prompt | string | required | Video description |
| duration | number | 10 | 1-15 seconds |
| aspect_ratio | string | "16:9" | 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3 |
| resolution | string | "480p" | "480p" or "720p" |

**Response:** Returns `request_id` for polling.

#### Image-to-Video
```
POST /videos/generations
{
  "model": "grok-imagine-video",
  "prompt": "Make the clouds move slowly across the sky",
  "image": {"url": "https://..."},
  "duration": 10
}
```

#### Video Editing
```
POST /videos/generations
{
  "model": "grok-imagine-video",
  "prompt": "Add warm sunset filter and slow to 50% speed",
  "video": {"url": "https://..."}
}
```

#### Polling for Completion
```
GET /videos/generations/{request_id}
Authorization: Bearer $XAI_API_KEY
```
Poll every 5-10 seconds. Takes 1-3 minutes. Response includes `video.url` when done.

### Limits
- Duration: 1-15 seconds
- Resolution: 480p (faster) or 720p (better quality)
- Rate limit: 60 requests/minute
- Max concurrent: 15 jobs

### Prompt Tips for Video
- Be specific about motion: "camera slowly pans left to right"
- Describe lighting: "warm golden hour lighting"
- Include subject action: "walking", "floating", "dissolving"
- Keep under 10 seconds unless essential (faster, cheaper)
- Start with text-to-video, then refine with editing

---

## Provider 2: Google Veo 3.1

Higher quality output — 1080p with synced audio. Uses `GEMINI_API_KEY`.

### API Reference

**Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-preview:predictLongRunning`
**Auth:** `X-goog-api-key: $GEMINI_API_KEY`

```
POST /v1beta/models/veo-3.0-generate-preview:predictLongRunning
{
  "instances": [{"prompt": "Cinematic shot of ocean waves at sunset, drone perspective"}],
  "parameters": {
    "aspectRatio": "9:16",
    "personGeneration": "dont_allow"
  }
}
```

**Parameters:**
| Param | Type | Options |
|-------|------|---------|
| prompt | string | Video description |
| aspectRatio | string | "9:16" (default), "16:9" |
| personGeneration | string | "dont_allow" (safer) |

**Response:** Returns operation name for polling via `GET /v1beta/{operation_name}`.

### When to Use Which

| Need | Provider | Why |
|------|----------|-----|
| Quick social clip | xAI Grok | Faster, good enough for X/TG |
| Hero/showcase video | Veo 3.1 | 1080p, synced audio, cinematic quality |
| Animate a generated image | xAI Grok | Has image-to-video capability |
| Edit existing video | xAI Grok | Has video editing via NL |
| Vertical/story format | Either | Both support 9:16 |

---

## Available Actions

All video actions are live and registered:

- **`video:text_to_video`** — xAI Grok Imagine text-to-video with async polling
- **`video:image_to_video`** — xAI image animation with async polling  
- **`video:edit`** — xAI video editing via natural language
- **`video:veo_generate`** — Google Veo 3.1 high-fidelity 1080p generation

All xAI actions use `XAI_API_KEY`. Veo uses `GEMINI_API_KEY`. Both poll automatically (up to 5 minutes).
