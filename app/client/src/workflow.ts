import type { Project, Settings } from "./types";

type WorkflowAction = (...args: never[]) => void | Promise<unknown>;

export function getWorkflow(
  project: Project | null,
  settings: Settings | null,
  source: string,
  actions: Record<string, WorkflowAction>,
) {
  if (!project) return { step: "content", title: "选择项目", description: "先从项目列表打开一个项目。", action: "新建项目", run: actions.create, disabled: false };
  if (!settings?.hasApiKey) return { step: "content", title: "配置大模型", description: "保存模型配置后再整理内容。", action: "模型设置", run: actions.openSettings, disabled: false };
  if (!source.trim()) return { step: "content", title: "粘贴视频旁白", description: "粘贴已经写好的完整视频旁白。", action: "开始整理", run: actions.generateScript, disabled: true };
  if (!project.script || !project.segments?.length) return { step: "content", title: "整理旁白分段", description: "清洗旁白、拆分 segment，并补充每段画面描述。", action: "开始整理", run: actions.generateScript, disabled: false };
  const missingStoryboards = !project.storyboards?.length || (project.storyboards?.length || 0) < (project.segments?.length || 0);
  if (!project.renderPlan || missingStoryboards || !project.voiceover) {
    return {
      step: "visual",
      title: "生成画面和音频",
      description: "确认脚本后，分镜图和旁白音频可以同时生成。",
      action: "并行生成画面和音频",
      run: actions.generateMediaParallel,
      disabled: false,
    };
  }
  if (!project.finalVideo) return { step: "video", title: "渲染最终视频", description: "渲染画面并混入旁白和 BGM。", action: "渲染最终视频", run: actions.renderVideo, disabled: false };
  return { step: "video", title: "视频已完成", description: "成片已导出，可在视频页检查结果。", action: "打开结果", run: actions.openFinal, disabled: false };
}
