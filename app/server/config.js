const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const CLIENT_DIST_DIR = path.join(__dirname, "..", "client", "dist");
const PUBLIC_DIR = CLIENT_DIST_DIR;
const PROJECTS_DIR = path.join(ROOT, "projects");
const ASSETS_DIR = path.join(ROOT, "assets");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const SETTINGS_FILE = path.join(ROOT, "app-config.local.json");

const PORT = Number(process.env.PORT || 5173);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const DEFAULT_AUDIO_SETTINGS = {
  provider: "minimax",
  minimaxApiKey: "",
  minimaxGroupId: "",
  minimaxBaseUrl: "https://api.minimax.io",
  minimaxModel: "speech-2.8-hd",
  minimaxVoiceId: "moss_audio_eb11b905-72f1-11f1-b432-da8cea034f66",
  minimaxSpeed: 1,
  minimaxVolume: 1,
  minimaxPitch: 0,
  minimaxFormat: "wav",
  minimaxSampleRate: 32000,
  minimaxBitrate: 128000,
};

const DEFAULT_VIDEO_SETTINGS = {
  captionsEnabled: true,
  captionPosition: "bottom",
  bgmEnabled: true,
  playbackSpeed: 1,
};

const DEFAULT_IMAGE_SETTINGS = {
  model: "gpt-image-2",
  quality: "medium",
  outputFormat: "png",
};

const aspectRatioSizes = {
  "9:16": { width: 720, height: 1280 },
  "16:9": { width: 1280, height: 720 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

function normalizeVideoSettings(input = {}) {
  const position = ["top", "middle", "bottom"].includes(input.captionPosition) ? input.captionPosition : DEFAULT_VIDEO_SETTINGS.captionPosition;
  const speed = Number(input.playbackSpeed);
  const playbackSpeed = Number.isFinite(speed) ? Math.max(1, Math.min(1.5, speed)) : DEFAULT_VIDEO_SETTINGS.playbackSpeed;
  return {
    captionsEnabled: typeof input.captionsEnabled === "boolean" ? input.captionsEnabled : DEFAULT_VIDEO_SETTINGS.captionsEnabled,
    captionPosition: position,
    bgmEnabled: typeof input.bgmEnabled === "boolean" ? input.bgmEnabled : DEFAULT_VIDEO_SETTINGS.bgmEnabled,
    playbackSpeed,
  };
}

module.exports = {
  ROOT,
  CLIENT_DIST_DIR,
  PUBLIC_DIR,
  PROJECTS_DIR,
  ASSETS_DIR,
  TEMPLATES_DIR,
  SETTINGS_FILE,
  PORT,
  FFMPEG,
  FFPROBE,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_VIDEO_SETTINGS,
  DEFAULT_IMAGE_SETTINGS,
  aspectRatioSizes,
  normalizeVideoSettings,
  hasClientDist: fs.existsSync(CLIENT_DIST_DIR),
};
