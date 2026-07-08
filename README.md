# VideoFlow

VideoFlow is a local AI video production workspace. It turns a prepared narration script into segmented video copy, storyboard images, a full voiceover, captions, and a rendered MP4.

The app runs locally. API keys are stored only in `app-config.local.json`, which is ignored by git.

## Features

- Create projects with `9:16`, `16:9`, `1:1`, or `4:5` video ratios.
- Clean and segment Chinese narration with an OpenAI-compatible chat model.
- Generate one storyboard image for each segment.
- Generate a complete MiniMax voiceover with captions and segment timings.
- Preview storyboard images, voiceover, and final video.
- Render MP4 with FFmpeg, captions, voiceover, and optional BGM.
- Add reusable visual templates under `templates/<template-id>/`.

## Requirements

- Node.js 20 or newer
- npm
- FFmpeg and FFprobe available in `PATH`
- An OpenAI-compatible API key for script and image generation
- A MiniMax API key and voice ID for voiceover generation

If FFmpeg is not in `PATH`, set:

```bash
export FFMPEG_PATH=/absolute/path/to/ffmpeg
export FFPROBE_PATH=/absolute/path/to/ffprobe
```

## Quick Start

```bash
npm install
cp app-config.example.json app-config.local.json
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

You can also configure models from the settings dialog in the app. Values saved there update `app-config.local.json`.

## Configuration

`app-config.local.json` is intentionally not committed. Use `app-config.example.json` as the template.

Main fields:

- `baseUrl`: OpenAI-compatible API base URL, for example `https://api.openai.com/v1`.
- `model`: Chat model used for script cleanup.
- `apiKey`: API key for chat and image generation.
- `image.model`: Image generation model.
- `audio.minimaxApiKey`: MiniMax API key.
- `audio.minimaxGroupId`: Optional MiniMax group ID.
- `audio.minimaxVoiceId`: MiniMax voice ID.

## Workflow

1. Create a project and choose a video ratio plus visual template.
2. Paste prepared narration in the content page.
3. Click start to let the model clean and segment the script.
4. Generate storyboard images.
5. Generate the full voiceover.
6. Render the final MP4.

Generated files are written to:

```text
projects/<project-id>/
  project.json
  source.md
  segments.json
  script.json
  visual-bible.json
  render-plan.json
  storyboards/
  storyboards.json
  voiceover.wav
  captions.vtt
  timings.json
  renders/final.mp4
```

The `projects/` directory is ignored by git except for documentation placeholders.

## Templates

Visual templates live in:

```text
templates/<template-id>/
  template.json
  image-style.md
```

The current built-in template is:

- `stickman`: minimal whiteboard Chinese explainer illustrations.

See `templates/README.md` for template metadata and prompt guidance.

## BGM Asset

The app looks for `assets/bgm.mp3` when background music is enabled. Replace it with your own licensed audio before publishing or distributing rendered videos.

If you are publishing a public fork, make sure every asset in `assets/` has a license that allows redistribution.

Optional subtitle fonts can be placed in `assets/fonts/`. Do not commit proprietary system fonts unless their license allows redistribution.

## Scripts

```bash
npm run dev          # build client and start the local server
npm run start        # start the server using the existing client build
npm run check        # type-check the client and syntax-check the server
npm run client:dev   # run Vite dev server for frontend-only development
npm run client:build # build the frontend
```

See `CONTRIBUTING.md` and `SECURITY.md` before publishing a fork or sending changes.

## Health Check

After starting the server:

```bash
curl http://127.0.0.1:5173/api/health
```

This reports whether FFmpeg, FFprobe, MiniMax settings, and BGM are available.

## License

MIT
