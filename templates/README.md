# Templates

本目录存放 VideoFlow 的分镜图风格模板。

每个新风格使用一个目录：

```text
templates/<style-id>/
  template.json
  image-style.md
```

## template.json

`template.json` 是风格元数据，会被 `/api/templates` 返回，并显示在新建项目弹窗里。

常用字段：

- `id`：风格 ID，必须和目录名一致。
- `name`：界面显示名称。
- `description`：界面显示描述。
- `category`：建议使用 `illustration`。
- `aspectRatios`：支持的视频比例，例如 `["9:16", "16:9", "1:1", "4:5"]`。
- `preview.kind`：前端预览缩略图类型，目前支持 `stickman`。
- `imageStyle.promptFile`：生图风格提示词文件，默认 `image-style.md`。
- `imageStyle.background / ink / muted / accent / secondary / surface`：前端预览和 fallback 颜色。

## image-style.md

`image-style.md` 是发送给图片模型的风格 DNA。分镜生成时，后端会把它和当前场景的主题、核心意思、结构类型、建议中文标注一起合成最终 prompt。

新增风格时，只要写清楚：

- 背景、线条、颜色、留白
- 角色或视觉主体
- 适合表达的动作和结构
- 禁止出现的画风、元素和文字

## 当前风格

- `stickman`：火柴人极简解释图。
