const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  ROOT,
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
} = require("./server/config");
const { mimeTypes, json, text, html, escapeHtml } = require("./server/http");
const { safeId, projectPath, exists, readJson, writeJson } = require("./server/storage");
const { now } = require("./server/time");
const { runCommand } = require("./server/commands");
const { jobs, publicJob, createProjectJob, throwIfAborted } = require("./server/jobs");

const STORYBOARD_IMAGE_CONCURRENCY = 3;
const ASS_CAPTION_FONT = "Hiragino Sans GB";
const ASS_FONTS_DIR = path.join(ASSETS_DIR, "fonts");

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

const DEFAULT_SCRIPT_SYSTEM_PROMPT =
  "你是视频分镜整理师。你只输出合法 JSON，不要 Markdown，不要解释。你的任务不是重写脚本，而是把用户已经写好的中文视频旁白清理、拆分成适合配音和配图的 segments，为每段生成模板无关的画面描述，并建立全片视觉圣经 visualBible。切分时必须优先保证每个 segment 都能被一张静态分镜图完整表达。";

const DEFAULT_SCRIPT_USER_PROMPT = `请把下面用户已经写好的中文视频旁白整理成可生产的视频脚本，并同步规划静态分镜图。

分镜风格模板：{{templateId}}

要求：
1. 用户输入的是已经写好的视频旁白。不要二次创作，不要重写开头，不要补充新观点，不要扩写，不要改成你自己的文案。
2. 必须尽量保留原文措辞、语气、顺序和信息。只允许做这些最小修改：去掉明显重复段落、去掉多余空行、修正明显错别字、去掉不适合 TTS 的编号或 Markdown 符号。
3. 先分析旁白的语义推进，再切 segment。切分标准不是一句话或一个标点，而是“一个画面节拍能否被一张静态分镜完整承载”。
4. 每个 segment 对应一个画面节拍，不是一句话。一个 segment 可以包含 1-3 句自然连续的旁白，只要它们共享同一个场景、同一个解释对象、同一个比喻、同一个主角动作或同一个情绪状态。
5. 优先保持旁白听感自然，不要为了配图把句子过度切碎。短视频画面可以停留 6-10 秒，一张图可以承载一个主观点和一句简短补充。
6. 每个 segment.narration 建议 35-90 个中文字符，最长不要超过 120 个中文字符。长度只是辅助标准，优先级低于画面节拍完整性。
7. 如果几句话共享同一个场景、同一个主角动作、同一个隐喻或同一个解释对象，应该合并为一个 segment。
8. 只有当画面主体、场景、隐喻、动作、论点或例子发生明显变化，或者一张静态图无法完整承载时，才拆成新的 segment。
9. 严禁 visualDescription 只覆盖 narration 的部分内容。每个 visualDescription 必须能覆盖该 segment.narration 的全部信息。
10. 严禁 segment.narration 中出现对应图片之外的额外内容。凡是画面无法表达或会让画面只覆盖一半的旁白，都要重新调整切分。
11. 不要改写旁白来追求更强钩子。开头好不好由用户自己负责，你只负责清理、切分和画面规划。
12. 不要编造任何原文没有的信息、年份、机构、人名、实验、数据或例子。
13. 不要输出整段 narration 后交给系统硬切。必须直接输出 segments 数组。
14. 先通读全文，提取 visualBible。visualBible 描述这个视频里反复出现或需要保持一致的角色、物品、场景和符号。只收录对跨分镜一致性有价值的实体，不要把一次性小道具都收进去。
15. visualBible 必须模板无关。不能写“小黑、火柴人、某种画风、具体模板名”。只能写稳定身份、轮廓、关键特征、关系和禁止变化项。
16. visualBible 每个实体必须有稳定 id。id 使用英文小写 snake_case，例如 main_character、phone、crow、spotlight。
17. 每个 segment 必须输出 entities 数组，引用 visualBible 里的实体 id。若该段没有任何全局实体，entities 输出空数组。
18. 每个 segment 对应一张静态分镜图。visualDescription 要为这一整个画面节拍生成一个可画的画面描述。
19. visualDescription 必须模板无关。使用“主角、人物、角色、研究者、孩子、公司、系统、机器、城市、房间”等通用词，不要写“火柴人、猫、吉祥物、具体画风或模板名”。
20. visualDescription 要具体可画：写清场景、主角动作、关键道具和画面关系。不要写抽象主题词、镜头运动、具体颜色值、字体、布局尺寸或动效代码。
21. visualDescription 可以把抽象句落成具体画面，但不能改变 narration 的意思，也不能漏掉 narration 的关键信息。
22. 输出前逐段自检：这段旁白是否是一个完整画面节拍？一张图是否能完整表达这 1-3 句？如果过碎，合并；如果一张图表达不完，再拆分。
23. 输出必须是合法 JSON，字段必须符合下面 schema：

{
  "title": "视频标题，不超过 30 个中文字符，从用户旁白内容中概括，不要标题党",
  "visualBible": {
    "characters": [
      {
        "id": "main_character",
        "name": "主角的语义名称",
        "role": "这个角色在视频中的作用",
        "stableDescription": "模板无关的稳定外观、轮廓、姿态倾向和关键特征",
        "doNotChange": ["不要改变身份", "不要改变核心轮廓"]
      }
    ],
    "objects": [
      {
        "id": "recurring_object",
        "name": "物品名称",
        "role": "这个物品在视频中的作用",
        "stableDescription": "稳定轮廓、关键部件、尺寸关系和识别点",
        "doNotChange": ["不要换成其他物品"]
      }
    ],
    "places": [],
    "symbols": []
  },
  "segments": [
    {
      "narration": "尽量保留用户原文的一个画面节拍，可包含 1-3 句自然连续旁白。",
      "visualDescription": "模板无关的画面描述。用主角/人物这类通用词，写清同一张图里的场景、动作、道具和关系。",
      "entities": ["main_character", "recurring_object"]
    }
  ]
}

用户旁白：
{{source}}`;

function listVideoTemplates() {
  const entries = fs.existsSync(TEMPLATES_DIR) ? fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true }) : [];
  const templates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const template = readJsonSync(path.join(TEMPLATES_DIR, entry.name, "template.json"), null);
      if (!template?.id) return null;
      return {
        id: template.id,
        name: template.name || template.id,
        description: template.description || "",
        category: template.category || "editorial",
        aspectRatios: template.aspectRatios || Object.keys(aspectRatioSizes),
        preview: template.preview || null,
        imageStyle: {
          promptFile: template.imageStyle?.promptFile || "image-style.md",
          background: template.imageStyle?.background || "#ffffff",
          ink: template.imageStyle?.ink || "#111111",
          muted: template.imageStyle?.muted || "#4a4a4a",
          accent: template.imageStyle?.accent || "#f05a28",
          secondary: template.imageStyle?.secondary || "#2367d1",
          surface: template.imageStyle?.surface || "#ffffff",
        },
      };
    })
    .filter(Boolean);
  return templates;
}

function readJsonSync(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeTemplateId(value) {
  const templates = listVideoTemplates();
  const id = String(value || "");
  if (templates.some((template) => template.id === id)) return id;
  return templates[0]?.id || "stickman";
}


function templateDir(templateId) {
  return path.join(TEMPLATES_DIR, normalizeTemplateId(templateId));
}

async function readTemplateText(templateId, file, fallback = "") {
  return fsp.readFile(path.join(templateDir(templateId), file), "utf8").catch(() => fallback);
}


function splitCaptionText(text, maxChars = 36) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return [];
  const roughParts = source
    .split(/(?<=[。！？!?；;，,、：:])/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const mergedParts = [];
  for (const part of roughParts.length ? roughParts : [source]) {
    const previous = mergedParts[mergedParts.length - 1];
    if (previous && (previous.length < 9 || part.length < 9) && previous.length + part.length <= maxChars) {
      mergedParts[mergedParts.length - 1] = `${previous}${part}`;
    } else {
      mergedParts.push(part);
    }
  }
  const chunks = [];
  for (const part of mergedParts) {
    if (part.length <= maxChars) {
      chunks.push(part);
      continue;
    }
    let cursor = 0;
    while (cursor < part.length) {
      const remaining = part.slice(cursor);
      if (remaining.length <= maxChars) {
        chunks.push(remaining.trim());
        break;
      }
      const windowText = remaining.slice(0, maxChars + 1);
      const punctuationBreak = Math.max(
        windowText.lastIndexOf("，"),
        windowText.lastIndexOf("、"),
        windowText.lastIndexOf("；"),
        windowText.lastIndexOf(";"),
        windowText.lastIndexOf(","),
        windowText.lastIndexOf("："),
        windowText.lastIndexOf(":"),
      );
      const spaceBreak = windowText.lastIndexOf(" ");
      const breakAt = punctuationBreak >= Math.floor(maxChars * 0.55) ? punctuationBreak + 1 : spaceBreak >= Math.floor(maxChars * 0.55) ? spaceBreak + 1 : maxChars;
      chunks.push(remaining.slice(0, breakAt).trim());
      cursor += breakAt;
    }
  }
  return chunks.filter(Boolean);
}

function captionMaxChars(plan) {
  const width = Number(plan?.width || 1080);
  const height = Number(plan?.height || 1920);
  const ratio = width / Math.max(1, height);
  const fontSize = Math.round(width * 0.045);
  const usableWidth = width * 0.86 - 36;
  const estimated = Math.floor(usableWidth / Math.max(1, fontSize * 0.92));
  const ratioLimit = ratio >= 1.5 ? 28 : ratio >= 0.95 ? 22 : 16;
  return Math.max(12, Math.min(ratioLimit, estimated));
}

function buildCaptionDisplayGroups(plan, maxChars = captionMaxChars(plan)) {
  const groups = [];
  for (const caption of plan.captionsTimeline || []) {
    const start = Number(caption.start || 0);
    const end = Number(caption.end || 0);
    const duration = Math.max(0.2, end - start);
    const chunks = splitCaptionText(caption.text, maxChars);
    const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(6, chunk.length), 0) || 1;
    let cursor = start;
    chunks.forEach((chunk, chunkIndex) => {
      const isLast = chunkIndex === chunks.length - 1;
      const weight = Math.max(6, chunk.length);
      const chunkDuration = isLast ? Math.max(0.16, end - cursor) : Math.max(0.85, (duration * weight) / totalWeight);
      const chunkEnd = isLast ? end : Math.min(end, cursor + chunkDuration);
      groups.push({
        id: `cap-${groups.length}`,
        start: cursor,
        end: chunkEnd,
        text: chunk,
      });
      cursor = chunkEnd;
    });
  }
  return groups;
}

function buildCaptionTimelineFromSubtitles(subtitles, maxChars = 18) {
  const timeline = [];
  let active = null;
  for (const subtitle of subtitles || []) {
    const text = String(subtitle.text || "").trim();
    if (!text) continue;
    const start = Number(subtitle.start || 0);
    const end = Number(subtitle.end || 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (!active) {
      active = { id: `cap-${timeline.length + 1}`, start, end, text };
      continue;
    }
    const merged = `${active.text}${text}`;
    const gap = start - active.end;
    if (merged.length <= maxChars && gap <= 0.45) {
      active.text = merged;
      active.end = end;
    } else {
      active.duration = active.end - active.start;
      timeline.push(active);
      active = { id: `cap-${timeline.length + 1}`, start, end, text };
    }
  }
  if (active) {
    active.duration = active.end - active.start;
    timeline.push(active);
  }
  return timeline;
}

function compactText(text) {
  return String(text || "").replace(/\s+/g, "").replace(/[，。！？!?；;：:、,.]/g, "");
}

function parseMiniMaxSubtitleItems(raw) {
  const items = typeof raw === "string" ? (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  })() : raw;
  const list = Array.isArray(items) ? items : Array.isArray(items?.subtitles) ? items.subtitles : Array.isArray(items?.sentences) ? items.sentences : [];
  return list.map((item, index) => {
    const startMs = item.time_begin ?? item.start_time ?? item.startTime ?? item.start_ms ?? item.start ?? 0;
    const endMs = item.time_end ?? item.end_time ?? item.endTime ?? item.end_ms ?? item.end ?? 0;
    const start = Number(startMs) > 100 ? Number(startMs) / 1000 : Number(startMs || 0);
    const end = Number(endMs) > 100 ? Number(endMs) / 1000 : Number(endMs || 0);
    return {
      id: `subtitle-${index + 1}`,
      start,
      end,
      text: String(item.text || item.pronounce_text || item.subtitle || item.sentence || item.word || "").trim(),
    };
  }).filter((item) => item.text && item.end > item.start);
}

function parseMiniMaxSubtitles(payload) {
  const candidates = [
    payload?.data?.subtitle,
    payload?.data?.subtitles,
    payload?.data?.subtitle_info,
    payload?.data?.sentence_subtitles,
    payload?.extra_info?.subtitle,
    payload?.extra_info?.subtitles,
  ];
  const raw = candidates.find((value) => value);
  return raw ? parseMiniMaxSubtitleItems(raw) : [];
}

function miniMaxSubtitleFileUrl(payload) {
  return payload?.data?.subtitle_file
    || payload?.data?.subtitle_url
    || payload?.data?.subtitleFile
    || payload?.extra_info?.subtitle_file
    || payload?.extra_info?.subtitle_url
    || "";
}

async function fetchMiniMaxSubtitleFile(payload, signal, log) {
  const url = miniMaxSubtitleFileUrl(payload);
  if (!url) return { subtitles: [], subtitleFileFound: false, subtitleFileLoaded: false };
  const response = await fetch(url, { signal });
  const rawText = await response.text();
  if (!response.ok) {
    log?.(`MiniMax subtitle_file fetch failed: HTTP ${response.status}`);
    return { subtitles: [], subtitleFileFound: true, subtitleFileLoaded: false, rawText: rawText.slice(0, 1000) };
  }
  return {
    subtitles: parseMiniMaxSubtitleItems(rawText),
    subtitleFileFound: true,
    subtitleFileLoaded: true,
    rawText,
  };
}

function sanitizeMiniMaxPayload(payload) {
  if (Array.isArray(payload)) return payload.map(sanitizeMiniMaxPayload);
  if (!payload || typeof payload !== "object") return payload;
  const output = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (lower === "audio" && typeof value === "string") {
      output[key] = `[redacted audio hex length ${value.length}]`;
    } else if (lower.includes("subtitle") && lower.includes("file") && typeof value === "string") {
      output[key] = value.split("?")[0];
    } else {
      output[key] = sanitizeMiniMaxPayload(value);
    }
  }
  return output;
}

function fallbackTimingsFromDuration(segments, duration) {
  const weights = segments.map((segment) => Math.max(1, compactText(segmentTextForTts(segment)).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const nextDuration = isLast ? Math.max(0.2, duration - cursor) : Math.max(0.2, (duration * weights[index]) / totalWeight);
    const start = cursor;
    const end = isLast ? duration : Math.min(duration, start + nextDuration);
    cursor = end;
    return { id: segment.id, start, end, duration: end - start, text: segment.text };
  });
}

function mapSubtitlesToSegments(segments, subtitles, duration) {
  if (!subtitles.length) return fallbackTimingsFromDuration(segments, duration);
  const timings = [];
  let subtitleIndex = 0;
  for (const segment of segments) {
    const target = compactText(segmentTextForTts(segment));
    const startIndex = subtitleIndex;
    let joined = "";
    let endIndex = startIndex - 1;
    while (subtitleIndex < subtitles.length && joined.length < target.length + 8) {
      joined += compactText(subtitles[subtitleIndex].text);
      endIndex = subtitleIndex;
      subtitleIndex += 1;
      if (target && (joined.includes(target) || target.includes(joined) && joined.length >= target.length * 0.75)) break;
    }
    const matched = subtitles.slice(startIndex, endIndex + 1).filter(Boolean);
    if (matched.length) {
      const start = matched[0].start;
      const end = matched.at(-1).end;
      timings.push({ id: segment.id, start, end, duration: end - start, text: segment.text });
    }
  }
  if (timings.length !== segments.length || timings.some((item) => !Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end <= item.start)) {
    return fallbackTimingsFromDuration(segments, duration);
  }
  return timings;
}


function updateElementText(html, selector, textValue) {
  const match = selector.match(/^element-(\d+)$/);
  if (!match) throw new Error("Invalid element selector");
  const targetIndex = Number(match[1]);
  const editableTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "em", "strong", "small", "div", "li", "blockquote"]);
  const ignoredTags = new Set(["script", "style", "svg", "canvas", "video", "audio", "iframe"]);
  const stack = [];
  const tagPattern = /<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g;
  let currentIndex = 0;
  let replacement = null;
  let token;
  while ((token = tagPattern.exec(html))) {
    const raw = token[0];
    const tag = token[1].toLowerCase();
    const isClosing = raw.startsWith("</");
    const isVoid = raw.endsWith("/>") || ["br", "hr", "img", "input", "meta", "link"].includes(tag);
    if (!isClosing) {
      const parent = stack[stack.length - 1];
      if (parent) parent.hasElementChild = true;
      if (!isVoid) {
        stack.push({
          tag,
          ignored: ignoredTags.has(tag) || Boolean(parent?.ignored),
          editable: editableTags.has(tag),
          hasElementChild: false,
          innerStart: tagPattern.lastIndex,
        });
      }
      continue;
    }
    let item = stack.pop();
    while (item && item.tag !== tag) item = stack.pop();
    if (!item || item.ignored || !item.editable || item.hasElementChild) continue;
    const inner = html.slice(item.innerStart, token.index);
    const plain = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!plain) continue;
    if (currentIndex === targetIndex) {
      replacement = { start: item.innerStart, end: token.index };
      break;
    }
    currentIndex += 1;
  }
  if (!replacement) throw new Error("Editable element not found");
  const safeText = String(textValue || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `${html.slice(0, replacement.start)}${safeText}${html.slice(replacement.end)}`;
}

function normalizeSavedScriptUserPrompt(value) {
  const prompt = String(value || "");
  if (!prompt.trim()) return DEFAULT_SCRIPT_USER_PROMPT;
  const legacyMarkers = [
    "视频模板：{{templateId}}",
    "处理策略：",
    "AI 每日日报",
    "AI 日报",
    "固定开场：",
    "\"narration\": \"完整中文旁白",
    "系统会自动按旁白段拆分",
    "不要输出分镜列表",
    "开头 10 秒必须先抛出谜题",
    "你是不是也以为",
    "留有余味的结尾",
    "前三秒留存钩子",
    "强钩子 ->",
  ];
  const hasLegacyMarker = legacyMarkers.some((marker) => prompt.includes(marker));
  if (hasLegacyMarker) return DEFAULT_SCRIPT_USER_PROMPT;
  if (!prompt.includes("visualBible") || !prompt.includes("\"entities\"")) return DEFAULT_SCRIPT_USER_PROMPT;
  return prompt;
}

function normalizeSavedScriptSystemPrompt(value) {
  const prompt = String(value || "");
  if (!prompt.trim()) return DEFAULT_SCRIPT_SYSTEM_PROMPT;
  const legacyMarkers = ["AI 产品编辑", "日报", "周刊", "短视频编导", "中文叙事脚本作者"];
  const hasLegacyMarker = legacyMarkers.some((marker) => prompt.includes(marker));
  if (hasLegacyMarker) return DEFAULT_SCRIPT_SYSTEM_PROMPT;
  if (!prompt.includes("visualBible")) return DEFAULT_SCRIPT_SYSTEM_PROMPT;
  return prompt;
}

async function readSettings() {
  const settings = await readJson(SETTINGS_FILE, {});
  const audio = settings.audio || {};
  const image = settings.image || {};
  return {
    baseUrl: settings.baseUrl || "https://api.openai.com/v1",
    model: settings.model || "gpt-4.1-mini",
    temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.7,
    apiKey: settings.apiKey || "",
    scriptSystemPrompt: normalizeSavedScriptSystemPrompt(settings.scriptSystemPrompt),
    scriptUserPrompt: normalizeSavedScriptUserPrompt(settings.scriptUserPrompt),
    image: {
      model: String(image.model || DEFAULT_IMAGE_SETTINGS.model),
      quality: String(image.quality || DEFAULT_IMAGE_SETTINGS.quality),
      outputFormat: String(image.outputFormat || DEFAULT_IMAGE_SETTINGS.outputFormat),
    },
    audio: {
      provider: "minimax",
      minimaxApiKey: String(audio.minimaxApiKey || ""),
      minimaxGroupId: String(audio.minimaxGroupId || DEFAULT_AUDIO_SETTINGS.minimaxGroupId),
      minimaxBaseUrl: String(audio.minimaxBaseUrl || DEFAULT_AUDIO_SETTINGS.minimaxBaseUrl).replace(/\/+$/, ""),
      minimaxModel: String(audio.minimaxModel || DEFAULT_AUDIO_SETTINGS.minimaxModel),
      minimaxVoiceId: String(audio.minimaxVoiceId || DEFAULT_AUDIO_SETTINGS.minimaxVoiceId),
      minimaxSpeed: clampNumber(audio.minimaxSpeed, DEFAULT_AUDIO_SETTINGS.minimaxSpeed, 0.5, 2),
      minimaxVolume: clampNumber(audio.minimaxVolume, DEFAULT_AUDIO_SETTINGS.minimaxVolume, 0.1, 10),
      minimaxPitch: clampNumber(audio.minimaxPitch, DEFAULT_AUDIO_SETTINGS.minimaxPitch, -12, 12),
      minimaxFormat: String(audio.minimaxFormat || DEFAULT_AUDIO_SETTINGS.minimaxFormat),
      minimaxSampleRate: clampNumber(audio.minimaxSampleRate, DEFAULT_AUDIO_SETTINGS.minimaxSampleRate, 8000, 48000),
      minimaxBitrate: Math.round(clampNumber(audio.minimaxBitrate, DEFAULT_AUDIO_SETTINGS.minimaxBitrate, 32000, 320000)),
    },
  };
}

async function publicSettings() {
  const settings = await readSettings();
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    temperature: settings.temperature,
    hasApiKey: Boolean(settings.apiKey),
    scriptSystemPrompt: settings.scriptSystemPrompt,
    scriptUserPrompt: settings.scriptUserPrompt,
    image: settings.image,
    audio: { ...settings.audio, minimaxApiKey: "" },
    hasMinimaxApiKey: Boolean(settings.audio.minimaxApiKey),
  };
}

async function saveSettings(input) {
  const current = await readSettings();
  const audio = input.audio || {};
  const image = input.image || {};
  const next = {
    baseUrl: String(input.baseUrl || current.baseUrl).replace(/\/+$/, ""),
    model: String(input.model || current.model),
    temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : current.temperature,
    apiKey: typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey.trim() : current.apiKey,
    scriptSystemPrompt: typeof input.scriptSystemPrompt === "string" && input.scriptSystemPrompt.trim() ? input.scriptSystemPrompt : current.scriptSystemPrompt,
    scriptUserPrompt: typeof input.scriptUserPrompt === "string" && input.scriptUserPrompt.trim() ? input.scriptUserPrompt : current.scriptUserPrompt,
    image: {
      model: String(image.model || current.image.model),
      quality: String(image.quality || current.image.quality),
      outputFormat: String(image.outputFormat || current.image.outputFormat),
    },
    audio: {
      provider: "minimax",
      minimaxApiKey: typeof audio.minimaxApiKey === "string" && audio.minimaxApiKey.trim() ? audio.minimaxApiKey.trim() : current.audio.minimaxApiKey,
      minimaxGroupId: typeof audio.minimaxGroupId === "string" ? audio.minimaxGroupId.trim() : current.audio.minimaxGroupId,
      minimaxBaseUrl: String(audio.minimaxBaseUrl || current.audio.minimaxBaseUrl || DEFAULT_AUDIO_SETTINGS.minimaxBaseUrl).replace(/\/+$/, ""),
      minimaxModel: String(audio.minimaxModel || current.audio.minimaxModel || DEFAULT_AUDIO_SETTINGS.minimaxModel),
      minimaxVoiceId: String(audio.minimaxVoiceId || current.audio.minimaxVoiceId || DEFAULT_AUDIO_SETTINGS.minimaxVoiceId),
      minimaxSpeed: clampNumber(audio.minimaxSpeed, current.audio.minimaxSpeed, 0.5, 2),
      minimaxVolume: clampNumber(audio.minimaxVolume, current.audio.minimaxVolume, 0.1, 10),
      minimaxPitch: clampNumber(audio.minimaxPitch, current.audio.minimaxPitch, -12, 12),
      minimaxFormat: String(audio.minimaxFormat || current.audio.minimaxFormat || DEFAULT_AUDIO_SETTINGS.minimaxFormat),
      minimaxSampleRate: Math.round(clampNumber(audio.minimaxSampleRate, current.audio.minimaxSampleRate, 8000, 48000)),
      minimaxBitrate: Math.round(clampNumber(audio.minimaxBitrate, current.audio.minimaxBitrate, 32000, 320000)),
    },
  };
  await writeJson(SETTINGS_FILE, next);
  return next;
}

async function resolveAudioSettings(inputAudio = {}) {
  const saved = await readSettings();
  const audio = inputAudio || {};
  return {
    ...saved.audio,
    ...audio,
    minimaxApiKey: typeof audio.minimaxApiKey === "string" && audio.minimaxApiKey.trim()
      ? audio.minimaxApiKey.trim()
      : saved.audio.minimaxApiKey,
    minimaxGroupId: typeof audio.minimaxGroupId === "string" ? audio.minimaxGroupId.trim() : saved.audio.minimaxGroupId,
    minimaxBaseUrl: String(audio.minimaxBaseUrl || saved.audio.minimaxBaseUrl || DEFAULT_AUDIO_SETTINGS.minimaxBaseUrl).replace(/\/+$/, ""),
    minimaxModel: String(audio.minimaxModel || saved.audio.minimaxModel || DEFAULT_AUDIO_SETTINGS.minimaxModel),
    minimaxVoiceId: String(audio.minimaxVoiceId || saved.audio.minimaxVoiceId || DEFAULT_AUDIO_SETTINGS.minimaxVoiceId),
    minimaxSpeed: clampNumber(audio.minimaxSpeed, saved.audio.minimaxSpeed, 0.5, 2),
    minimaxVolume: clampNumber(audio.minimaxVolume, saved.audio.minimaxVolume, 0.1, 10),
    minimaxPitch: clampNumber(audio.minimaxPitch, saved.audio.minimaxPitch, -12, 12),
    minimaxFormat: String(audio.minimaxFormat || saved.audio.minimaxFormat || DEFAULT_AUDIO_SETTINGS.minimaxFormat),
    minimaxSampleRate: Math.round(clampNumber(audio.minimaxSampleRate, saved.audio.minimaxSampleRate, 8000, 48000)),
    minimaxBitrate: Math.round(clampNumber(audio.minimaxBitrate, saved.audio.minimaxBitrate, 32000, 320000)),
  };
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readProject(projectId) {
  let dir = projectPath(projectId);
  let manifest = await readJson(path.join(dir, "project.json"), null);
  if (!manifest && /%[0-9a-f]{2}/i.test(String(projectId || ""))) {
    const decodedProjectId = decodeURIComponent(projectId);
    dir = projectPath(decodedProjectId);
    manifest = await readJson(path.join(dir, "project.json"), null);
  }
  if (!manifest) {
    const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidateDir = path.join(PROJECTS_DIR, entry.name);
      const candidate = await readJson(path.join(candidateDir, "project.json"), null);
      if (candidate?.id === projectId || safeId(candidate?.id) === safeId(projectId)) {
        dir = candidateDir;
        manifest = candidate;
        break;
      }
    }
  }
  if (!manifest) return null;
  manifest.videoSettings = normalizeVideoSettings(manifest.videoSettings);
  const defaultVoiceoverExists = await exists(path.join(dir, "voiceover.wav"));
  if (!manifest.voiceover && defaultVoiceoverExists) {
    manifest.voiceover = "voiceover.wav";
    if (await exists(path.join(dir, "captions.vtt"))) manifest.captions = "captions.vtt";
    if (manifest.status === "script_ready" || manifest.status === "script_review" || manifest.status === "audio_review") {
      manifest.status = "audio_approved";
    }
  }
  const voiceoverExists = manifest.voiceover ? await exists(path.join(dir, manifest.voiceover)) : false;
  const finalVideoExists = manifest.finalVideo ? await exists(path.join(dir, manifest.finalVideo)) : false;
  if (manifest.voiceover && !voiceoverExists) {
    delete manifest.voiceover;
    delete manifest.captions;
    if (manifest.status === "audio_approved" || manifest.status === "audio_review") manifest.status = "script_ready";
  }
  if (manifest.finalVideo && !finalVideoExists) {
    delete manifest.finalVideo;
    if (manifest.status === "video_ready") manifest.status = voiceoverExists ? "audio_approved" : "script_ready";
  }
  if (manifest.finalVideo && !voiceoverExists) {
    delete manifest.finalVideo;
    if (manifest.status === "video_ready" || manifest.status === "audio_approved" || manifest.status === "audio_review") manifest.status = "script_ready";
  }
  const source = await fsp.readFile(path.join(dir, "source.md"), "utf8").catch(() => "");
  const segments = sanitizeSegments(await readJson(path.join(dir, "segments.json"), []));
  const timings = await readJson(path.join(dir, "timings.json"), null);
  const captionsTimeline = await readJson(path.join(dir, "captions-timeline.json"), null);
  const script = await readJson(path.join(dir, "script.json"), null);
  const visualBible = await readJson(path.join(dir, "visual-bible.json"), null);
  const storedRenderPlan = await readJson(path.join(dir, "render-plan.json"), null);
  const storyboards = await readJson(path.join(dir, "storyboards.json"), []);
  const project = { ...manifest, source, segments, timings, captionsTimeline, script, visualBible, renderPlan: storedRenderPlan, storyboards };
  if (Array.isArray(timings) && timings.length) {
    project.renderPlan = buildRenderPlan({ ...project, renderPlan: null });
    project.storyboards = syncStoryboardsWithRenderPlan(project);
  }
  return project;
}

async function saveProject(project) {
  const dir = projectPath(project.id);
  await fsp.mkdir(dir, { recursive: true });
  const { source, segments, timings, captionsTimeline, script, visualBible, renderPlan, storyboards, ...manifest } = project;
  if (!manifest.voiceover && await exists(path.join(dir, "voiceover.wav"))) {
    manifest.voiceover = "voiceover.wav";
    if (await exists(path.join(dir, "captions.vtt"))) manifest.captions = "captions.vtt";
    if (manifest.status === "script_ready" || manifest.status === "script_review" || manifest.status === "audio_review") {
      manifest.status = "audio_approved";
    }
  }
  await writeJson(path.join(dir, "project.json"), manifest);
  if (typeof source === "string") await fsp.writeFile(path.join(dir, "source.md"), source, "utf8");
  if (segments) await writeJson(path.join(dir, "segments.json"), sanitizeSegments(segments));
  if (timings) await writeJson(path.join(dir, "timings.json"), timings);
  if (captionsTimeline) await writeJson(path.join(dir, "captions-timeline.json"), captionsTimeline);
  if (script) await writeJson(path.join(dir, "script.json"), script);
  if (visualBible) await writeJson(path.join(dir, "visual-bible.json"), visualBible);
  if (renderPlan) await writeJson(path.join(dir, "render-plan.json"), renderPlan);
  if (storyboards) await writeJson(path.join(dir, "storyboards.json"), storyboards);
}

function stripMarkdown(input) {
  return String(input || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[>\-*+]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const termMap = [
  ["statement timeout", "语句超时"],
  ["soft delete", "软删除"],
  ["idempotency key", "幂等键"],
  ["hash-anchored edits", "基于哈希定位的修改"],
  ["pull request", "合并请求"],
  ["token budget", "上下文预算"],
  ["prompt injection", "提示词注入"],
  ["context window", "上下文窗口"],
  ["MCP server", "MCP 服务"],
];

function normalizeChineseSpacing(text) {
  return String(text || "")
    .replace(/(\d)\s+([\u4e00-\u9fa5])/g, "$1$2")
    .replace(/([\u4e00-\u9fa5])\s+(\d)/g, "$1$2");
}

function normalizeForTts(text) {
  let output = text;
  for (const [from, to] of termMap) {
    output = output.replace(new RegExp(from, "gi"), to);
  }
  return normalizeChineseSpacing(output)
    .replace(/\bAI\b/g, "AI")
    .replace(/\bAgent\b/g, "智能体")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPronunciationHintsForDisplay(text) {
  return String(text || "").replace(/([\u4e00-\u9fa5])\{([a-zA-ZüÜvV0-9:]+)\}/g, "$1");
}

function sanitizeSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.map((segment) => {
    return {
      ...(segment || {}),
      entities: Array.isArray(segment?.entities) ? segment.entities.map((item) => String(item).trim()).filter(Boolean) : [],
    };
  });
}

function prepareSegmentTextInput(text) {
  const raw = String(text || "");
  const ttsText = normalizeForTts(raw);
  const displayText = normalizeForTts(stripPronunciationHintsForDisplay(raw));
  return {
    displayText,
    ttsText: ttsText === displayText ? null : ttsText,
  };
}

function segmentTextForTts(segment) {
  return segment.ttsText || segment.text;
}

function splitSentences(text) {
  return stripMarkdown(text)
    .replace(/([。！？!?；;])\s*/g, "$1\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function segmentText(source) {
  const sentences = splitSentences(source).map(normalizeForTts);
  const segments = [];
  let current = "";
  const flush = () => {
    const textValue = current.trim();
    if (!textValue) return;
    const index = segments.length + 1;
    segments.push({
      id: `segment-${String(index).padStart(3, "0")}`,
      index,
      text: textValue,
      entities: [],
      status: "draft",
      notes: "",
      updatedAt: now(),
    });
    current = "";
  };

  for (const sentence of sentences) {
    const joined = current ? `${current}${sentence}` : sentence;
    const joinedChars = (joined.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (current && joinedChars > 72) flush();
    current = current ? `${current}${sentence}` : sentence;
    const currentChars = (current.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (currentChars >= 48 && /[。！？!?；;]$/.test(current)) flush();
  }
  flush();
  return segments;
}

function pickTitle(source) {
  const heading = String(source || "").match(/^#{1,3}\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 38);
  const first = splitSentences(source)[0] || "知识解释视频";
  return first.replace(/[。！？!?；;].*$/, "").slice(0, 28) || "知识解释视频";
}

function shortLabel(text, fallback) {
  const cleaned = String(text || "")
    .replace(/[“”"《》#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = cleaned.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || [];
  return (candidates[0] || fallback).slice(0, 12);
}

function summarizeText(text, max = 92) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function buildScript(project) {
  const segments = project.segments?.length ? project.segments : segmentText(project.source || "");
  const title = pickTitle(project.source || segments.map((item) => item.text).join(""));
  const narration = segments.map((item) => item.text).join("\n");

  return {
    title,
    platform: "custom",
    aspectRatio: project.aspectRatio || "9:16",
    narration,
    segments: segments.map((segment) => ({
      narration: segment.text,
      visualDescription: segmentVisualDescription(segment),
    })),
    createdAt: now(),
    updatedAt: now(),
  };
}

function extractJson(textValue) {
  const text = String(textValue || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("LLM response is not valid JSON");
  }
}

function normalizeLlmScript(raw, project, normalizedSegments = null) {
  const fallback = buildScript(project);
  const llmSegments = normalizedSegments || normalizeLlmSegments(raw, project);
  const narration = llmSegments.length
    ? llmSegments.map((segment) => segment.text).join("\n")
    : String(raw.narration || raw.voiceover || fallback.narration || "").trim();
  return {
    title: String(raw.title || fallback.title).slice(0, 60),
    platform: fallback.platform || "custom",
    aspectRatio: project.aspectRatio || fallback.aspectRatio || "9:16",
    hook: "保留用户原始旁白，只做必要清理、分段和画面描述。",
    narration,
    segments: llmSegments.map((segment) => ({
      narration: segment.text,
      visualDescription: segmentVisualDescription(segment),
      entities: segment.entities || [],
    })),
    createdAt: now(),
    updatedAt: now(),
  };
}

function segmentVisualDescription(segment = {}) {
  return String(segment.visualDescription || "").trim();
}

function normalizeEntityId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeVisualBible(raw) {
  const source = raw?.visualBible;
  if (!source || typeof source !== "object") throw new Error("LLM response missing visualBible");
  const groups = ["characters", "objects", "places", "symbols"];
  const used = new Set();
  const output = {};
  for (const group of groups) {
    const items = Array.isArray(source[group]) ? source[group] : [];
    output[group] = items.map((item) => {
      const id = normalizeEntityId(item?.id);
      if (!id) throw new Error(`visualBible.${group} contains entity without id`);
      if (used.has(id)) throw new Error(`visualBible has duplicate entity id: ${id}`);
      used.add(id);
      return {
        id,
        name: String(item?.name || id).trim(),
        role: String(item?.role || "").trim(),
        stableDescription: String(item?.stableDescription || item?.description || "").trim(),
        doNotChange: Array.isArray(item?.doNotChange)
          ? item.doNotChange.map((value) => String(value).trim()).filter(Boolean)
          : [],
      };
    });
  }
  return output;
}

function visualBibleEntityMap(visualBible) {
  const map = new Map();
  for (const group of ["characters", "objects", "places", "symbols"]) {
    for (const item of visualBible?.[group] || []) {
      map.set(item.id, { ...item, group });
    }
  }
  return map;
}

function normalizeSegmentEntities(rawEntities, entityIds) {
  if (!Array.isArray(rawEntities)) throw new Error("Every segment must include entities array");
  return rawEntities.map(normalizeEntityId).filter((id) => {
    if (!id) return false;
    if (!entityIds.has(id)) throw new Error(`Segment references unknown visualBible entity: ${id}`);
    return true;
  });
}

function normalizeLlmSegments(raw, project, visualBible = normalizeVisualBible(raw)) {
  const entityIds = new Set(visualBibleEntityMap(visualBible).keys());
  const sourceSegments = Array.isArray(raw.segments)
    ? raw.segments
    : Array.isArray(raw.narrationSegments)
      ? raw.narrationSegments
      : [];
  const normalized = [];
  for (const item of sourceSegments) {
    const textValue = String(item?.narration || item?.text || item?.voiceover || "").trim();
    if (!textValue) continue;
    const prepared = prepareSegmentTextInput(textValue);
    const chunks = splitLongSegmentForVisuals(prepared.displayText);
    const entities = normalizeSegmentEntities(item?.entities, entityIds);
    chunks.forEach((chunk, chunkIndex) => {
      const index = normalized.length + 1;
      normalized.push({
        id: `segment-${String(index).padStart(3, "0")}`,
        index,
        text: chunk,
        ttsText: chunkIndex === 0 && chunks.length === 1 ? prepared.ttsText : undefined,
        visualDescription: segmentVisualDescription({
          visualDescription: item?.visualDescription,
        }),
        entities,
        status: "draft",
        notes: "",
        updatedAt: now(),
      });
    });
  }
  if (normalized.length) return normalized;
  throw new Error("LLM response missing segments");
}

function splitLongSegmentForVisuals(textValue) {
  const text = String(textValue || "").trim();
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseChars <= 120) return [text];
  const parts = text
    .replace(/([。！？!?；;])\s*/g, "$1\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [text];
  const chunks = [];
  let current = "";
  for (const part of parts) {
    const joined = current ? `${current}${part}` : part;
    const joinedChars = (joined.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (current && joinedChars > 105) {
      chunks.push(current);
      current = part;
    } else {
      current = joined;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

function renderPromptTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? "") : match,
  );
}

function buildLlmPrompt(project, options = {}) {
  const values = {
    templateId: normalizeTemplateId(project.templateId),
    source: project.source || project.segments.map((item) => item.text).join("\n"),
  };
  const systemPrompt = options.scriptSystemPrompt || DEFAULT_SCRIPT_SYSTEM_PROMPT;
  const userPrompt = options.scriptUserPrompt || DEFAULT_SCRIPT_USER_PROMPT;
  return [
    {
      role: "system",
      content: renderPromptTemplate(systemPrompt, values),
    },
    {
      role: "user",
      content: renderPromptTemplate(userPrompt, values),
    },
  ];
}

async function callOpenAiCompatible(settings, messages, options = {}) {
  if (!settings.apiKey) throw new Error("Missing API key. Save model settings first.");
  const endpoint = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const requestBody = {
    model: settings.model,
    temperature: settings.temperature,
    response_format: { type: "json_object" },
    messages,
  };
  if (options.stream) {
    let payload = await postLlmStream(endpoint, settings.apiKey, { ...requestBody, stream: true }, options);
    if (!payload.ok && /response_format|json_object/i.test(payload.message)) {
      const { response_format, ...fallbackBody } = requestBody;
      payload = await postLlmStream(endpoint, settings.apiKey, { ...fallbackBody, stream: true }, options);
    }
    if (!payload.ok) throw new Error(payload.message);
    return payload.content || "";
  }
  let payload = await postLlm(endpoint, settings.apiKey, requestBody, options);
  if (!payload.ok && /response_format|json_object/i.test(payload.message)) {
    const { response_format, ...fallbackBody } = requestBody;
    payload = await postLlm(endpoint, settings.apiKey, fallbackBody, options);
  }
  if (!payload.ok) throw new Error(payload.message);
  return payload.data.choices?.[0]?.message?.content || "";
}

async function callOpenAiText(settings, messages, options = {}) {
  if (!settings.apiKey) throw new Error("Missing API key. Save model settings first.");
  const endpoint = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = Number(options.timeoutMs || 60000);
  const request = postLlm(endpoint, settings.apiKey, {
    model: settings.model,
    temperature: settings.temperature,
    messages,
  }, { timeoutMs });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`LLM request timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs).unref?.();
  });
  const payload = await Promise.race([request, timeout]);
  if (!payload.ok) throw new Error(payload.message);
  return payload.data.choices?.[0]?.message?.content || "";
}

async function postLlm(endpoint, apiKey, body, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) {
      const upstreamMessage = payload.error?.message || payload.message || payload.raw || response.statusText;
      const timeoutHint = response.status === 504 ? "LLM upstream returned 504 Gateway Timeout" : `LLM request failed: ${response.status}`;
      return { ok: false, message: `${timeoutHint}${upstreamMessage ? ` - ${String(upstreamMessage).slice(0, 300)}` : ""}`, data: payload };
    }
    return { ok: true, message: "ok", data: payload };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, message: `LLM request timed out after ${Math.round(timeoutMs / 1000)}s`, data: {} };
    }
    return { ok: false, message: error.message || "LLM request failed", data: {} };
  } finally {
    clearTimeout(timer);
  }
}

function chatCompletionContent(payload) {
  const choice = payload?.choices?.[0] || {};
  return choice.message?.content || choice.delta?.content || choice.text || "";
}

function parseLlmStreamData(data) {
  const line = String(data || "").trim();
  if (!line || line === "[DONE]") return { done: line === "[DONE]", content: "" };
  const payload = JSON.parse(line);
  if (payload.error) {
    throw new Error(payload.error.message || payload.error.type || JSON.stringify(payload.error));
  }
  return { done: false, content: chatCompletionContent(payload) };
}

function maybeLogLlmStream(log, contentLength, state, force = false) {
  if (typeof log !== "function") return;
  if (!force && contentLength < state.nextChars) return;
  while (contentLength >= state.nextChars) state.nextChars += 5000;
  log(`LLM stream received ${contentLength} chars`);
}

async function readLlmStream(response, log, resetIdleTimer) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream") && !contentType.includes("stream")) {
    const text = await response.text().catch(() => "");
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    return chatCompletionContent(payload) || payload.raw || "";
  }

  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("LLM stream response has no readable body");

  const decoder = new TextDecoder();
  const state = { nextChars: 5000 };
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    resetIdleTimer?.();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;
      const parsed = parseLlmStreamData(line.slice(5));
      if (parsed.done) {
        maybeLogLlmStream(log, content.length, state, true);
        return content;
      }
      content += parsed.content || "";
      maybeLogLlmStream(log, content.length, state);
    }
  }
  buffer += decoder.decode();
  for (const rawLine of buffer.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(":") || !line.startsWith("data:")) continue;
    const parsed = parseLlmStreamData(line.slice(5));
    if (parsed.done) break;
    content += parsed.content || "";
  }
  maybeLogLlmStream(log, content.length, state, true);
  return content;
}

async function postLlmStream(endpoint, apiKey, body, options = {}) {
  const idleTimeoutMs = Number(options.timeoutMs || 240000);
  const log = options.log;
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const resetIdleTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
    timer.unref?.();
  };
  resetIdleTimer();
  try {
    log?.(`LLM stream started, idle timeout ${Math.round(idleTimeoutMs / 1000)}s`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    resetIdleTimer();
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      const upstreamMessage = payload.error?.message || payload.message || payload.raw || response.statusText;
      const timeoutHint = response.status === 504 ? "LLM upstream returned 504 Gateway Timeout" : `LLM stream failed: ${response.status}`;
      return { ok: false, message: `${timeoutHint}${upstreamMessage ? ` - ${String(upstreamMessage).slice(0, 300)}` : ""}`, content: "" };
    }
    const content = await readLlmStream(response, log, resetIdleTimer);
    if (!String(content || "").trim()) {
      return { ok: false, message: "LLM stream completed without content", content: "" };
    }
    log?.(`LLM stream completed: ${content.length} chars`);
    return { ok: true, message: "ok", content };
  } catch (error) {
    if (error.name === "AbortError") {
      const reason = timedOut ? `idle for ${Math.round(idleTimeoutMs / 1000)}s` : "aborted";
      return { ok: false, message: `LLM stream timed out: ${reason}`, content: "" };
    }
    return { ok: false, message: error.message || "LLM stream failed", content: "" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fallbackVisualDescription(segment) {
  const textValue = summarizeText(segment.text || "", 46);
  return `主角在一个简单可画的场景里处理这一段内容：${textValue}。画面只保留一个核心动作、关键道具和清楚的关系。`;
}

function segmentsWithFallbackVisuals(segments) {
  return segments.map((segment) => ({
    ...segment,
    visualDescription: segmentVisualDescription(segment) || fallbackVisualDescription(segment),
  }));
}

async function generateScriptWithLlm(project, options, log) {
  const settings = await readSettings();
  if (!String(project.source || "").trim()) throw new Error("Source narration is empty");
  const messages = buildLlmPrompt(project, { ...settings, ...options });
  const content = await callOpenAiCompatible(settings, messages, { timeoutMs: 240000, stream: true, log });
  const raw = extractJson(content);
  const visualBible = normalizeVisualBible(raw);
  const narrationSegments = segmentsWithFallbackVisuals(normalizeLlmSegments(raw, project, visualBible));
  const script = normalizeLlmScript(raw, project, narrationSegments);
  return { script, segments: narrationSegments, visualBible };
}

function buildRenderPlan(project) {
  const script = project.script || buildScript(project);
  const timings = project.timings || [];
  const captionsTimeline = Array.isArray(project.captionsTimeline) ? project.captionsTimeline : [];
  const segments = project.segments?.length ? project.segments : segmentText(script.narration || "");
  const totalDuration = timings.length
    ? timings.at(-1).end
    : segments.reduce((sum, segment) => {
      const chars = (segment.text || "").replace(/\s+/g, "").length;
      return sum + Math.max(2.4, Math.min(9, chars / 7));
    }, 0);
  const size = aspectRatioSizes[project.aspectRatio || script.aspectRatio] || aspectRatioSizes["9:16"];
  const accents = ["#111111", "#f05a28", "#2367d1", "#4a4a4a"];
  let cursor = 0;
  const scenes = segments.map((segment, index) => {
    const id = segment.id || `segment-${String(index + 1).padStart(3, "0")}`;
    const timing = timings.find((item) => item.id === segment.id);
    const start = timing ? timing.start : cursor;
    const fallbackDuration = Math.max(2.4, Math.min(9, String(segment.text || "").replace(/\s+/g, "").length / 7));
    const end = timing ? timing.end : start + fallbackDuration;
    cursor = end;
    return {
      id,
      type: "segment",
      index: index + 1,
      start,
      end,
      title: shortLabel(segment.text, `第 ${index + 1} 段`),
      summary: summarizeText(segment.text, 96),
      visualDescription: segmentVisualDescription(segment),
      tag: `SEG ${String(index + 1).padStart(2, "0")}`,
      metric: `${index + 1}`,
      accent: accents[index % accents.length],
      callout: segmentVisualDescription(segment) || summarizeText(segment.text, 96),
      segmentIds: [id],
      entities: Array.isArray(segment.entities) ? segment.entities : [],
    };
  });

  return {
    id: project.id,
    title: script.title,
    width: size.width,
    height: size.height,
    aspectRatio: project.aspectRatio || script.aspectRatio || "9:16",
    templateId: normalizeTemplateId(project.templateId),
    fps: 24,
    duration: timings.length ? totalDuration : cursor,
    audio: project.voiceover || "voiceover.wav",
    captions: project.captions || "captions.vtt",
    bgm: "../assets/bgm.mp3",
    scenes,
    captionsTimeline: captionsTimeline.length
      ? captionsTimeline.map((item) => ({ id: item.id, start: item.start, end: item.end, text: item.text }))
      : timings.map((item) => ({ id: item.id, start: item.start, end: item.end, text: item.text })),
    captionSource: project.captionSource || (captionsTimeline.length ? "minimax" : "estimated"),
    createdAt: now(),
    updatedAt: now(),
  };
}


async function testMiniMaxAudioSettings(audioSettings, signal) {
  if (!audioSettings.minimaxApiKey) throw new Error("MiniMax API Key is not configured");
  if (!audioSettings.minimaxVoiceId) throw new Error("MiniMax voice_id is not configured");
  if (!audioSettings.minimaxBaseUrl) throw new Error("MiniMax Base URL is not configured");
  if (!audioSettings.minimaxModel) throw new Error("MiniMax model is not configured");
  const params = new URLSearchParams();
  if (audioSettings.minimaxGroupId) params.set("GroupId", audioSettings.minimaxGroupId);
  const endpoint = `${audioSettings.minimaxBaseUrl}/v1/t2a_v2${params.toString() ? `?${params}` : ""}`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Authorization": `Bearer ${audioSettings.minimaxApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: audioSettings.minimaxModel,
      text: "测试",
      stream: false,
      output_format: "hex",
      voice_setting: {
        voice_id: audioSettings.minimaxVoiceId,
        speed: audioSettings.minimaxSpeed,
        vol: audioSettings.minimaxVolume,
        pitch: audioSettings.minimaxPitch,
      },
      audio_setting: {
        sample_rate: audioSettings.minimaxSampleRate,
        bitrate: audioSettings.minimaxBitrate,
        format: "wav",
        channel: 1,
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`MiniMax HTTP ${response.status}: ${JSON.stringify(payload || {})}`);
  const statusCode = payload?.base_resp?.status_code ?? payload?.base_resp?.code ?? 0;
  if (statusCode !== 0) {
    throw new Error(payload?.base_resp?.status_msg || payload?.base_resp?.message || JSON.stringify(payload?.base_resp || {}));
  }
  if (!payload?.data?.audio) throw new Error("MiniMax did not return audio data");
  return true;
}

async function generateVoiceoverAudio(projectId, log, signal) {
  throwIfAborted(signal);
  const settings = await readSettings();
  const project = await readProject(projectId);
  if (!project) throw new Error("Project not found");
  const audioSettings = settings.audio;
  if (!audioSettings.minimaxApiKey) throw new Error("MiniMax API Key is not configured");
  if (!audioSettings.minimaxVoiceId) throw new Error("MiniMax voice_id is not configured");
  const segments = project.segments || [];
  if (!segments.length) throw new Error("No narration segments");
  const fullText = segments.map(segmentTextForTts).join("\n");
  const format = "wav";
  const output = projectPath(projectId, "voiceover.wav");
  log?.(`TTS full voiceover: provider=minimax, model=${audioSettings.minimaxModel}, voice=${audioSettings.minimaxVoiceId}, speed=${audioSettings.minimaxSpeed}`);
  log?.(`TTS segments: ${segments.length}`);
  const params = new URLSearchParams();
  if (audioSettings.minimaxGroupId) params.set("GroupId", audioSettings.minimaxGroupId);
  const endpoint = `${audioSettings.minimaxBaseUrl}/v1/t2a_v2${params.toString() ? `?${params}` : ""}`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Authorization": `Bearer ${audioSettings.minimaxApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: audioSettings.minimaxModel,
      text: fullText,
      stream: false,
      subtitle_enable: true,
      subtitle_type: "sentence",
      output_format: "hex",
      voice_setting: {
        voice_id: audioSettings.minimaxVoiceId,
        speed: audioSettings.minimaxSpeed,
        vol: audioSettings.minimaxVolume,
        pitch: audioSettings.minimaxPitch,
      },
      audio_setting: {
        sample_rate: audioSettings.minimaxSampleRate,
        bitrate: audioSettings.minimaxBitrate,
        format,
        channel: 1,
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`MiniMax TTS failed: HTTP ${response.status} ${JSON.stringify(payload || {})}`);
  }
  const statusCode = payload?.base_resp?.status_code ?? payload?.base_resp?.code ?? 0;
  if (statusCode !== 0) {
    throw new Error(`MiniMax TTS failed: ${payload?.base_resp?.status_msg || payload?.base_resp?.message || JSON.stringify(payload?.base_resp || {})}`);
  }
  const audioHex = payload?.data?.audio;
  if (!audioHex) throw new Error("MiniMax TTS failed: missing audio data");
  await fsp.writeFile(output, Buffer.from(audioHex, "hex"));
  throwIfAborted(signal);
  let subtitleSource = "none";
  const subtitleFile = await fetchMiniMaxSubtitleFile(payload, signal, log);
  let subtitles = subtitleFile.subtitles;
  if (subtitles.length) {
    subtitleSource = "minimax_subtitle_file";
  } else {
    subtitles = parseMiniMaxSubtitles(payload);
    if (subtitles.length) subtitleSource = "minimax_inline";
  }
  if (!subtitles.length) log?.("MiniMax subtitles missing; segment timings will be estimated from audio duration.");
  const probedDuration = await probeDuration(output).catch(() => null);
  const subtitleDuration = subtitles.length ? Number(subtitles.at(-1)?.end || 0) : 0;
  const duration = Number(probedDuration || subtitleDuration || 0);
  if (!duration) throw new Error("MiniMax TTS failed: unable to determine audio duration");
  const timings = mapSubtitlesToSegments(segments, subtitles, duration);
  const captionsTimeline = buildCaptionTimelineFromSubtitles(subtitles);
  const vtt = ["WEBVTT", ""];
  for (const timing of timings) {
    vtt.push(timing.id, `${vttTime(timing.start)} --> ${vttTime(timing.end)}`, timing.text, "");
  }
  await fsp.writeFile(projectPath(projectId, "captions.vtt"), vtt.join("\n"), "utf8");
  await writeJson(projectPath(projectId, "minimax-subtitles.json"), {
    source: subtitleSource,
    subtitleFileFound: subtitleFile.subtitleFileFound,
    subtitleFileLoaded: subtitleFile.subtitleFileLoaded,
    subtitles,
    response: sanitizeMiniMaxPayload(payload || {}),
  });
  const refreshed = await readProject(projectId);
  refreshed.segments = refreshed.segments.map((segment) => ({ ...segment, status: "approved" }));
  refreshed.timings = timings;
  refreshed.captionsTimeline = captionsTimeline;
  refreshed.captionSource = subtitleSource === "none" ? "estimated" : "minimax";
  refreshed.status = "audio_approved";
  refreshed.voiceover = "voiceover.wav";
  refreshed.captions = "captions.vtt";
  refreshed.renderPlan = buildRenderPlan(refreshed);
  refreshed.storyboards = syncStoryboardsWithRenderPlan(refreshed);
  refreshed.finalVideo = null;
  refreshed.updatedAt = now();
  await saveProject(refreshed);
  return { voiceover: "voiceover.wav", captions: "captions.vtt", duration, subtitles: subtitles.length, timings: timings.length };
}

async function probeDuration(file) {
  const result = await runCommand(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) ? value : null;
}

function vttTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const x = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(x).padStart(3, "0")}`;
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(Number(seconds || 0) * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const x = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(x).padStart(2, "0")}`;
}

function escapeAssText(text) {
  return String(text || "")
    .replace(/[{}]/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderAssSubtitles(plan, captions, videoSettings = DEFAULT_VIDEO_SETTINGS) {
  const width = Number(plan.width || 1080);
  const height = Number(plan.height || 1920);
  const fontSize = Math.round(width * 0.045);
  const marginX = Math.round(width * 0.075);
  const marginV = Math.round(height * 0.025);
  const outline = Math.max(2, Math.round(width * 0.0024));
  const position = normalizeVideoSettings(videoSettings).captionPosition;
  const alignment = position === "top" ? 8 : position === "middle" ? 5 : 2;
  const maxChars = captionMaxChars(plan);
  const groupedPlan = { ...plan, captionsTimeline: captions || [] };
  const groups = buildCaptionDisplayGroups(groupedPlan, maxChars);
  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${ASS_CAPTION_FONT},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000,1,0,0,0,100,100,0,0,1,${outline},0,${alignment},${marginX},${marginX},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const caption of groups) {
    if (!caption?.text) continue;
    const text = escapeAssText(caption.text);
    lines.push(`Dialogue: 0,${assTime(caption.start)},${assTime(caption.end)},Default,,0,0,0,,${text}`);
  }
  return `${lines.join("\n")}\n`;
}

function ffmpegFilterPath(file) {
  return String(file).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function ffmpegSubtitlesFilter(file) {
  const base = `subtitles=filename='${ffmpegFilterPath(file)}'`;
  return fs.existsSync(ASS_FONTS_DIR) ? `${base}:fontsdir='${ffmpegFilterPath(ASS_FONTS_DIR)}'` : base;
}

function ffmpegRenderLog(log) {
  return (chunk) => {
    const lines = String(chunk || "").split(/\r?\n/);
    const filtered = lines.filter((line) => {
      if (!line.trim()) return false;
      if (/\[Parsed_subtitles_\d+ @ .*?\] Error (opening font|getting metadata for embedded font)/.test(line)) return false;
      return true;
    });
    if (filtered.length) log(filtered.join("\n"));
  };
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function cssPercent(time, duration) {
  if (!duration) return 0;
  return Math.max(0, Math.min(100, (time / duration) * 100));
}


async function storyboardStyle(templateId) {
  const id = normalizeTemplateId(templateId);
  const templates = listVideoTemplates();
  const template = templates.find((item) => item.id === id) || templates[0] || {
    id: "stickman",
    name: "火柴人极简解释图",
    imageStyle: {},
  };
  const promptFile = template.imageStyle?.promptFile || "image-style.md";
  const prompt = await readTemplateText(id, promptFile, "").catch(() => "");
  const fallbackPrompt = await readTemplateText(template.id, promptFile, "").catch(() => "");
  return {
    id: template.id,
    name: template.name || template.id,
    background: template.imageStyle?.background || "#ffffff",
    ink: template.imageStyle?.ink || "#111111",
    muted: template.imageStyle?.muted || "#4a4a4a",
    accent: template.imageStyle?.accent || "#f05a28",
    secondary: template.imageStyle?.secondary || "#2367d1",
    surface: template.imageStyle?.surface || "#ffffff",
    prompt: String(prompt || fallbackPrompt || "").trim(),
  };
}

function storyboardDir(projectId) {
  return projectPath(projectId, "storyboards");
}

function storyboardFileForScene(scene, ext = "png") {
  const safeExt = String(ext || "png").replace(/^\./, "").toLowerCase();
  return `segment-${String(scene.index || 1).padStart(3, "0")}.${safeExt}`;
}

function storyboardIdForFile(file) {
  const name = path.basename(String(file || ""));
  if (!/^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|svg)$/i.test(name)) throw new Error("Invalid storyboard name");
  return name.replace(/\.(png|jpg|jpeg|webp|svg)$/i, "");
}

function storyboardSceneForFile(project, file) {
  const plan = project.renderPlan || buildRenderPlan(project);
  const number = Number(file.match(/(\d+)/)?.[1] || 1);
  const segmentScenes = plan.scenes.filter((item) => item.type === "segment");
  return { plan, scene: segmentScenes[number - 1] || plan.scenes[number - 1] || plan.scenes[0] };
}

function syncStoryboardsWithRenderPlan(project) {
  const plan = project.renderPlan || buildRenderPlan(project);
  const scenesById = new Map((plan.scenes || []).map((scene) => [scene.id, scene]));
  const storyboards = Array.isArray(project.storyboards) ? project.storyboards : [];
  return storyboards.map((item) => {
    const scene = scenesById.get(item.sceneId) || storyboardSceneForFile({ ...project, renderPlan: plan }, item.file).scene;
    if (!scene) return item;
    return {
      ...item,
      sceneId: scene.id,
      title: scene.title || item.title || plan.title || project.name,
      width: plan.width,
      height: plan.height,
      start: scene.start,
      end: scene.end,
    };
  });
}

async function recoverStoryboardsFromFiles(projectId, project) {
  const dir = storyboardDir(projectId);
  const names = await fsp.readdir(dir).catch(() => []);
  const files = names
    .filter((name) => /^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp|svg)$/i.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)?.[1] || 0) - Number(b.match(/(\d+)/)?.[1] || 0));
  if (!files.length) return [];
  const plan = project.renderPlan || buildRenderPlan(project);
  return files.map((file) => {
    const { scene } = storyboardSceneForFile({ ...project, renderPlan: plan }, file);
    return {
      id: storyboardIdForFile(file),
      sceneId: scene?.id || storyboardIdForFile(file),
      file,
      path: `storyboards/${file}`,
      title: scene?.title || plan.title || project.name,
      prompt: "",
      revisedPrompt: null,
      width: plan.width,
      height: plan.height,
      start: scene?.start || 0,
      end: scene?.end || 0,
      updatedAt: now(),
    };
  });
}

function svgTextLines(text, maxChars, maxLines) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  const lines = [];
  let current = "";
  for (const char of source) {
    if ((current + char).length > maxChars && current) {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
    } else {
      current += char;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

async function renderStoryboardSvg(project, plan, scene) {
  const style = await storyboardStyle(project.templateId || plan.templateId);
  const width = Number(plan.width || 720);
  const height = Number(plan.height || 1280);
  const accent = scene.accent || style.accent;
  const isCover = scene.type === "cover";
  const isBack = scene.type === "back";
  const label = isCover ? "OPENING" : isBack ? "ENDING" : `SHOT ${String(scene.index || 1).padStart(2, "0")}`;
  const title = scene.title || plan.title || project.name || "VideoFlow";
  const summary = scene.summary || scene.subtitle || scene.callout || "";
  const metric = scene.metric || (isCover ? "START" : isBack ? "END" : "FRAME");
  const callout = scene.callout || summary || scene.subtitle || "";
  const titleLines = svgTextLines(title, 9, 4);
  const summaryLines = svgTextLines(summary, 18, 4);
  const calloutLines = svgTextLines(callout, 20, 3);
  const titleY = Math.round(height * 0.25);
  const summaryY = Math.round(height * 0.54);
  const bottomY = Math.round(height * 0.78);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${escapeHtml(isCover || isBack ? style.ink : style.background)}"/>
  <rect x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.055)}" width="${Math.round(width * 0.88)}" height="3" fill="${escapeHtml(isCover || isBack ? style.background : style.ink)}" opacity="0.85"/>
  <circle cx="${Math.round(width * 0.82)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.22)}" fill="${escapeHtml(accent)}" opacity="${isCover || isBack ? "0.95" : "0.22"}"/>
  <circle cx="${Math.round(width * 0.17)}" cy="${Math.round(height * 0.82)}" r="${Math.round(width * 0.15)}" fill="${escapeHtml(style.secondary)}" opacity="${isCover || isBack ? "0.72" : "0.16"}"/>
  <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.1)}" fill="${escapeHtml(isCover || isBack ? style.background : style.muted)}" font-family="Arial, 'PingFang SC', sans-serif" font-size="${Math.round(width * 0.032)}" font-weight="800" letter-spacing="2">${escapeHtml(label)}</text>
  <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.19)}" fill="${escapeHtml(isCover || isBack ? style.background : style.ink)}" font-family="Arial, 'PingFang SC', sans-serif" font-size="${Math.round(width * 0.16)}" font-weight="900" opacity="${isCover || isBack ? "0.16" : "0.1"}">${escapeHtml(metric)}</text>
  ${titleLines.map((line, index) => `<text x="${Math.round(width * 0.08)}" y="${titleY + index * Math.round(width * 0.105)}" fill="${escapeHtml(isCover || isBack ? style.background : style.ink)}" font-family="Arial, 'PingFang SC', sans-serif" font-size="${Math.round(width * 0.095)}" font-weight="900">${escapeHtml(line)}</text>`).join("\n  ")}
  ${summaryLines.map((line, index) => `<text x="${Math.round(width * 0.08)}" y="${summaryY + index * Math.round(width * 0.052)}" fill="${escapeHtml(isCover || isBack ? "#f6efe3" : style.muted)}" font-family="Arial, 'PingFang SC', sans-serif" font-size="${Math.round(width * 0.038)}" font-weight="600">${escapeHtml(line)}</text>`).join("\n  ")}
  <rect x="${Math.round(width * 0.08)}" y="${bottomY}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.12)}" rx="8" fill="${escapeHtml(isCover || isBack ? style.background : style.surface)}" opacity="${isCover || isBack ? "0.95" : "1"}"/>
  <text x="${Math.round(width * 0.12)}" y="${bottomY + Math.round(height * 0.04)}" fill="${escapeHtml(isCover || isBack ? style.ink : accent)}" font-family="Arial, 'PingFang SC', sans-serif" font-size="${Math.round(width * 0.026)}" font-weight="900" letter-spacing="1">DIRECTOR NOTE</text>
  ${calloutLines.map((line, index) => `<text x="${Math.round(width * 0.12)}" y="${bottomY + Math.round(height * 0.073) + index * Math.round(width * 0.038)}" fill="${escapeHtml(style.ink)}" font-family="Arial, 'PingFang SC', sans-serif" font-size="${Math.round(width * 0.032)}" font-weight="700">${escapeHtml(line)}</text>`).join("\n  ")}
  <text x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.95)}" fill="${escapeHtml(isCover || isBack ? style.background : style.muted)}" font-family="Arial, sans-serif" font-size="${Math.round(width * 0.024)}" font-weight="700">STYLE / ${escapeHtml(style.name)} · ${escapeHtml(plan.aspectRatio)}</text>
</svg>`;
}

function imageSizeForPlan(plan) {
  if (plan.aspectRatio === "16:9") return "1536x1024";
  if (plan.aspectRatio === "1:1") return "1024x1024";
  return "1024x1536";
}

function storyboardEntitySpecs(project, scene) {
  const entityMap = visualBibleEntityMap(project.visualBible);
  const ids = Array.isArray(scene.entities) ? scene.entities : [];
  const specs = ids.map((id) => entityMap.get(normalizeEntityId(id))).filter(Boolean);
  if (!specs.length) return "";
  return [
    "Visual Bible entity specs for this frame. Treat these as hard consistency constraints across the whole video:",
    ...specs.map((item) => {
      const fixed = [
        `${item.group}/${item.id}`,
        item.name ? `name: ${item.name}` : "",
        item.role ? `role: ${item.role}` : "",
        item.stableDescription ? `stable visual description: ${item.stableDescription}` : "",
        item.doNotChange?.length ? `do not change: ${item.doNotChange.join("; ")}` : "",
      ].filter(Boolean).join("; ");
      return `- ${fixed}`;
    }),
    "Only render listed entities if they are useful for this frame. Do not redesign recurring entities. Pose, angle, scale, and action may change, but identity, silhouette, and key features must remain stable.",
  ].join("\n");
}

async function storyboardPrompt(project, plan, scene) {
  const style = await storyboardStyle(project.templateId || plan.templateId);
  const suggestedLabels = [
    shortLabel(scene.title, "重点"),
    shortLabel(scene.visualDescription, ""),
  ].filter(Boolean).slice(0, 3).join(" / ");
  const entitySpecs = storyboardEntitySpecs(project, scene);
  return [
    `Generate one standalone Chinese article illustration for a video storyboard frame.`,
    `Canvas aspect ratio: ${plan.aspectRatio}. If vertical, leave subtitle-safe white space near the lower third.`,
    `Use this exact template style and character system:\n${style.prompt}`,
    entitySpecs,
    `Scene role: narration segment storyboard frame ${scene.index || 1}.`,
    `Theme: ${scene.title || plan.title || project.name}.`,
    `Narration segment text: ${scene.summary || scene.subtitle || scene.callout || ""}.`,
    scene.visualDescription ? `Template-neutral scene description: ${scene.visualDescription}.` : "",
    `Core idea: show this single narration segment as one concrete storyboard moment. Do not combine multiple narration segments into this image.`,
    `Composition: show one small physical scene caught in the middle of action. Make the template's main character or character system actively do one visible action. If the scene description mentions 主角, 人物, person, or character, render that subject using the current template's character system, not as a realistic human. Prefer everyday props and simple stage-like setups. Avoid abstract rectangles, empty containers, dashboard-like layouts, system boxes, concept maps, and diagram arrows unless they are physical objects inside the scene.`,
    `Director note: ${scene.visualDescription || scene.callout || "Make the abstract idea visible as one clear action."}`,
    `Optional handwritten Chinese labels: ${suggestedLabels || "输入 / 判断 / 结果"}. Use only if helpful, keep labels short and sparse. Labels must describe objects, forces, states, actions, or outcomes only. Never label the character by name; do not write "小黑", "Xiaohei", "主角", "人物", or "角色" inside the image.`,
    `Hard constraints: pure white background; one image explains one moment only; no title in the top-left corner; no PPT infographic; no formal flowchart; no commercial vector illustration; no cute mascot poster; no children's illustration; no realistic UI; no screenshots; no dense explanatory text; no gradients; no shadows; no paper texture; no complex background; do not copy existing examples or known case compositions.`,
  ].filter(Boolean).join("\n");
}

async function generateStoryboardImage(project, plan, scene, outputFile, log, signal) {
  const settings = await readSettings();
  if (!settings.apiKey) throw new Error("Missing API key. Save model settings first.");
  const endpoint = `${settings.baseUrl.replace(/\/+$/, "")}/images/generations`;
  const prompt = await storyboardPrompt(project, plan, scene);
  const body = {
    model: settings.image.model || DEFAULT_IMAGE_SETTINGS.model,
    prompt,
    size: imageSizeForPlan(plan),
    quality: settings.image.quality || DEFAULT_IMAGE_SETTINGS.quality,
    output_format: settings.image.outputFormat || DEFAULT_IMAGE_SETTINGS.outputFormat,
  };
  log?.(`Image ${path.basename(outputFile)}: ${body.model}, ${body.size}, ${body.quality}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Image request timed out after 90s")), 90000);
  const abort = () => controller.abort(new Error("Job cancelled"));
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Image request failed: ${response.status}`);
  const image = payload.data?.[0];
  if (!image?.b64_json) throw new Error("Image API response did not include b64_json");
  await fsp.writeFile(outputFile, Buffer.from(image.b64_json, "base64"));
  return { prompt, revisedPrompt: image.revised_prompt || null };
}

async function writeStoryboards(projectId, project, log, signal, job) {
  if (!project.visualBible) throw new Error("Missing visualBible. Regenerate the script before generating storyboard images.");
  const plan = buildRenderPlan(project);
  const settings = await readSettings();
  const outputFormat = settings.image.outputFormat || DEFAULT_IMAGE_SETTINGS.outputFormat;
  project.renderPlan = plan;
  const dir = storyboardDir(projectId);
  await fsp.mkdir(dir, { recursive: true });
  const existingByFile = new Map(syncStoryboardsWithRenderPlan(project).map((item) => [item.file, item]));
  const sceneOrder = new Map(plan.scenes.map((scene, index) => [scene.id, index]));
  const sortStoryboards = (items) => items
    .slice()
    .sort((a, b) => {
      const ai = sceneOrder.has(a.sceneId) ? sceneOrder.get(a.sceneId) : Number.MAX_SAFE_INTEGER;
      const bi = sceneOrder.has(b.sceneId) ? sceneOrder.get(b.sceneId) : Number.MAX_SAFE_INTEGER;
      return ai - bi || String(a.file || "").localeCompare(String(b.file || ""));
    });
  const upsertStoryboard = (item) => {
    const current = Array.isArray(project.storyboards) ? project.storyboards : [];
    project.storyboards = sortStoryboards(
      current.some((existing) => existing.file === item.file)
        ? current.map((existing) => existing.file === item.file ? item : existing)
        : [...current, item],
    );
  };
  const storyboards = sortStoryboards([...existingByFile.values()]);
  const failed = [];
  project.storyboards = storyboards;
  project.updatedAt = now();
  await saveProject(project);

  let generatedCount = storyboards.length;
  const activeFiles = new Set();
  let saveChain = Promise.resolve();
  const persistProject = async () => {
    saveChain = saveChain.then(async () => {
      project.updatedAt = now();
      await saveProject(project);
    });
    await saveChain;
  };
  const updateJobMeta = (patch = {}) => {
    if (!job?.meta) return;
    Object.assign(job.meta, patch);
    job.meta.generated = generatedCount;
    job.meta.failed = failed.length;
    job.meta.running = activeFiles.size;
    job.meta.currentSegments = [...activeFiles];
    job.meta.currentSegment = [...activeFiles].join(", ") || null;
    job.updatedAt = now();
  };
  updateJobMeta({ phase: "generating_storyboards", concurrency: STORYBOARD_IMAGE_CONCURRENCY });

  const pendingScenes = plan.scenes.filter((scene) => {
    const file = storyboardFileForScene(scene, outputFormat);
    const target = path.join(dir, file);
    const existing = existingByFile.get(file);
    if (existing && fs.existsSync(target)) {
      const item = { ...existing, start: scene.start, end: scene.end, width: plan.width, height: plan.height };
      upsertStoryboard(item);
      return false;
    }
    return true;
  });
  storyboards.splice(0, storyboards.length, ...project.storyboards);
  generatedCount = storyboards.length;
  await persistProject();
  log?.(`Storyboard queue: ${pendingScenes.length} to generate, ${generatedCount} existing, concurrency ${STORYBOARD_IMAGE_CONCURRENCY}`);
  updateJobMeta();

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < pendingScenes.length) {
      throwIfAborted(signal);
      const scene = pendingScenes[nextIndex++];
      const file = storyboardFileForScene(scene, outputFormat);
      await processScene(scene, file);
    }
  }

  async function processScene(scene, file) {
    throwIfAborted(signal);
    const target = path.join(dir, file);
    activeFiles.add(file);
    updateJobMeta();
    let generated;
    try {
      generated = await generateStoryboardImage(project, plan, scene, target, log, signal);
    } catch (error) {
      if (signal?.aborted || error.message === "Job cancelled") throw error;
      failed.push({ file, sceneId: scene.id, error: error.message });
      log?.(`Failed ${file}: ${error.message}`);
      activeFiles.delete(file);
      updateJobMeta();
      return;
    }
    const item = {
      id: storyboardIdForFile(file),
      sceneId: scene.id,
      file,
      path: `storyboards/${file}`,
      title: scene.title || plan.title || project.name,
      prompt: generated.prompt,
      revisedPrompt: generated.revisedPrompt,
      width: plan.width,
      height: plan.height,
      start: scene.start,
      end: scene.end,
      updatedAt: now(),
    };
    upsertStoryboard(item);
    storyboards.splice(0, storyboards.length, ...project.storyboards);
    generatedCount = storyboards.length;
    activeFiles.delete(file);
    await persistProject();
    updateJobMeta();
  }

  const workers = Array.from({ length: Math.min(STORYBOARD_IMAGE_CONCURRENCY, Math.max(1, pendingScenes.length)) }, () => worker());
  await Promise.all(workers);
  updateJobMeta({ phase: failed.length ? "done_with_failures" : "done", running: 0, currentSegments: [], currentSegment: null });
  project.storyboards = sortStoryboards(project.storyboards || []);
  await persistProject();
  return { storyboards, failed };
}

async function listStoryboards(projectId) {
  const project = await readProject(projectId);
  if (!project) return { storyboards: [] };
  let items = Array.isArray(project.storyboards) ? project.storyboards : [];
  if (!items.length) {
    items = await recoverStoryboardsFromFiles(projectId, project);
  } else {
    items = syncStoryboardsWithRenderPlan(project);
  }
  if (items.length) {
    project.storyboards = items;
    project.updatedAt = now();
    await saveProject(project);
  }
  return { storyboards: items.map((item) => ({ ...item, url: `/projects/${encodeURIComponent(projectId)}/${item.path}` })) };
}

async function regenerateStoryboard(projectId, file, log, signal) {
  const project = await readProject(projectId);
  if (!project) throw new Error("Project not found");
  project.renderPlan = project.renderPlan || buildRenderPlan(project);
  const { plan, scene } = storyboardSceneForFile(project, file);
  if (!scene) throw new Error("Storyboard scene not found");
  const dir = storyboardDir(projectId);
  await fsp.mkdir(dir, { recursive: true });
  const outputFormat = (await readSettings()).image.outputFormat || DEFAULT_IMAGE_SETTINGS.outputFormat;
  const normalizedFile = `${storyboardIdForFile(file)}.${outputFormat}`;
  const generated = await generateStoryboardImage(project, plan, scene, path.join(dir, normalizedFile), log, signal);
  const next = {
    id: storyboardIdForFile(normalizedFile),
    sceneId: scene.id,
    file: normalizedFile,
    path: `storyboards/${normalizedFile}`,
    title: scene.title || plan.title || project.name,
    prompt: generated.prompt,
    revisedPrompt: generated.revisedPrompt,
    width: plan.width,
    height: plan.height,
    start: scene.start,
    end: scene.end,
    updatedAt: now(),
  };
  const current = Array.isArray(project.storyboards) ? project.storyboards : [];
  project.storyboards = current.some((item) => item.file === file)
    ? current.map((item) => item.file === file ? next : item)
    : [...current, next];
  project.updatedAt = now();
  await saveProject(project);
  return next;
}


async function renderFinalVideo(projectId, log, signal) {
  throwIfAborted(signal);
  const project = await readProject(projectId);
  if (!project) throw new Error("Project not found");
  if (!(await exists(projectPath(projectId, "voiceover.wav")))) throw new Error("Generate full voiceover before rendering video");
  project.renderPlan = buildRenderPlan(project);
  const expectedSceneIds = new Set(project.renderPlan.scenes.map((scene) => scene.id));
  const currentSceneIds = new Set((Array.isArray(project.storyboards) ? project.storyboards : []).map((item) => item.sceneId));
  const missingStoryboardCount = [...expectedSceneIds].filter((id) => !currentSceneIds.has(id)).length;
  if (!Array.isArray(project.storyboards) || !project.storyboards.length || missingStoryboardCount > 0) {
    log("Generating storyboard images");
    await writeStoryboards(projectId, project, log, signal);
  }
  const latestForRender = await readProject(projectId);
  const plan = buildRenderPlan(latestForRender);
  latestForRender.renderPlan = plan;
  await saveProject(latestForRender);
  const storyboards = Array.isArray(latestForRender.storyboards) ? latestForRender.storyboards : [];
  if (!storyboards.length) throw new Error("Generate storyboard images before rendering video");
  const sceneById = new Map(plan.scenes.map((scene) => [scene.id, scene]));
  const timedStoryboards = storyboards.map((item) => {
    const scene = sceneById.get(item.sceneId);
    if (!scene) throw new Error(`Storyboard ${item.file} is not linked to a segment scene`);
    return scene ? { ...item, sceneId: scene.id, start: scene.start, end: scene.end } : item;
  }).sort((a, b) => Number(a.start || 0) - Number(b.start || 0) || String(a.file || "").localeCompare(String(b.file || "")));
  const renderDir = projectPath(projectId, "renders");
  await fsp.mkdir(renderDir, { recursive: true });
  const silent = path.join(renderDir, "silent.mp4");
  const final = path.join(renderDir, "final.mp4");
  const concatFile = path.join(renderDir, "storyboards.concat.txt");
  const subtitlesFile = path.join(renderDir, "captions.ass");
  const videoSettings = normalizeVideoSettings(latestForRender.videoSettings);
  const lines = [];
  const storyboardTimeline = [];
  for (const [index, item] of timedStoryboards.entries()) {
    const displayStart = index === 0 ? 0 : Number(item.start || 0);
    const next = timedStoryboards[index + 1];
    const displayEnd = next ? Number(next.start || 0) : Number(plan.duration || item.end || 0);
    const sceneDuration = Number(item.end || 0) - Number(item.start || 0);
    const duration = Math.max(0.5, Number.isFinite(displayEnd - displayStart) && displayEnd > displayStart ? displayEnd - displayStart : sceneDuration);
    const source = projectPath(projectId, item.path);
    if (!(await exists(source))) throw new Error(`Missing storyboard image: ${item.path}`);
    storyboardTimeline.push({ item, source, duration });
    lines.push(`file '${source.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${duration.toFixed(3)}`);
  }
  const last = timedStoryboards.at(-1);
  if (last) lines.push(`file '${projectPath(projectId, last.path).replace(/'/g, "'\\''")}'`);
  await fsp.writeFile(concatFile, `${lines.join("\n")}\n`, "utf8");
  const slideshowDuration = timedStoryboards.reduce((sum, item, index) => {
    const displayStart = index === 0 ? 0 : Number(item.start || 0);
    const next = timedStoryboards[index + 1];
    const displayEnd = next ? Number(next.start || 0) : Number(plan.duration || item.end || 0);
    return sum + Math.max(0, displayEnd - displayStart);
  }, 0);
  log(`Storyboard timeline: ${timedStoryboards.length} images, ${slideshowDuration.toFixed(3)}s / audio plan ${Number(plan.duration || 0).toFixed(3)}s`);
  log("Rendering storyboard slideshow");
  const fps = Number(plan.fps || 24);
  const slideshowInputs = [];
  const frameFilters = [];
  const concatInputs = [];
  storyboardTimeline.forEach((entry, index) => {
    slideshowInputs.push(
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      entry.duration.toFixed(3),
      "-i",
      entry.source,
    );
    frameFilters.push(
      `[${index}:v]scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p,setsar=1[v${index}]`,
    );
    concatInputs.push(`[v${index}]`);
  });
  const slideshowFilter = `${frameFilters.join(";")};${concatInputs.join("")}concat=n=${storyboardTimeline.length}:v=1:a=0,format=yuv420p[v]`;
  await runCommand(FFMPEG, [
    "-y",
    ...slideshowInputs,
    "-filter_complex",
    slideshowFilter,
    "-map",
    "[v]",
    "-t",
    String(plan.duration),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    silent,
  ], { onLog: log, signal });
  throwIfAborted(signal);
  const captions = Array.isArray(latestForRender.timings) && latestForRender.timings.length
    ? latestForRender.timings
    : Array.isArray(plan.captionsTimeline) ? plan.captionsTimeline : [];
  if (videoSettings.captionsEnabled) {
    await fsp.writeFile(subtitlesFile, renderAssSubtitles(plan, captions, videoSettings), "utf8");
  } else {
    await fsp.rm(subtitlesFile, { force: true });
  }
  const videoFilter = videoSettings.captionsEnabled
    ? `[0:v]${ffmpegSubtitlesFilter(subtitlesFile)},setpts=PTS/${videoSettings.playbackSpeed}[v]`
    : `[0:v]setpts=PTS/${videoSettings.playbackSpeed}[v]`;
  const audioMixFilter = videoSettings.bgmEnabled
    ? `[2:a]volume=0.07,atrim=0:${plan.duration}[bgm];[1:a]volume=1.0[voice];[voice][bgm]amix=inputs=2:duration=first:dropout_transition=0[mix]`
    : `[1:a]volume=1.0[mix]`;
  const audioFilter = `${audioMixFilter};[mix]atempo=${videoSettings.playbackSpeed}[a]`;
  const mixArgs = [
    "-y",
    "-i",
    silent,
    "-i",
    projectPath(projectId, "voiceover.wav"),
  ];
  if (videoSettings.bgmEnabled) {
    mixArgs.push(
      "-stream_loop",
      "-1",
      "-i",
      path.join(ASSETS_DIR, "bgm.mp3"),
    );
  }
  log(`Rendering final MP4: captions=${videoSettings.captionsEnabled ? videoSettings.captionPosition : "off"}, bgm=${videoSettings.bgmEnabled ? "on" : "off"}, speed=${videoSettings.playbackSpeed}x`);
  await runCommand(FFMPEG, [
    ...mixArgs,
    "-filter_complex",
    `${videoFilter};${audioFilter}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    final,
  ], { onLog: ffmpegRenderLog(log), signal });
  throwIfAborted(signal);
  const latest = await readProject(projectId);
  latest.status = "video_ready";
  latest.finalVideo = "renders/final.mp4";
  latest.storyboards = timedStoryboards;
  latest.updatedAt = now();
  await saveProject(latest);
  return { video: "renders/final.mp4" };
}

async function listProjects() {
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = await readJson(path.join(PROJECTS_DIR, entry.name, "project.json"), null);
    if (project) {
      const segments = await readJson(path.join(PROJECTS_DIR, entry.name, "segments.json"), []);
      const segmentCount = Array.isArray(segments) ? segments.length : 0;
      projects.push({
        ...project,
        segmentCount,
        approvedSegmentCount: project.voiceover ? segmentCount : 0,
      });
    }
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function commandAvailable(command) {
  try {
    await runCommand(command, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    const settings = await readSettings();
    return json(res, 200, {
      ok: true,
      ffmpeg: await commandAvailable(FFMPEG),
      ffprobe: await commandAvailable(FFPROBE),
      minimaxApiKey: Boolean(settings.audio.minimaxApiKey),
      minimaxVoiceId: Boolean(settings.audio.minimaxVoiceId),
      bgm: await exists(path.join(ASSETS_DIR, "bgm.mp3")),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/templates") {
    return json(res, 200, { templates: listVideoTemplates(), aspectRatios: Object.keys(aspectRatioSizes) });
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    return json(res, 200, { settings: await publicSettings() });
  }

  if (req.method === "PUT" && url.pathname === "/api/settings") {
    const body = await bodyJson(req);
    await saveSettings(body);
    return json(res, 200, { settings: await publicSettings() });
  }

  if (req.method === "POST" && url.pathname === "/api/settings/test") {
    try {
      const body = await bodyJson(req);
      const saved = await readSettings();
      const settings = {
        ...saved,
        baseUrl: String(body.baseUrl || "").replace(/\/+$/, "") || saved.baseUrl,
        model: String(body.model || "") || saved.model,
        temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : saved.temperature,
        apiKey: String(body.apiKey || "") || saved.apiKey,
      };
      const content = await callOpenAiCompatible(settings, [
        {
          role: "system",
          content: "只输出 JSON。",
        },
        {
          role: "user",
          content: '请输出 {"ok":true,"message":"模型连接正常"}',
        },
      ]);
      return json(res, 200, { ok: true, content: extractJson(content) });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/settings/audio-test") {
    const body = await bodyJson(req);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const audio = await resolveAudioSettings(body.audio || {});
      await testMiniMaxAudioSettings(audio, controller.signal);
      return json(res, 200, { ok: true, message: "音频模型验证通过" });
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    return json(res, 200, { projects: await listProjects() });
  }

  if (req.method === "POST" && url.pathname === "/api/projects") {
    const body = await bodyJson(req);
    const base = safeId(body.name || `video-${Date.now()}`) || `video-${Date.now()}`;
    const id = `${base}-${Date.now().toString(36)}`;
    const aspectRatio = aspectRatioSizes[body.aspectRatio] ? body.aspectRatio : "9:16";
    const templateId = normalizeTemplateId(body.templateId);
    const project = {
      id,
      name: body.name || base,
      status: "draft",
      aspectRatio,
      templateId,
      videoType: "explainer",
      videoSettings: normalizeVideoSettings(),
      createdAt: now(),
      updatedAt: now(),
    };
    await saveProject({ ...project, source: "", segments: [] });
    return json(res, 201, { project });
  }

  const match = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(.+))?$/);
  if (!match) return false;
  const projectId = decodeURIComponent(match[1]);
  const tail = match[2] || "";
  const project = await readProject(projectId);
  if (!project) return json(res, 404, { error: "Project not found" });

  if (req.method === "GET" && !tail) return json(res, 200, { project });

  if (req.method === "DELETE" && !tail) {
    const body = await bodyJson(req).catch(() => ({}));
    if (body.confirmDelete !== true && body.confirmName !== project.name) {
      return json(res, 400, { error: "Project name confirmation does not match" });
    }
    await fsp.rm(projectPath(projectId), { recursive: true, force: true });
    return json(res, 200, { deleted: true, id: projectId });
  }

  if (req.method === "PUT" && tail === "source") {
    const body = await bodyJson(req);
    project.source = String(body.source || "");
    project.updatedAt = now();
    await saveProject(project);
    return json(res, 200, { project });
  }

  if (req.method === "PUT" && tail === "video-settings") {
    const body = await bodyJson(req);
    project.videoSettings = normalizeVideoSettings(body.videoSettings || body);
    project.updatedAt = now();
    await saveProject(project);
    return json(res, 200, { project });
  }

  if (req.method === "POST" && tail === "script/generate-llm") {
    const body = await bodyJson(req);
    let job;
    try {
      job = createProjectJob(projectId, "Generate script with LLM", "script", async (log, signal, currentJob) => {
      log("Calling LLM");
      currentJob.meta.phase = "calling_llm";
      throwIfAborted(signal);
      const latest = await readProject(projectId);
      const result = await generateScriptWithLlm(latest, body, log);
      throwIfAborted(signal);
      currentJob.meta.phase = "saving_script";
      latest.script = result.script;
      latest.segments = result.segments;
      latest.visualBible = result.visualBible;
      latest.renderPlan = null;
      latest.storyboards = [];
      latest.status = "script_ready";
      latest.updatedAt = now();
      await saveProject(latest);
      return { title: result.script.title, segments: result.segments.length };
      });
    } catch (error) {
      if (error.activeJob) return json(res, 409, { error: error.message, job: publicJob(error.activeJob) });
      throw error;
    }
    return json(res, 202, { job: publicJob(job) });
  }

  if (req.method === "PUT" && tail === "script") {
    const body = await bodyJson(req);
    project.script = { ...(project.script || buildScript(project)), ...body.script, updatedAt: now() };
    project.updatedAt = now();
    await saveProject(project);
    return json(res, 200, { script: project.script });
  }

  if (req.method === "POST" && tail === "render-plan") {
    if (!project.script) project.script = buildScript(project);
    project.renderPlan = buildRenderPlan(project);
    project.storyboards = syncStoryboardsWithRenderPlan(project);
    project.finalVideo = null;
    project.updatedAt = now();
    await saveProject(project);
    return json(res, 200, { renderPlan: project.renderPlan });
  }

  if (req.method === "GET" && tail === "storyboards") {
    return json(res, 200, await listStoryboards(projectId));
  }

  if (req.method === "POST" && tail === "storyboards/generate") {
    let job;
    try {
      job = createProjectJob(projectId, "Generate storyboard images", "storyboards", async (log, signal, currentJob) => {
        const latest = await readProject(projectId);
        if (!latest.script) latest.script = buildScript(latest);
        if (!latest.renderPlan) latest.renderPlan = buildRenderPlan(latest);
        currentJob.meta.total = latest.renderPlan.scenes.length;
        currentJob.meta.generated = 0;
        currentJob.meta.failed = 0;
        currentJob.meta.phase = "generating_storyboards";
        const result = await writeStoryboards(projectId, latest, log, signal, currentJob);
        currentJob.meta.generated = result.storyboards.length;
        currentJob.meta.failed = result.failed.length;
        currentJob.meta.phase = result.failed.length ? "done_with_failures" : "done";
        return { generated: result.storyboards.length, failed: result.failed };
      }, { total: project.renderPlan?.scenes?.length || 0, generated: 0, failed: 0, phase: "queued" });
    } catch (error) {
      if (error.activeJob) return json(res, 409, { error: error.message, job: publicJob(error.activeJob) });
      throw error;
    }
    return json(res, 202, { job: publicJob(job) });
  }

  const storyboardRegenMatch = tail.match(/^storyboards\/([^/]+)\/regenerate$/);
  if (req.method === "POST" && storyboardRegenMatch) {
    const file = path.basename(decodeURIComponent(storyboardRegenMatch[1]));
    storyboardIdForFile(file);
    try {
      const job = createProjectJob(projectId, `Regenerate ${file}`, "storyboards", async (log, signal, currentJob) => {
        currentJob.meta.total = 1;
        currentJob.meta.generated = 0;
        currentJob.meta.currentSegment = file;
        const item = await regenerateStoryboard(projectId, file, log, signal);
        currentJob.meta.generated = 1;
        currentJob.meta.currentSegment = null;
        return item;
      }, { total: 1, generated: 0, currentSegment: file });
      return json(res, 202, { job: publicJob(job) });
    } catch (error) {
      if (error.activeJob) return json(res, 409, { error: error.message, job: publicJob(error.activeJob) });
      throw error;
    }
  }
  const sceneMatch = tail.match(/^render-plan\/scenes\/([^/]+)$/);
  if (req.method === "PUT" && sceneMatch) {
    if (!project.renderPlan) return json(res, 400, { error: "Render plan has not been generated" });
    const body = await bodyJson(req);
    const scene = project.renderPlan.scenes.find((item) => item.id === sceneMatch[1]);
    if (!scene) return json(res, 404, { error: "Scene not found" });
    const textFields = ["title", "subtitle", "summary", "tag", "metric", "accent", "callout"];
    for (const field of textFields) {
      if (typeof body[field] === "string") scene[field] = body[field].slice(0, field === "summary" || field === "callout" ? 240 : 80);
    }
    const nextStart = Number(body.start);
    const nextEnd = Number(body.end);
    if (Number.isFinite(nextStart) && Number.isFinite(nextEnd) && nextStart >= 0 && nextEnd > nextStart) {
      scene.start = nextStart;
      scene.end = nextEnd;
    }
    project.updatedAt = now();
    await saveProject(project);
    return json(res, 200, { scene, renderPlan: project.renderPlan });
  }
  if (req.method === "POST" && tail === "video/render") {
    let job;
    try {
      job = createProjectJob(projectId, "Render final video", "render", (log, signal, currentJob) => {
        currentJob.meta.phase = "rendering";
        return renderFinalVideo(projectId, log, signal);
      });
    } catch (error) {
      if (error.activeJob) return json(res, 409, { error: error.message, job: publicJob(error.activeJob) });
      throw error;
    }
    return json(res, 202, { job: publicJob(job) });
  }

  const segmentMatch = tail.match(/^segments\/([^/]+)$/);
  if (req.method === "PUT" && segmentMatch) {
    const body = await bodyJson(req);
    const segment = project.segments.find((item) => item.id === segmentMatch[1]);
    if (!segment) return json(res, 404, { error: "Segment not found" });
    if (typeof body.ttsText === "string") {
      const prepared = prepareSegmentTextInput(body.ttsText);
      segment.text = prepared.displayText;
      segment.ttsText = prepared.ttsText;
    } else if (typeof body.text === "string") {
      const prepared = prepareSegmentTextInput(body.text);
      segment.text = prepared.displayText;
      segment.ttsText = prepared.ttsText;
    }
    if (typeof body.status === "string") segment.status = body.status;
    if (typeof body.notes === "string") segment.notes = body.notes;
    if (typeof body.visualDescription === "string") {
      segment.visualDescription = body.visualDescription.trim();
    }
    if (Array.isArray(body.entities)) {
      const entityIds = new Set(visualBibleEntityMap(project.visualBible).keys());
      segment.entities = normalizeSegmentEntities(body.entities, entityIds);
    }
    segment.updatedAt = now();
    project.updatedAt = now();
    await saveProject(project);
    return json(res, 200, { segment });
  }

  if (req.method === "POST" && tail === "tts/batch") {
    let job;
    try {
      job = createProjectJob(projectId, "Generate full voiceover", "audio", async (log, signal, currentJob) => {
        currentJob.meta.total = 1;
        currentJob.meta.generated = 0;
        currentJob.meta.currentSegment = "voiceover";
        const result = await generateVoiceoverAudio(projectId, log, signal);
        currentJob.meta.generated = 1;
        currentJob.meta.currentSegment = null;
        return result;
      }, { total: 1, generated: 0, currentSegment: "voiceover" });
    } catch (error) {
      if (error.activeJob) return json(res, 409, { error: error.message, job: publicJob(error.activeJob) });
      throw error;
    }
    return json(res, 202, { job: publicJob(job) });
  }

  return json(res, 404, { error: "Not found" });
}

async function serveProjectAsset(req, res, url) {
  const match = url.pathname.match(/^\/projects\/([^/]+)\/(.+)$/);
  if (!match) return false;
  const target = projectPath(decodeURIComponent(match[1]), ...match[2].split("/").map(decodeURIComponent));
  if (!(await exists(target))) {
    text(res, 404, "Not found");
    return true;
  }
  await serveFile(req, res, target);
  return true;
}

async function serveFile(req, res, file) {
  const stat = await fs.promises.stat(file);
  const ext = path.extname(file);
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const range = req.headers.range;
  const baseHeaders = {
    "accept-ranges": "bytes",
    "content-type": contentType,
  };

  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.writeHead(416, { ...baseHeaders, "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;

    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      start = Math.max(0, stat.size - suffixLength);
      end = stat.size - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
      res.writeHead(416, { ...baseHeaders, "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }

    end = Math.min(end, stat.size - 1);
    const contentLength = end - start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      "content-length": contentLength,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, "content-length": stat.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

async function serveStatic(req, res, url) {
  let file = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  file = path.join(PUBLIC_DIR, file);
  if (!file.startsWith(PUBLIC_DIR)) return text(res, 403, "Forbidden");
  if (!(await exists(file))) {
    const fallback = path.join(PUBLIC_DIR, "index.html");
    if (await exists(fallback)) file = fallback;
    else return text(res, 404, "Not found");
  }
  await serveFile(req, res, file);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/jobs" && req.method === "GET") {
      return json(res, 200, { jobs: Array.from(jobs.values()).map(publicJob) });
    }
    if (url.pathname.startsWith("/api/jobs/") && req.method === "GET") {
      const job = jobs.get(url.pathname.split("/").pop());
      return job ? json(res, 200, { job: publicJob(job) }) : json(res, 404, { error: "Job not found" });
    }
    if (url.pathname.startsWith("/api/jobs/") && req.method === "POST" && url.pathname.endsWith("/cancel")) {
      const jobId = url.pathname.split("/").at(-2);
      const job = jobs.get(jobId);
      if (!job) return json(res, 404, { error: "Job not found" });
      if (job.status !== "running") return json(res, 200, { job: publicJob(job) });
      job.status = "cancelling";
      job.updatedAt = now();
      job.logs.push("Cancelling job...");
      job.controller.abort();
      return json(res, 200, { job: publicJob(job) });
    }
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled === false) return json(res, 404, { error: "Not found" });
      return;
    }
    if (await serveProjectAsset(req, res, url)) return;
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: error.message });
    else res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`VideoFlow workbench: http://127.0.0.1:${PORT}`);
});
