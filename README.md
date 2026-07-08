# VideoFlow

VideoFlow 是一个本地运行的 AI 视频生产工作台。它可以把已经写好的中文旁白整理成分段脚本，生成分镜图、完整旁白音频、字幕时间轴，并最终渲染成 MP4。

应用完全在本机运行。API Key 只保存在 `app-config.local.json`，该文件已被 `.gitignore` 忽略，不会提交到仓库。

## 功能

- 新建项目，并选择 `9:16`、`16:9`、`1:1`、`4:5` 视频比例。
- 使用 OpenAI-compatible 大模型清洗中文旁白并拆分成适合配音和配图的段落。
- 为每个 segment 生成一张分镜图。
- 使用 MiniMax 一次生成完整旁白音频、字幕和 segment 时间轴。
- 预览分镜图、旁白音频和最终视频。
- 使用 FFmpeg 合成图片、旁白、字幕和可选 BGM，导出 MP4。
- 通过 `templates/<template-id>/` 添加可复用的视觉模板。

## 环境要求

- Node.js 20 或更高版本
- npm
- `PATH` 中可用的 FFmpeg 和 FFprobe
- 用于脚本整理和图片生成的 OpenAI-compatible API Key
- 用于旁白生成的 MiniMax API Key 和 voice ID

如果 FFmpeg 不在 `PATH` 中，可以通过环境变量指定：

```bash
export FFMPEG_PATH=/absolute/path/to/ffmpeg
export FFPROBE_PATH=/absolute/path/to/ffprobe
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

## 配置

`app-config.local.json` 不会提交到 git。首次使用可以复制 `app-config.example.json` 作为模板。

主要字段：

- `baseUrl`：OpenAI-compatible API 地址，例如 `https://api.openai.com/v1`。
- `model`：用于整理脚本的对话模型。
- `apiKey`：用于脚本整理和图片生成的 API Key。
- `image.model`：图片生成模型。
- `audio.minimaxApiKey`：MiniMax API Key。
- `audio.minimaxGroupId`：可选的 MiniMax Group ID。
- `audio.minimaxVoiceId`：MiniMax voice ID。

## 使用流程

1. 新建项目，选择视频比例和视觉模板。
2. 在“内容”页粘贴已经写好的完整旁白。
3. 点击开始整理，让模型清洗文本并拆分 segment。
4. 生成分镜图。
5. 生成完整旁白。
6. 渲染最终 MP4。

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
  renders/final.mp4
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

## 许可证

MIT
