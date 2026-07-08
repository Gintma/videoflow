# VideoFlow
https://github.com/user-attachments/assets/a8cfef1f-784a-48f8-856d-9cdee878d91f

VideoFlow 是一个本地运行的 AI 视频生产工作台，用来把一段已经写好的中文旁白，自动整理成可生产的视频项目：大模型整理脚本，ChatGPT Image / OpenAI-compatible 图片模型生成分镜图，MiniMax 生成完整旁白音频和字幕时间轴，最后用 FFmpeg 合成为 MP4。

它适合制作讲书、知识解释、口播配图、白板解释、短视频分镜等内容。应用本身只在本机运行，API Key 只保存在 `app-config.local.json`，该文件已被 `.gitignore` 忽略，不会提交到仓库。

## 它做什么

VideoFlow 的核心思路是把“视频生产”拆成几个稳定步骤：

1. 输入已经写好的旁白文本。
2. 使用 OpenAI-compatible 对话模型清洗文本、拆分 segment、生成每段画面描述。
3. 使用图片模型为每个 segment 生成一张分镜图。默认配置面向 ChatGPT Image / `gpt-image-2`，也可以替换成兼容接口支持的图片模型。
4. 使用 MiniMax TTS 一次性生成完整旁白音频，而不是每段单独拼接。
5. 使用 MiniMax 返回的字幕或本地兜底逻辑生成 `captions.vtt`、`timings.json` 和渲染时间轴。
6. 使用 FFmpeg 把分镜图、旁白、字幕和可选 BGM 合成为最终 MP4。

## 功能

- 项目管理：每条视频一个独立项目目录，方便回看、修改和复渲染。
- 多比例视频：支持 `9:16`、`16:9`、`1:1`、`4:5`。
- 脚本整理：保留原始旁白表达，清理多余格式，并拆成适合配音和配图的 segment。
- 分镜规划：为每段生成视觉描述，并维护跨分镜一致的 visual bible。
- AI 生图：按 segment 生成分镜图，单张失败或不满意时可以单独重新生成。
- 完整旁白：使用 MiniMax 一次生成完整 `voiceover.wav`，同时得到字幕和时间轴。
- 音频预览：生成后可在页面内试听完整旁白。
- 视频渲染：使用 FFmpeg 合成图片、旁白、字幕和可选 BGM，输出 `renders/final.mp4`。
- 模板系统：通过 `templates/<template-id>/` 添加不同的视觉风格。
- 本地配置：API Key、模型和 FFmpeg 路径都保存在本机配置文件中。

## 技术流程

```text
旁白文本
  ↓
OpenAI-compatible 对话模型
  - 清理旁白
  - 拆分 segment
  - 生成 visual description
  - 生成 visual bible
  ↓
ChatGPT Image / gpt-image-2
  - 每个 segment 生成一张分镜图
  ↓
MiniMax TTS
  - 生成完整 voiceover.wav
  - 生成字幕/时间轴
  ↓
FFmpeg
  - 图片 + 旁白 + 字幕 + BGM
  - 导出 final.mp4
```

## 环境要求

- Node.js 20 或更高版本
- npm
- `PATH` 中可用的 FFmpeg 和 FFprobe
- 用于脚本整理和图片生成的 OpenAI-compatible API Key
- 用于旁白生成的 MiniMax API Key 和 voice ID

如果要在最终视频里烧录字幕，FFmpeg 必须支持 `subtitles` 滤镜，通常需要启用 `libass`。可以这样检查：

```bash
ffmpeg -hide_banner -filters | grep subtitles
```

如果 FFmpeg 不在 `PATH` 中，或者你有多个 FFmpeg 版本，可以通过环境变量指定：

```bash
export FFMPEG_PATH=/absolute/path/to/ffmpeg
export FFPROBE_PATH=/absolute/path/to/ffprobe
```

也可以写入本地配置文件 `app-config.local.json`：

```json
{
  "ffmpegPath": "/absolute/path/to/ffmpeg",
  "ffprobePath": "/absolute/path/to/ffprobe"
}
```

## 快速开始

```bash
npm install
cp app-config.example.json app-config.local.json
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

你也可以直接在应用里的“模型设置”弹窗中配置模型。保存后的配置会写入本机的 `app-config.local.json`。

## 模型配置

`app-config.local.json` 不会提交到 git。首次使用可以复制 `app-config.example.json` 作为模板。

主要字段：

- `baseUrl`：OpenAI-compatible API 地址，例如 `https://api.openai.com/v1`。
- `model`：用于整理脚本的对话模型。
- `apiKey`：用于脚本整理和图片生成的 API Key。
- `ffmpegPath`：可选，指定 FFmpeg 路径。
- `ffprobePath`：可选，指定 FFprobe 路径。
- `image.model`：图片生成模型，默认示例为 `gpt-image-2`。
- `image.quality`：图片质量，默认 `medium`。
- `image.outputFormat`：图片格式，默认 `png`。
- `audio.minimaxApiKey`：MiniMax API Key。
- `audio.minimaxGroupId`：可选的 MiniMax Group ID。
- `audio.minimaxModel`：MiniMax TTS 模型。
- `audio.minimaxVoiceId`：MiniMax voice ID。
- `audio.minimaxSpeed`：语速。
- `audio.minimaxVolume`：音量。
- `audio.minimaxPitch`：音调。

## 使用流程

1. 新建项目，选择视频比例和视觉模板。
2. 在“内容”页粘贴已经写好的完整旁白。
3. 点击开始整理，让大模型清洗文本并拆分 segment。
4. 在“脚本”页检查每段旁白和画面描述。
5. 在“画面”页生成分镜图。每张图都可以单独重新生成。
6. 在“音频”页生成完整旁白。MiniMax 会返回完整音频和字幕时间轴。
7. 在“视频”页选择是否烧录字幕、是否混入 BGM、播放速度等设置。
8. 点击渲染最终视频，得到 `renders/final.mp4`。

## 输出目录

生成文件会写入：

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
  captions-timeline.json
  minimax-subtitles.json
  renders/
    captions.ass
    silent.mp4
    final.mp4
```

`projects/` 目录默认被 git 忽略，只保留说明文件和占位文件。

## 视觉模板

视觉模板位于：

```text
templates/<template-id>/
  template.json
  image-style.md
```

当前内置模板：

- `stickman`：极简白板中文解释图风格。

模板元数据和提示词编写方式见 `templates/README.md`。

## BGM 和字体

应用会在开启 BGM 时读取 `assets/bgm.mp3`。发布或分发成片前，请确认你有权使用该音频。

字幕渲染可以使用 `assets/fonts/` 中的可选字体文件。不要提交没有再分发授权的系统字体或商业字体。

## 常用脚本

```bash
npm run dev          # 构建前端并启动本地服务
npm run start        # 使用已有前端构建产物启动服务
npm run check        # 检查前端类型和后端语法
npm run client:dev   # 启动前端 Vite 开发服务
npm run client:build # 构建前端
```

发布 fork 或提交修改前，建议阅读 `CONTRIBUTING.md` 和 `SECURITY.md`。

## 健康检查

启动服务后可以检查运行环境：

```bash
curl http://127.0.0.1:5173/api/health
```

该接口会返回 FFmpeg、FFprobe、MiniMax 配置和 BGM 是否可用。

## 常见问题

### 渲染视频时报 `No such filter: 'subtitles'`

说明当前 FFmpeg 不支持 `subtitles` 滤镜。要么换成启用了 `libass` 的 FFmpeg，要么在视频页关闭“开启字幕”后重新渲染。

### 生成了音频但页面没出现

先刷新页面。如果项目目录中已经有 `voiceover.wav`，但页面仍不显示，通常是前端没有拿到最新项目状态。

### 可以只用自己的图片或音频吗？

当前工作流默认由模型生成分镜图和完整旁白。你可以直接替换项目目录中的产物，但要保证 `storyboards.json`、`timings.json`、`voiceover.wav` 等文件仍然匹配。

## 许可证

MIT
