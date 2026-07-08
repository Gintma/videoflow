import React from "react";
import { createRoot } from "react-dom/client";
import Plyr from "plyr";
import WaveSurfer from "wavesurfer.js";
import { AlertTriangle, ArrowLeft, CheckCircle2, Circle, Info, Loader2, PauseCircle, Play, RefreshCw, Settings as SettingsIcon, Trash2, Wand2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "./api";
import { getWorkflow } from "./workflow";
import { formatDate, formatDuration, formatTime, hasActiveBlockingJob, isJobActive, jobKey, projectJob, routeProjectId, segmentVisualDescription, statusLabel, templateName } from "./utils";
import type { AudioSettings, ImageSettings, Job, Project, ScenePlan, Segment, Settings, StepId, Storyboard, VideoSettings, VideoTemplate, View } from "./types";
import "plyr/dist/plyr.css";
import "./styles.css";

const aspectRatios = [
  { value: "9:16", label: "9:16", detail: "竖屏短视频" },
  { value: "16:9", label: "16:9", detail: "横屏视频" },
  { value: "1:1", label: "1:1", detail: "方形信息流" },
  { value: "4:5", label: "4:5", detail: "竖版封面友好" },
];

function projectApiPath(projectId: string, tail = "") {
  return `/api/projects/${encodeURIComponent(projectId)}${tail}`;
}

function projectAssetPath(projectId: string, assetPath: string) {
  return `/projects/${encodeURIComponent(projectId)}/${assetPath.split("/").map(encodeURIComponent).join("/")}`;
}

type ToastLevel = "success" | "error" | "info";
type ToastMessage = {
  id: number;
  text: string;
  level: ToastLevel;
};

function App() {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [project, setProject] = React.useState<Project | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [templates, setTemplates] = React.useState<VideoTemplate[]>([]);
  const [view, setView] = React.useState<View>(() => {
    const projectId = routeProjectId();
    return projectId ? { name: "project", projectId } : { name: "home" };
  });
  const [source, setSource] = React.useState("");
  const [jobsByKey, setJobsByKey] = React.useState<Record<string, Job>>({});
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const toastTimers = React.useRef<number[]>([]);
  const lastToastRef = React.useRef<{ text: string; at: number } | null>(null);
  const [activeStep, setActiveStep] = React.useState<StepId>("content");
  const userSelectedStep = React.useRef(false);

  const dismissToast = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = React.useCallback((text: string, level: ToastLevel = "info") => {
    const lastToast = lastToastRef.current;
    const timestamp = Date.now();
    if (lastToast?.text === text && timestamp - lastToast.at < 5000) return;
    lastToastRef.current = { text, at: timestamp };
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current.slice(-2), { id, text, level }]);
    const timeout = window.setTimeout(() => dismissToast(id), level === "error" ? 6000 : 3600);
    toastTimers.current.push(timeout);
  }, [dismissToast]);

  React.useEffect(() => {
    return () => {
      toastTimers.current.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, []);

  const loadProjects = React.useCallback(async () => {
    const payload = await api<{ projects: Project[] }>("/api/projects");
    setProjects(payload.projects);
    return payload.projects;
  }, []);

  const loadProject = React.useCallback(async (id: string) => {
    const payload = await api<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
    if (routeProjectId() !== id) return;
    setProject(payload.project);
    setSource(payload.project.source || "");
  }, []);

  const loadSettings = React.useCallback(async () => {
    const payload = await api<{ settings: Settings }>("/api/settings");
    setSettings(payload.settings);
  }, []);

  const loadTemplates = React.useCallback(async () => {
    const payload = await api<{ templates: VideoTemplate[] }>("/api/templates");
    setTemplates(payload.templates);
    return payload.templates;
  }, []);

  React.useEffect(() => {
    Promise.all([loadSettings(), loadProjects(), loadTemplates()]).catch((error) => notify(error.message, "error"));
  }, [loadProjects, loadSettings, loadTemplates, notify]);

  React.useEffect(() => {
    const onHashChange = () => {
      const projectId = routeProjectId();
      setView(projectId ? { name: "project", projectId } : { name: "home" });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  React.useEffect(() => {
    if (view.name === "project") {
      loadProject(view.projectId).catch((error) => {
        notify(error.message, "error");
        setProject(null);
      });
      return;
    }
    setProject(null);
    setSource("");
  }, [loadProject, view]);

  React.useEffect(() => {
    async function syncServerJobs() {
      const payload = await api<{ jobs: Job[] }>("/api/jobs").catch(() => null);
      if (!payload?.jobs) return;
      let shouldReloadProject = false;
      setJobsByKey((current) => {
        const next = { ...current };
        for (const job of payload.jobs) {
          const previous = current[jobKey(job)];
          if (
            project
            && job.projectId === project.id
            && previous
            && isJobActive(previous)
            && ["done", "failed", "cancelled"].includes(job.status)
          ) {
            shouldReloadProject = true;
          }
          next[jobKey(job)] = job;
        }
        return next;
      });
      if (project && shouldReloadProject) {
        await loadProject(project.id).catch((error) => notify(error.message, "error"));
      }
    }
    syncServerJobs();
    const timer = window.setInterval(syncServerJobs, 1500);
    return () => window.clearInterval(timer);
  }, [loadProject, project]);

  React.useEffect(() => {
    const activeJobs = Object.values(jobsByKey).filter(isJobActive);
    if (!activeJobs.length) return;
    const timer = window.setInterval(async () => {
      const payloads = await Promise.all(activeJobs.map((item) => api<{ job: Job }>(`/api/jobs/${item.id}`).catch(() => null)));
      let shouldReloadProject = false;
      setJobsByKey((current) => {
        const next = { ...current };
        for (const payload of payloads) {
          if (!payload?.job) continue;
          next[jobKey(payload.job)] = payload.job;
          if (project && payload.job.projectId === project.id && ["done", "failed", "cancelled"].includes(payload.job.status)) {
            shouldReloadProject = true;
          }
        }
        return next;
      });
      if (project && shouldReloadProject) await loadProject(project.id).catch((error) => notify(error.message, "error"));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [jobsByKey, loadProject, project]);

  async function refreshAll() {
    const list = await loadProjects();
    if (project) await loadProject(project.id);
    else if (view.name === "project") await loadProject(view.projectId);
    return list;
  }

  async function createProject(input: { name: string; aspectRatio: string; templateId: string }) {
    const payload = await api<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify(input) });
    await loadProjects();
    openProject(payload.project.id);
  }

  async function saveSettings(input: {
    baseUrl: string;
    model: string;
    apiKey: string;
    temperature: number;
    image?: ImageSettings;
    audio?: AudioSettings;
  }) {
    try {
      const payload = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(input) });
      setSettings(payload.settings);
      notify("配置已保存", "success");
    } catch (error) {
      notify(`保存配置失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  async function testSettings(input: {
    baseUrl: string;
    model: string;
    apiKey: string;
    temperature: number;
    image?: ImageSettings;
    audio?: AudioSettings;
  }) {
    try {
      const payload = await api<{ content: { message?: string } }>("/api/settings/test", {
        method: "POST",
        body: JSON.stringify(input),
      });
      notify(payload.content?.message || "脚本模型连接正常", "success");
      await loadSettings();
    } catch (error) {
      notify(`脚本模型验证失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  async function testAudioSettings(audio: AudioSettings) {
    try {
      await api<{ ok: boolean; message?: string }>("/api/settings/audio-test", {
        method: "POST",
        body: JSON.stringify({ audio }),
      });
      notify("音频模型验证通过", "success");
      await loadSettings();
    } catch (error) {
      notify(`音频模型验证失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  async function saveScriptPrompt(input: { scriptSystemPrompt: string; scriptUserPrompt: string }) {
    if (!settings) return;
    const payload = await api<{ settings: Settings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: "",
        temperature: settings.temperature,
        ...input,
      }),
    });
    setSettings(payload.settings);
    notify("脚本提示词已保存", "success");
  }

  async function saveSource() {
    if (!project) return;
    await api(projectApiPath(project.id, "/source"), { method: "PUT", body: JSON.stringify({ source }) });
    await loadProject(project.id);
  }

  async function startJob(request: Promise<{ job: Job }>, allowedParallelTypes: string[] = []) {
    if (hasActiveBlockingJob(jobsByKey, allowedParallelTypes)) {
      notify("当前项目已有不能并行的任务在运行，请先停止或等待完成。", "error");
      return;
    }
    const payload = await request;
    setJobsByKey((current) => ({ ...current, [jobKey(payload.job)]: payload.job }));
    return payload.job;
  }

  async function generateScript() {
    if (!project) return;
    await api(projectApiPath(project.id, "/source"), { method: "PUT", body: JSON.stringify({ source }) });
    await startJob(api(projectApiPath(project.id, "/script/generate-llm"), {
      method: "POST",
      body: JSON.stringify({}),
    }));
    userSelectedStep.current = true;
    setActiveStep("script");
  }

  async function generateMissingAudio() {
    if (!project) return;
    const startedJob = await startJob(api(projectApiPath(project.id, "/tts/batch"), { method: "POST", body: JSON.stringify({}) }), ["audio", "storyboards"]);
    if (!startedJob) return;
    userSelectedStep.current = true;
    setActiveStep("audio");
    await loadProject(project.id);
  }

  async function cancelJob(job?: Job | null) {
    const target = job || Object.values(jobsByKey).find(isJobActive);
    if (!target) throw new Error("No active job to cancel");
    const payload = await api<{ job: Job }>(`/api/jobs/${target.id}/cancel`, { method: "POST" });
    setJobsByKey((current) => ({ ...current, [jobKey(payload.job)]: payload.job }));
  }

  async function updateSegment(segment: Segment, patch: Partial<Segment>) {
    if (!project) return;
    await api(projectApiPath(project.id, `/segments/${encodeURIComponent(segment.id)}`), {
      method: "PUT",
      body: JSON.stringify({
        text: segment.text,
        ttsText: segment.ttsText,
        visualDescription: segmentVisualDescription(segment),
        entities: segment.entities || [],
        ...patch,
      }),
    });
    await loadProject(project.id);
  }

  async function generateCompositions() {
    if (!project) return;
    await api(projectApiPath(project.id, "/render-plan"), { method: "POST" });
    await startJob(api(projectApiPath(project.id, "/storyboards/generate"), { method: "POST" }), ["audio", "storyboards"]);
    notify("已开始生成分镜图", "info");
  }

  async function generateMediaParallel() {
    if (!project) return;
    await api(projectApiPath(project.id, "/render-plan"), { method: "POST" });
    const [storyboardResult, audioResult] = await Promise.allSettled([
      api<{ job: Job }>(projectApiPath(project.id, "/storyboards/generate"), { method: "POST" }),
      api<{ job: Job }>(projectApiPath(project.id, "/tts/batch"), { method: "POST", body: JSON.stringify({}) }),
    ]);
    setJobsByKey((current) => {
      const next = { ...current };
      for (const result of [storyboardResult, audioResult]) {
        if (result.status === "fulfilled") next[jobKey(result.value.job)] = result.value.job;
      }
      return next;
    });
    const failed = [storyboardResult, audioResult].filter((result) => result.status === "rejected");
    notify(failed.length ? "部分任务未启动，请查看当前任务状态。" : "已同时开始生成分镜图和音频", failed.length ? "error" : "info");
    await loadProject(project.id);
  }

  async function saveScene(scene: ScenePlan, patch: Partial<ScenePlan>) {
    if (!project) return;
    await api(projectApiPath(project.id, `/render-plan/scenes/${encodeURIComponent(scene.id)}`), {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    await loadProject(project.id);
    notify("画面内容已保存", "success");
  }

  async function listStoryboards() {
    if (!project) return { storyboards: [] as Storyboard[] };
    return api<{ storyboards: Storyboard[] }>(projectApiPath(project.id, "/storyboards"));
  }

  async function regenerateStoryboard(file: string) {
    if (!project) return;
    try {
      await startJob(api(projectApiPath(project.id, `/storyboards/${encodeURIComponent(file)}/regenerate`), { method: "POST" }), ["audio", "storyboards"]);
      notify("已开始重生成分镜图", "info");
    } catch (error) {
      notify(`重生成分镜失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  }

  async function renderVideo() {
    if (!project) return;
    await startJob(api(projectApiPath(project.id, "/video/render"), { method: "POST" }));
    notify("已开始渲染视频", "info");
  }

  async function saveVideoSettings(videoSettings: VideoSettings) {
    if (!project) return;
    await api<{ project: Project }>(projectApiPath(project.id, "/video-settings"), {
      method: "PUT",
      body: JSON.stringify({ videoSettings }),
    });
    await loadProject(project.id);
    notify("视频设置已保存，将在下一次渲染时生效", "success");
  }

  async function deleteProject() {
    if (!project) return;
    const confirmed = window.confirm(`删除项目「${project.name}」？\n这会移除项目文件，不能撤销。`);
    if (!confirmed) return;
    await api(`/api/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmDelete: true }),
    });
    setProject(null);
    setSource("");
    await loadProjects();
    openHome();
  }

  async function deleteProjectById(target: Project) {
    const confirmed = window.confirm(`删除项目「${target.name}」？\n这会移除项目文件，不能撤销。`);
    if (!confirmed) return;
    await api(`/api/projects/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmDelete: true }),
    });
    if (project?.id === target.id) {
      setProject(null);
      setSource("");
      openHome();
    }
    await loadProjects();
  }

  function openProject(id: string) {
    window.location.hash = `/projects/${encodeURIComponent(id)}`;
  }

  function openHome() {
    window.location.hash = "";
    setView({ name: "home" });
  }

  const workflow = getWorkflow(project, settings, source, {
    create: () => document.getElementById("new-project-trigger")?.click(),
    openSettings: () => document.getElementById("settings-trigger")?.click(),
    test: () => document.getElementById("test-settings-trigger")?.click(),
    saveSource,
    generateScript,
    generateMediaParallel,
    generateMissingAudio,
    generateCompositions,
    saveScene,
    listStoryboards,
    regenerateStoryboard,
    renderVideo,
    saveVideoSettings,
    openFinal: () => {
      if (project?.finalVideo) window.open(projectAssetPath(project.id, project.finalVideo), "_blank");
    },
  });

  const activeJobs = Object.values(jobsByKey).filter(isJobActive);
  const primaryJob = activeJobs.find((item) => item.projectId === project?.id) || Object.values(jobsByKey).find((item) => item.projectId === project?.id) || null;
  const visualJob = projectJob(jobsByKey, project?.id, "storyboards");
  const audioJob = projectJob(jobsByKey, project?.id, "audio");
  const renderJob = projectJob(jobsByKey, project?.id, "render");
  const jobActive = hasActiveBlockingJob(jobsByKey, ["audio", "storyboards"]);

  React.useEffect(() => {
    userSelectedStep.current = false;
    setActiveStep(workflow.step as StepId);
  }, [project?.id]);

  React.useEffect(() => {
    if (userSelectedStep.current || jobActive) return;
    setActiveStep(workflow.step as StepId);
  }, [workflow.step, jobActive]);

  function selectStep(step: StepId) {
    userSelectedStep.current = true;
    setActiveStep(step);
  }

  const appActions = {
    refreshAll,
    createProject,
    saveSettings,
    testSettings,
    testAudioSettings,
    saveSource,
    saveScriptPrompt,
    generateScript,
    generateMediaParallel,
    generateMissingAudio,
    saveSegmentDraft: (segment: Segment, patch: { text: string; visualDescription: string }) => updateSegment(segment, patch),
    updateSegment,
    generateCompositions,
    saveScene,
    renderVideo,
    saveVideoSettings,
    listStoryboards,
    regenerateStoryboard,
    deleteProject,
    cancelJob,
    openProject,
    openHome,
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      {view.name === "home" ? (
        <HomePage
          projects={projects}
          settings={settings}
          templates={templates}
          onOpenProject={openProject}
          onDeleteProject={deleteProjectById}
          onRefresh={refreshAll}
          onCreate={createProject}
          onSaveSettings={saveSettings}
          onTestSettings={testSettings}
          onTestAudioSettings={testAudioSettings}
        />
      ) : (
        <ProjectWorkspace
          project={project}
          settings={settings}
          templates={templates}
          source={source}
          setSource={setSource}
          activeStep={activeStep}
          setActiveStep={selectStep}
          workflow={workflow}
          job={primaryJob}
          visualJob={visualJob}
          audioJob={audioJob}
          renderJob={renderJob}
          activeJobs={activeJobs}
          jobActive={jobActive}
          actions={appActions}
        />
      )}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function ToastViewport({ toasts, onDismiss }: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="fixed right-5 top-5 z-[80] grid w-[min(420px,calc(100vw-2.5rem))] gap-3">
      {toasts.map((toast) => {
        const tone = toast.level === "error"
          ? "border-red-200 bg-red-50 text-red-950"
          : toast.level === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-950"
            : "border-zinc-800 bg-zinc-950 text-white";
        const iconTone = toast.level === "error" ? "text-red-600" : toast.level === "success" ? "text-emerald-600" : "text-zinc-200";
        const Icon = toast.level === "error" ? AlertTriangle : toast.level === "success" ? CheckCircle2 : Info;
        return (
          <div key={toast.id} className={`toast-enter flex items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl ${tone}`} role={toast.level === "error" ? "alert" : "status"}>
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} />
            <div className="min-w-0 flex-1 text-sm font-medium leading-6">{toast.text}</div>
            <button
              type="button"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md opacity-70 transition hover:bg-black/10 hover:opacity-100"
              onClick={() => onDismiss(toast.id)}
              aria-label="关闭提示"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowBar({ workflow }: { workflow: ReturnType<typeof getWorkflow> }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 pt-5 max-md:flex-col max-md:items-stretch">
        <div>
          <div className="text-xs uppercase text-zinc-500">当前步骤</div>
          <div className="mt-1 text-xl font-semibold">{workflow.title}</div>
          <p className="mt-1 text-sm text-zinc-500">{workflow.description}</p>
        </div>
        <Button disabled={workflow.disabled} onClick={() => workflow.run?.()} className="min-w-44">
          <Wand2 className="h-4 w-4" />
          {workflow.action}
        </Button>
      </CardContent>
    </Card>
  );
}

function HomePage({
  projects,
  settings,
  templates,
  onOpenProject,
  onDeleteProject,
  onRefresh,
  onCreate,
  onSaveSettings,
  onTestSettings,
  onTestAudioSettings,
}: {
  projects: Project[];
  settings: Settings | null;
  templates: VideoTemplate[];
  onOpenProject: (id: string) => void;
  onDeleteProject: (project: Project) => Promise<void>;
  onRefresh: () => Promise<Project[]>;
  onCreate: (input: { name: string; aspectRatio: string; templateId: string }) => Promise<void>;
  onSaveSettings: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; audio?: AudioSettings }) => Promise<void>;
  onTestSettings: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; audio?: AudioSettings }) => Promise<void>;
  onTestAudioSettings: (audio: AudioSettings) => Promise<void>;
}) {
  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-md bg-zinc-950 font-bold text-white">VF</div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">VideoFlow</h1>
            <p className="text-sm text-zinc-500">本地 AI 视频生产工作台</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SettingsDialog settings={settings} onSave={onSaveSettings} onTest={onTestSettings} onTestAudio={onTestAudioSettings} />
          <CreateProjectDialog templates={templates} onCreate={onCreate} />
        </div>
      </header>

      <Card className="mt-5">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>项目列表</CardTitle>
            <CardDescription>选择一个项目进入工作台，或创建新视频项目。</CardDescription>
          </div>
          <Button variant="outline" onClick={() => onRefresh()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </CardHeader>
        <CardContent>
          {projects.length ? (
            <div className="overflow-x-auto rounded-lg border border-zinc-200">
              <table className="w-full min-w-[880px] border-collapse text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">项目</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">比例</th>
                    <th className="px-4 py-3 font-medium">模板</th>
                    <th className="px-4 py-3 font-medium">音频进度</th>
                    <th className="px-4 py-3 font-medium">更新时间</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white">
                  {projects.map((item) => {
                    const total = item.segmentCount ?? item.segments?.length ?? 0;
                    const generated = item.voiceover ? total : item.approvedSegmentCount ?? 0;
                    return (
                      <tr key={item.id} className="transition-colors hover:bg-zinc-50">
                        <td className="px-4 py-4">
                          <button className="cursor-pointer text-left font-medium underline-offset-4 hover:underline" onClick={() => onOpenProject(item.id)}>
                            {item.name}
                          </button>
                          <div className="mt-1 font-mono text-xs text-zinc-500">{item.id}</div>
                        </td>
                        <td className="px-4 py-4">
                          <Badge variant={item.status === "video_ready" ? "default" : item.status === "audio_review" ? "warning" : "secondary"}>
                            {statusLabel(item.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 text-zinc-600">{item.aspectRatio || "9:16"}</td>
                        <td className="px-4 py-4 text-zinc-600">{templateName(item.templateId)}</td>
                        <td className="px-4 py-4 text-zinc-600">{total ? `${generated}/${total} 已生成` : "未分段"}</td>
                        <td className="px-4 py-4 text-zinc-600">{formatDate(item.updatedAt)}</td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={() => onOpenProject(item.id)}>打开</Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteProject(item);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-zinc-200">
              <div className="text-center">
                <div className="text-lg font-medium">还没有项目</div>
                <p className="mt-2 text-sm text-zinc-500">先创建一个视频项目，再进入工作台处理内容、画面、音频和视频。</p>
                <div className="mt-4">
                  <CreateProjectDialog templates={templates} onCreate={onCreate} />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function ProjectWorkspace({
  project,
  settings,
  templates,
  source,
  setSource,
  activeStep,
  setActiveStep,
  workflow,
  job,
  visualJob,
  audioJob,
  renderJob,
  activeJobs,
  jobActive,
  actions,
}: {
  project: Project | null;
  settings: Settings | null;
  templates: VideoTemplate[];
  source: string;
  setSource: (value: string) => void;
  activeStep: StepId;
  setActiveStep: (step: StepId) => void;
  workflow: ReturnType<typeof getWorkflow>;
  job: Job | null;
  visualJob: Job | null;
  audioJob: Job | null;
  renderJob: Job | null;
  activeJobs: Job[];
  jobActive: boolean;
  actions: {
    refreshAll: () => Promise<Project[]>;
    createProject: (input: { name: string; aspectRatio: string; templateId: string }) => Promise<void>;
    saveSettings: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; image?: ImageSettings; audio?: AudioSettings }) => Promise<void>;
    testSettings: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; image?: ImageSettings; audio?: AudioSettings }) => Promise<void>;
    testAudioSettings: (audio: AudioSettings) => Promise<void>;
    saveSource: () => Promise<void>;
    saveScriptPrompt: (input: { scriptSystemPrompt: string; scriptUserPrompt: string }) => Promise<void>;
    generateScript: () => Promise<void>;
    generateMediaParallel: () => Promise<void>;
    generateMissingAudio: () => Promise<void>;
    saveSegmentDraft: (segment: Segment, patch: { text: string; visualDescription: string }) => Promise<void>;
    updateSegment: (segment: Segment, patch: Partial<Segment>) => Promise<void>;
    generateCompositions: () => Promise<void>;
    saveScene: (scene: ScenePlan, patch: Partial<ScenePlan>) => Promise<void>;
    listStoryboards: () => Promise<{ storyboards: Storyboard[] }>;
    regenerateStoryboard: (file: string) => Promise<void>;
    renderVideo: () => Promise<void>;
    saveVideoSettings: (videoSettings: VideoSettings) => Promise<void>;
    deleteProject: () => Promise<void>;
    cancelJob: (job?: Job | null) => Promise<void>;
    openHome: () => void;
  };
}) {
  return (
    <main className="mx-auto w-full max-w-[1680px] px-5 py-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" onClick={actions.openHome}>
            <ArrowLeft className="h-4 w-4" />
            项目列表
          </Button>
          <div className="min-w-0">
            <div className="text-xs uppercase text-zinc-500">当前项目</div>
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project?.name || "加载中"}</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SettingsDialog settings={settings} onSave={actions.saveSettings} onTest={actions.testSettings} onTestAudio={actions.testAudioSettings} />
          <CreateProjectDialog templates={templates} onCreate={actions.createProject} />
        </div>
      </header>

      <CommandCenter
        project={project}
        workflow={workflow}
        job={job}
        jobs={activeJobs}
      />
      <StepNav current={activeStep} recommended={workflow.step as StepId} onSelect={(step) => {
        setActiveStep(step);
      }} />

      <ActiveStepPanel
        step={activeStep}
        project={project}
        settings={settings}
        source={source}
        setSource={setSource}
        actions={{
          refreshAll: actions.refreshAll,
          openNewProject: () => document.getElementById("new-project-trigger")?.click(),
          openSettings: () => document.getElementById("settings-trigger")?.click(),
          saveSource: actions.saveSource,
          saveScriptPrompt: actions.saveScriptPrompt,
          generateScript: actions.generateScript,
          generateMediaParallel: actions.generateMediaParallel,
          generateMissingAudio: actions.generateMissingAudio,
          saveSegmentDraft: actions.saveSegmentDraft,
          updateSegment: actions.updateSegment,
          goAudio: async () => {
            setActiveStep("visual");
            await actions.generateMediaParallel();
          },
          generateCompositions: actions.generateCompositions,
          saveScene: actions.saveScene,
          listStoryboards: actions.listStoryboards,
          regenerateStoryboard: actions.regenerateStoryboard,
          renderVideo: actions.renderVideo,
          saveVideoSettings: actions.saveVideoSettings,
        }}
        onCancelVisualJob={() => actions.cancelJob(visualJob)}
        job={job}
        visualJob={visualJob}
        audioJob={audioJob}
        renderJob={renderJob}
        locked={jobActive}
      />
    </main>
  );
}

function CommandCenter({ project, workflow, job, jobs }: {
  project: Project | null;
  workflow: ReturnType<typeof getWorkflow>;
  job: Job | null;
  jobs: Job[];
}) {
  const shownJobs = jobs.length ? jobs : job ? [job] : [];
  const running = shownJobs.some(isJobActive);
  const activeJob = shownJobs.find(isJobActive) || shownJobs[0] || null;
  const status = running ? "running" : activeJob?.status || "idle";
  const total = Number(activeJob?.meta?.total || 0);
  const generated = Number(activeJob?.meta?.generated || 0);
  const failed = Number(activeJob?.meta?.failed || 0);
  const current = activeJob?.meta?.currentSegment || activeJob?.meta?.phase || "";
  const statusVariant = running ? "warning" : status === "failed" ? "destructive" : "secondary";
  const logLines = buildConsoleLines(shownJobs, workflow);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="border-b border-zinc-200 bg-white px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase text-zinc-500">Console</div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <div className="truncate font-medium">{activeJob?.label || "No running task"}</div>
                <Badge variant={statusVariant}>{status}</Badge>
                {total ? <span className="font-mono text-xs text-zinc-500">{generated}/{total}</span> : null}
                {failed ? <span className="font-mono text-xs text-red-600">failed {failed}</span> : null}
              </div>
            </div>
            <div className="text-right font-mono text-xs text-zinc-500">
              {current ? <div className="truncate">current: {current}</div> : null}
              <div>{running ? "active" : status}</div>
            </div>
          </div>
          <ActivityLine className="mt-3" active={running} status={status} />
        </div>
        <div className="h-52 overflow-auto bg-zinc-950 px-5 py-4 font-mono text-[12px] leading-6 text-zinc-100">
          {logLines.map((line, index) => (
            <div key={`${line.time}-${index}`} className="grid grid-cols-[74px_54px_1fr] gap-3">
              <span className="text-zinc-500">{line.time}</span>
              <span className={line.level === "ERROR" ? "text-red-300" : line.level === "DONE" ? "text-green-300" : line.level === "RUN" ? "text-amber-300" : "text-zinc-400"}>{line.level}</span>
              <span className="whitespace-pre-wrap break-words">{line.message}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityLine({ active, status, className = "" }: {
  active: boolean;
  status?: string;
  className?: string;
}) {
  const tone = active
    ? "bg-zinc-950"
    : status === "failed"
      ? "bg-red-600"
      : status === "done"
        ? "bg-green-600"
        : "bg-zinc-300";
  return (
    <div className={`activity-line ${active ? "activity-line-active" : ""} ${tone} ${className}`} aria-hidden="true" />
  );
}

function buildConsoleLines(jobs: Job[], workflow: ReturnType<typeof getWorkflow>) {
  if (!jobs.length) {
    return [{ time: "--:--:--", level: "INFO", message: "No running task." }];
  }
  return jobs.flatMap((job) => {
    const time = formatClock(job.updatedAt || job.createdAt);
    const total = Number(job.meta?.total || 0);
    const generated = Number(job.meta?.generated || 0);
    const current = job.meta?.currentSegment || job.meta?.phase;
    const lines = [
      {
        time: formatClock(job.createdAt),
        level: isJobActive(job) ? "RUN" : job.status === "done" ? "DONE" : job.status === "failed" ? "ERROR" : "INFO",
        message: total ? `${job.label} ${generated}/${total}` : `${job.label} ${job.status}`,
      },
    ];
    if (current) lines.push({ time, level: "RUN", message: `current: ${current}` });
    if (job.meta?.failed) lines.push({ time, level: "ERROR", message: `failed: ${job.meta.failed}` });
    for (const item of (job.logs || []).slice(-28)) {
      lines.push({ time, level: item.toLowerCase().includes("error") || item.toLowerCase().includes("failed") ? "ERROR" : "INFO", message: item });
    }
    if (job.error) lines.push({ time, level: "ERROR", message: job.error });
    if (!lines.length) lines.push({ time, level: "INFO", message: workflow.title });
    return lines;
  }).slice(-80);
}

function formatClock(value?: string | null) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function StepNav({ current, recommended, onSelect }: { current: StepId; recommended: StepId; onSelect: (step: StepId) => void }) {
  const steps = [
    ["content", "内容"],
    ["script", "脚本"],
    ["visual", "画面"],
    ["audio", "音频"],
    ["video", "视频"],
  ];
  const currentIndex = steps.findIndex(([id]) => id === current);
  return (
    <div className="mt-4 grid grid-cols-5 gap-2 rounded-lg border border-zinc-200 bg-white p-2 shadow-sm max-lg:grid-cols-3 max-md:grid-cols-2">
      {steps.map(([id, label], index) => (
        <button
          key={id}
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-100 ${id === current ? "bg-zinc-100 font-medium text-zinc-950" : "text-zinc-500"}`}
          onClick={() => onSelect(id as StepId)}
        >
          {index < currentIndex ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : id === current ? <Loader2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
          {label}
          {id === recommended && id !== current ? <span className="ml-auto rounded-full bg-zinc-950 px-1.5 py-0.5 text-[10px] text-white">当前</span> : null}
        </button>
      ))}
    </div>
  );
}

function ActiveStepPanel(props: {
  step: StepId;
  project: Project | null;
  settings: Settings | null;
  source: string;
  setSource: (value: string) => void;
  job: Job | null;
  visualJob: Job | null;
  audioJob: Job | null;
  renderJob: Job | null;
  locked: boolean;
  onCancelVisualJob: () => Promise<void>;
  actions: {
    refreshAll: () => Promise<Project[]>;
    openNewProject: () => void;
    openSettings: () => void;
    saveSource: () => Promise<void>;
    saveScriptPrompt: (input: { scriptSystemPrompt: string; scriptUserPrompt: string }) => Promise<void>;
    generateScript: () => Promise<void>;
    generateMediaParallel: () => Promise<void>;
    generateMissingAudio: () => Promise<void>;
    saveSegmentDraft: (segment: Segment, patch: { text: string; visualDescription: string }) => Promise<void>;
    updateSegment: (segment: Segment, patch: Partial<Segment>) => Promise<void>;
    goAudio: () => Promise<void>;
    generateCompositions: () => Promise<void>;
    saveScene: (scene: ScenePlan, patch: Partial<ScenePlan>) => Promise<void>;
    listStoryboards: () => Promise<{ storyboards: Storyboard[] }>;
    regenerateStoryboard: (file: string) => Promise<void>;
    renderVideo: () => Promise<void>;
    saveVideoSettings: (videoSettings: VideoSettings) => Promise<void>;
  };
}) {
  if (props.step === "content") {
    return <SourceCard source={props.source} setSource={props.setSource} canGenerate={Boolean(props.project && props.settings?.hasApiKey && props.source.trim() && !props.locked)} onGenerate={props.actions.generateScript} />;
  }
  if (props.step === "script") {
    return (
      <ScriptReviewCard
        project={props.project}
        settings={props.settings}
        locked={props.locked}
        onSavePrompt={props.actions.saveScriptPrompt}
        onSaveSegment={props.actions.saveSegmentDraft}
        onRegenerate={props.actions.generateScript}
      />
    );
  }
  if (props.step === "audio") {
    return (
      <AudioReviewWorkspace
        project={props.project}
        onGenerate={props.actions.generateMissingAudio}
        onRefresh={props.actions.refreshAll}
        job={props.audioJob}
        locked={props.locked || isJobActive(props.audioJob)}
      />
    );
  }
  if (props.step === "visual") {
    return (
      <VisualEditCard
        project={props.project}
        locked={props.locked || isJobActive(props.visualJob)}
        job={props.visualJob}
        onGenerate={props.actions.generateCompositions}
        onCancelJob={props.onCancelVisualJob}
        onListStoryboards={props.actions.listStoryboards}
        onRegenerateStoryboard={props.actions.regenerateStoryboard}
      />
    );
  }
  if (props.step === "video") {
    return <VideoCard project={props.project} locked={props.locked} job={props.renderJob} onRefresh={props.actions.refreshAll} onRender={props.actions.renderVideo} onSaveVideoSettings={props.actions.saveVideoSettings} />;
  }
  return null;
}

function CreateProjectDialog({ templates, onCreate }: {
  templates: VideoTemplate[];
  onCreate: (input: { name: string; aspectRatio: string; templateId: string }) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(`知识解释视频 ${new Date().toLocaleDateString("zh-CN")}`);
  const [aspectRatio, setAspectRatio] = React.useState("9:16");
  const [templateId, setTemplateId] = React.useState("stickman");
  const availableTemplates = React.useMemo(() => {
    const list = templates.length ? templates : [{
      id: "stickman",
      name: "火柴人极简解释图",
      description: "白底黑线火柴人，极简场景、清晰动作、少量彩色标注，适合把复杂概念画成一眼可懂的小剧场。",
      aspectRatios: ["9:16", "16:9", "1:1", "4:5"],
      preview: { kind: "stickman" },
    }];
    return list.filter((template) => !template.aspectRatios?.length || template.aspectRatios.includes(aspectRatio));
  }, [aspectRatio, templates]);
  const selectedTemplate = availableTemplates.find((template) => template.id === templateId) || availableTemplates[0];

  React.useEffect(() => {
    if (selectedTemplate && selectedTemplate.id !== templateId) setTemplateId(selectedTemplate.id);
  }, [selectedTemplate?.id, templateId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button id="new-project-trigger" className="w-full">新建项目</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建视频项目</DialogTitle>
          <DialogDescription>先确定视频比例和分镜图风格。最终时长由旁白音频自动决定。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label>项目名</Label>
            <Input id="project-name" name="project-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>视频比例</Label>
            <RadioGroup value={aspectRatio} onValueChange={setAspectRatio} className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
              {aspectRatios.map((item) => (
                <label key={item.value} className="rounded-lg border border-zinc-200 p-3 has-[[data-state=checked]]:border-zinc-950 has-[[data-state=checked]]:bg-zinc-100">
                  <div className="flex justify-between gap-2">
                    <div className="font-medium">{item.label}</div>
                    <RadioGroupItem value={item.value} />
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">{item.detail}</div>
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="grid gap-2">
            <Label>分镜图风格</Label>
            <RadioGroup value={selectedTemplate?.id || templateId} onValueChange={setTemplateId} className="grid gap-2">
              {availableTemplates.map((template) => (
                <label key={template.id} className="rounded-lg border border-zinc-200 p-3 has-[[data-state=checked]]:border-zinc-950 has-[[data-state=checked]]:bg-zinc-100">
                  <div className="flex items-center gap-4">
                    <TemplatePreview template={template} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{template.name}</div>
                          <p className="mt-1 text-sm leading-5 text-zinc-500">{template.description}</p>
                        </div>
                        <RadioGroupItem value={template.id} />
                      </div>
                      <div className="mt-2 font-mono text-[11px] text-zinc-400">{template.id}</div>
                    </div>
                  </div>
                </label>
              ))}
            </RadioGroup>
            {!availableTemplates.length ? <p className="text-xs text-zinc-500">当前比例下没有可用风格。</p> : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button
            onClick={async () => {
              await onCreate({ name, aspectRatio, templateId: selectedTemplate?.id || templateId || "stickman" });
              setOpen(false);
            }}
          >
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplatePreview({ template }: { template: VideoTemplate }) {
  const kind = template.preview?.kind || template.id;
  const accent = template.imageStyle?.accent || "#f05a28";
  const secondary = template.imageStyle?.secondary || "#2367d1";
  if (kind === "stickman" || template.id === "stickman") {
    return (
      <div className="grid h-24 w-36 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white">
        <div className="relative h-14 w-24">
          <div className="absolute left-3 top-2 h-5 w-5 rounded-full border-2 border-zinc-950" />
          <div className="absolute left-[21px] top-7 h-7 w-0.5 bg-zinc-950" />
          <div className="absolute left-3 top-9 h-0.5 w-8 -rotate-12 bg-zinc-950" />
          <div className="absolute left-4 top-[50px] h-0.5 w-8 rotate-12 bg-zinc-950" />
          <div className="absolute right-4 top-3 h-px w-12 rotate-6" style={{ background: accent }} />
          <div className="absolute right-1 top-8 h-px w-16 -rotate-6" style={{ background: secondary }} />
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-24 w-36 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white">
      <div className="relative h-14 w-20">
        <div className="absolute left-2 top-5 h-5 w-8 -rotate-6 rounded-[50%] bg-zinc-950" />
        <div className="absolute left-4 top-7 h-4 w-px rotate-12 bg-zinc-950" />
        <div className="absolute left-8 top-7 h-4 w-px -rotate-12 bg-zinc-950" />
        <div className="absolute left-4 top-7 h-1.5 w-1.5 rounded-full bg-white" />
        <div className="absolute left-8 top-6 h-1.5 w-1.5 rounded-full bg-white" />
        <div className="absolute right-0 top-1 h-px w-12 rotate-12" style={{ background: accent }} />
        <div className="absolute right-2 top-8 h-px w-10 -rotate-6" style={{ background: secondary }} />
      </div>
    </div>
  );
}

function SettingsDialog({ settings, onSave, onTest, onTestAudio }: {
  settings: Settings | null;
  onSave: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; image?: ImageSettings; audio?: AudioSettings }) => Promise<void>;
  onTest: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; image?: ImageSettings; audio?: AudioSettings }) => Promise<void>;
  onTestAudio: (audio: AudioSettings) => Promise<void>;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button id="settings-trigger" variant="outline" className="w-full">
          <SettingsIcon className="h-4 w-4" />
          模型设置
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>模型配置</DialogTitle>
          <DialogDescription>API Key 只保存在本机。留空表示继续使用已保存的 key。</DialogDescription>
        </DialogHeader>
        <SettingsPanel settings={settings} onSave={onSave} onTest={onTest} onTestAudio={onTestAudio} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel({ settings, onSave, onTest, onTestAudio }: {
  settings: Settings | null;
  onSave: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; image?: ImageSettings; audio?: AudioSettings }) => Promise<void>;
  onTest: (input: { baseUrl: string; model: string; apiKey: string; temperature: number; image?: ImageSettings; audio?: AudioSettings }) => Promise<void>;
  onTestAudio: (audio: AudioSettings) => Promise<void>;
}) {
  const [baseUrl, setBaseUrl] = React.useState("");
  const [model, setModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [temperature, setTemperature] = React.useState(0.7);
  const [image, setImage] = React.useState<ImageSettings>({
    model: "gpt-image-2",
    quality: "medium",
    outputFormat: "png",
  });
  const [audio, setAudio] = React.useState<AudioSettings>({
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
  });

  React.useEffect(() => {
    setBaseUrl(settings?.baseUrl || "https://api.openai.com/v1");
    setModel(settings?.model || "gpt-4.1-mini");
    setTemperature(settings?.temperature ?? 0.7);
    if (settings?.image) setImage(settings.image);
    if (settings?.audio) setAudio(settings.audio);
  }, [settings]);

  const input = { baseUrl, model, apiKey, temperature, image, audio };
  const setImageField = <K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) => {
    setImage((current) => ({ ...current, [key]: value }));
  };
  const setAudioField = <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
    setAudio((current) => ({ ...current, [key]: value }));
  };
  return (
    <form className="grid gap-5">
      <SettingsSection
        title="脚本模型"
        description="OpenAI-compatible 接口，用于整理旁白和生成分镜信息。"
      >
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <SettingField id="llm-base-url" label="Base URL" value={baseUrl} onChange={setBaseUrl} autoComplete="off" tip="例如 https://api.openai.com/v1" />
          <SettingField id="llm-model" label="Model" value={model} onChange={setModel} autoComplete="username" tip="用于脚本整理" />
          <SettingField id="llm-api-key" label="API Key" type="password" value={apiKey} onChange={setApiKey} autoComplete="current-password" placeholder={settings?.hasApiKey ? "已保存，可留空" : "输入 API Key"} tip="只保存在本机" />
          <SettingField id="llm-temperature" label="Temperature" type="number" value={temperature} onNumberChange={setTemperature} step="0.1" min="0" max="2" tip="建议 0.5-0.8" />
        </div>
      </SettingsSection>

      <SettingsSection
        title="图片模型"
        description="用于生成每段分镜图，默认复用脚本模型的 Base URL 和 API Key。"
      >
        <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
          <SettingField id="image-model" label="Image Model" value={image.model} onChange={(value) => setImageField("model", value)} tip="默认 gpt-image-2" />
          <SettingField id="image-quality" label="Quality" value={image.quality} onChange={(value) => setImageField("quality", value)} tip="建议 medium" />
          <SettingField id="image-format" label="Format" value={image.outputFormat} onChange={(value) => setImageField("outputFormat", value)} tip="建议 png" />
        </div>
      </SettingsSection>

      <SettingsSection
        title="旁白模型"
        description="MiniMax 用于一次生成完整旁白和字幕时间轴。"
      >
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          <SettingField id="minimax-api-key" label="MiniMax API Key" type="password" value={audio.minimaxApiKey} onChange={(value) => setAudioField("minimaxApiKey", value)} autoComplete="new-password" placeholder={settings?.hasMinimaxApiKey ? "已保存，可留空" : "输入 MiniMax API Key"} tip="只保存在本机" />
          <SettingField id="minimax-voice-id" label="Voice ID" value={audio.minimaxVoiceId} onChange={(value) => setAudioField("minimaxVoiceId", value)} tip="已克隆音色的 voice_id" />
          <SettingField id="minimax-model" label="模型" value={audio.minimaxModel} onChange={(value) => setAudioField("minimaxModel", value)} tip="建议 speech-2.8-hd" />
          <SettingField id="minimax-base-url" label="Base URL" value={audio.minimaxBaseUrl} onChange={(value) => setAudioField("minimaxBaseUrl", value)} tip="默认 https://api.minimax.io" />
        </div>
        <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-zinc-700">高级音频参数</summary>
          <div className="mt-3 grid grid-cols-3 gap-3 max-md:grid-cols-1">
            <SettingField id="minimax-group-id" label="Group ID" value={audio.minimaxGroupId} onChange={(value) => setAudioField("minimaxGroupId", value)} tip="账号需要时填写" />
            <SettingField id="minimax-speed" label="语速" type="number" value={audio.minimaxSpeed} onNumberChange={(value) => setAudioField("minimaxSpeed", value)} step="0.05" min="0.5" max="2" tip="默认 1" />
            <SettingField id="minimax-volume" label="音量" type="number" value={audio.minimaxVolume} onNumberChange={(value) => setAudioField("minimaxVolume", value)} step="0.1" min="0.1" max="10" tip="默认 1" />
            <SettingField id="minimax-pitch" label="音调" type="number" value={audio.minimaxPitch} onNumberChange={(value) => setAudioField("minimaxPitch", value)} step="1" min="-12" max="12" tip="默认 0" />
            <SettingField id="minimax-sample-rate" label="采样率" type="number" value={audio.minimaxSampleRate} onNumberChange={(value) => setAudioField("minimaxSampleRate", value)} min="8000" max="48000" tip="默认 32000" />
            <SettingField id="minimax-bitrate" label="码率" type="number" value={audio.minimaxBitrate} onNumberChange={(value) => setAudioField("minimaxBitrate", value)} min="32000" max="320000" tip="默认 128000" />
            <SettingField id="minimax-format" label="格式" value={audio.minimaxFormat} onChange={(value) => setAudioField("minimaxFormat", value)} tip="建议 wav" />
          </div>
        </details>
      </SettingsSection>

      <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 pt-4">
        <Button type="button" id="test-settings-trigger" variant="secondary" onClick={() => onTest(input)}>测试脚本模型</Button>
        <Button type="button" variant="secondary" onClick={() => onTestAudio(audio)}>测试音频模型</Button>
        <Button type="button" onClick={() => onSave(input)}>保存配置</Button>
      </div>
    </form>
  );
}

function SettingsSection({ title, description, children }: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <div className="text-sm font-semibold text-zinc-950">{title}</div>
        <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function LabelWithTip({ htmlFor, label, tip }: {
  htmlFor: string;
  label: string;
  tip?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {tip ? <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] leading-none text-zinc-500">{tip}</span> : null}
    </div>
  );
}

function SettingField({ id, label, value, onChange, onNumberChange, type = "text", tip, ...inputProps }: {
  id: string;
  label: string;
  value: string | number;
  onChange?: (value: string) => void;
  onNumberChange?: (value: number) => void;
  type?: React.HTMLInputTypeAttribute;
  tip?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "type" | "onChange">) {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (type === "number") {
      onNumberChange?.(Number(event.target.value));
      return;
    }
    onChange?.(event.target.value);
  };
  return (
    <div className="grid gap-2">
      <LabelWithTip htmlFor={id} label={label} tip={tip} />
      <Input id={id} type={type} value={value} onChange={handleChange} {...inputProps} />
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="text-xs uppercase text-zinc-500">{label}</div>
      <div className="mt-1 break-words font-medium">{value}</div>
    </div>
  );
}

function ScriptPromptDialog({
  settings,
  locked,
  scriptSystemPrompt,
  scriptUserPrompt,
  setScriptSystemPrompt,
  setScriptUserPrompt,
  onSavePrompt,
  onRegenerate,
  canRegenerate,
}: {
  settings: Settings | null;
  locked: boolean;
  scriptSystemPrompt: string;
  scriptUserPrompt: string;
  setScriptSystemPrompt: (value: string) => void;
  setScriptUserPrompt: (value: string) => void;
  onSavePrompt: (input: { scriptSystemPrompt: string; scriptUserPrompt: string }) => Promise<void>;
  onRegenerate: () => Promise<void>;
  canRegenerate: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <SettingsIcon className="h-4 w-4" />
          编辑整理提示词
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>脚本整理提示词</DialogTitle>
          <DialogDescription>这里控制“内容源”如何被大模型整理成标题、旁白和分段。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <p className="text-xs leading-5 text-zinc-500">
            可用变量：{"{{templateId}}"}、{"{{source}}"}。这里只保留项目真实字段；页面不能设置的内容不要写成变量。
          </p>
          <div className="grid gap-2">
            <Label htmlFor="script-dialog-system-prompt">System Prompt</Label>
            <Textarea
              id="script-dialog-system-prompt"
              name="script-dialog-system-prompt"
              className="min-h-28 resize-y text-sm leading-6"
              value={scriptSystemPrompt}
              onChange={(event) => setScriptSystemPrompt(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="script-dialog-user-prompt">User Prompt 模板</Label>
            <Textarea
              id="script-dialog-user-prompt"
              name="script-dialog-user-prompt"
              className="min-h-[420px] resize-y text-sm leading-6"
              value={scriptUserPrompt}
              onChange={(event) => setScriptUserPrompt(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={locked || !settings}
            onClick={() => onSavePrompt({ scriptSystemPrompt, scriptUserPrompt })}
          >
            保存提示词
          </Button>
          <Button
            type="button"
            disabled={locked || !settings || !canRegenerate}
            onClick={async () => {
              await onSavePrompt({ scriptSystemPrompt, scriptUserPrompt });
              await onRegenerate();
            }}
          >
            保存后重新整理
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScriptReviewCard({
  project,
  settings,
  locked,
  onSavePrompt,
  onSaveSegment,
  onRegenerate,
}: {
  project: Project | null;
  settings: Settings | null;
  locked: boolean;
  onSavePrompt: (input: { scriptSystemPrompt: string; scriptUserPrompt: string }) => Promise<void>;
  onSaveSegment: (segment: Segment, patch: { text: string; visualDescription: string }) => Promise<void>;
  onRegenerate: () => Promise<void>;
}) {
  const segments = project?.segments || [];
  const [scriptSystemPrompt, setScriptSystemPrompt] = React.useState("");
  const [scriptUserPrompt, setScriptUserPrompt] = React.useState("");
  const [drafts, setDrafts] = React.useState<Record<string, { text: string; visualDescription: string }>>({});
  const [activeSegmentId, setActiveSegmentId] = React.useState<string | null>(null);
  const visualBibleEntities = React.useMemo(() => {
    const bible = project?.visualBible;
    if (!bible) return [];
    return [...bible.characters, ...bible.objects, ...bible.places, ...bible.symbols];
  }, [project?.visualBible]);
  const activeSegment = segments.find((segment) => segment.id === activeSegmentId) || segments[0] || null;
  const totalChars = segments.reduce((sum, segment) => sum + String(drafts[segment.id]?.text ?? segment.text).replace(/\s+/g, "").length, 0);
  const avgChars = segments.length ? Math.round(totalChars / segments.length) : 0;

  React.useEffect(() => {
    setScriptSystemPrompt(settings?.scriptSystemPrompt || "");
    setScriptUserPrompt(settings?.scriptUserPrompt || "");
  }, [settings?.scriptSystemPrompt, settings?.scriptUserPrompt]);

  React.useEffect(() => {
    const next: Record<string, { text: string; visualDescription: string }> = {};
    for (const segment of segments) {
      next[segment.id] = {
        text: segment.text,
        visualDescription: segmentVisualDescription(segment),
      };
    }
    setDrafts(next);
    setActiveSegmentId((current) => current && segments.some((segment) => segment.id === current) ? current : segments[0]?.id || null);
  }, [project?.id, segments.length]);

  const updateDraft = (segment: Segment, patch: Partial<{ text: string; visualDescription: string }>) => {
    setDrafts((current) => ({
      ...current,
      [segment.id]: {
        text: current[segment.id]?.text ?? segment.text,
        visualDescription: current[segment.id]?.visualDescription ?? segmentVisualDescription(segment),
        ...patch,
      },
    }));
  };

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader className="border-b border-zinc-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>{project?.script?.title || "脚本确认"}</CardTitle>
            <CardDescription>{project?.script?.subtitle || "检查旁白节拍、画面描述和视觉一致性实体。"}</CardDescription>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{segments.length} 段</Badge>
              <Badge variant="secondary">{segments.length ? `${avgChars} 字/段` : "未分段"}</Badge>
              <Badge variant="secondary">{visualBibleEntities.length} 个视觉实体</Badge>
              {activeSegment ? <Badge variant="secondary">{activeSegment.id.toUpperCase()}</Badge> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ScriptPromptDialog
              settings={settings}
              locked={locked}
              scriptSystemPrompt={scriptSystemPrompt}
              scriptUserPrompt={scriptUserPrompt}
              setScriptSystemPrompt={setScriptSystemPrompt}
              setScriptUserPrompt={setScriptUserPrompt}
              onSavePrompt={onSavePrompt}
              onRegenerate={onRegenerate}
              canRegenerate={Boolean(project?.source)}
            />
            <Button variant="outline" disabled={!project?.source || locked} onClick={onRegenerate}>
              <Wand2 className="h-4 w-4" />
              重新整理
            </Button>
          </div>
        </div>
        {visualBibleEntities.length ? (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="mb-2 text-xs font-medium text-zinc-500">视觉实体库</div>
            <div className="flex flex-wrap gap-2">
              {visualBibleEntities.map((entity) => (
                <span key={entity.id} className="inline-flex max-w-[320px] items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs">
                  <span className="font-medium">{entity.name}</span>
                  <span className="font-mono text-zinc-400">{entity.id}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid min-h-[680px] grid-cols-2 max-xl:grid-cols-1">
          <div className="border-r border-zinc-200 max-xl:border-r-0 max-xl:border-b">
            <div className="border-b border-zinc-200 p-4">
              <div className="text-sm font-medium">旁白节拍</div>
              <p className="mt-1 text-xs text-zinc-500">选择一段检查。每段后续对应一张分镜图。</p>
            </div>
            <ScrollArea className="h-[620px]">
              <div className="divide-y divide-zinc-100">
                {segments.length ? segments.map((segment) => {
                  const textValue = drafts[segment.id]?.text ?? segment.text;
                  const charCount = textValue.replace(/\s+/g, "").length;
                  const selected = activeSegment?.id === segment.id;
                  return (
                    <button
                      key={segment.id}
                      type="button"
                      className={`grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-zinc-50 ${selected ? "border-l-4 border-zinc-950 bg-zinc-50" : "border-l-4 border-transparent"}`}
                      onClick={() => setActiveSegmentId(segment.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs font-semibold uppercase">{segment.id}</span>
                        <span className="font-mono text-xs text-zinc-500">{charCount} 字</span>
                      </div>
                      <div className="two-line-clamp text-sm leading-6 text-zinc-700">{textValue}</div>
                      {segment.entities?.length ? (
                        <div className="truncate font-mono text-[11px] text-zinc-400">
                          {segment.entities.slice(0, 2).join(" / ")}
                          {segment.entities.length > 2 ? ` +${segment.entities.length - 2}` : ""}
                        </div>
                      ) : null}
                    </button>
                  );
                }) : (
                  <div className="p-6 text-sm text-zinc-500">还没有旁白分段。</div>
                )}
              </div>
            </ScrollArea>
          </div>
          <div className="min-w-0 p-4">
            {activeSegment ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold uppercase text-zinc-500">{activeSegment.id}</div>
                    <div className="mt-1 text-lg font-semibold">当前画面节拍</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={locked}
                      onClick={() => onSaveSegment(activeSegment, {
                        text: drafts[activeSegment.id]?.text ?? activeSegment.text,
                        visualDescription: drafts[activeSegment.id]?.visualDescription ?? segmentVisualDescription(activeSegment),
                      })}
                    >
                      保存段落
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs text-zinc-500">旁白</Label>
                  <Textarea
                    aria-label={`${activeSegment.id} 旁白`}
                    className="min-h-36 resize-y bg-zinc-50 text-base leading-7"
                    value={drafts[activeSegment.id]?.text ?? activeSegment.text}
                    onChange={(event) => updateDraft(activeSegment, { text: event.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs text-zinc-500">画面描述</Label>
                  <Textarea
                    aria-label={`${activeSegment.id} 画面描述`}
                    className="min-h-32 resize-y bg-white text-sm leading-6"
                    value={drafts[activeSegment.id]?.visualDescription ?? segmentVisualDescription(activeSegment)}
                    onChange={(event) => updateDraft(activeSegment, { visualDescription: event.target.value })}
                  />
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-sm font-medium">引用实体</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeSegment.entities?.length ? activeSegment.entities.map((id) => {
                      const entity = visualBibleEntities.find((item) => item.id === id);
                      return (
                        <Badge key={id} variant="secondary">
                          {entity?.name || id}
                        </Badge>
                      );
                    }) : <span className="text-sm text-zinc-500">这一段没有引用全局实体。</span>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">还没有旁白分段。</div>
            )}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}

function SourceCard({ source, setSource, canGenerate, onGenerate }: {
  source: string;
  setSource: (value: string) => void;
  canGenerate: boolean;
  onGenerate: () => Promise<void>;
}) {
  return (
    <Card className="min-h-[560px]">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>内容源</CardTitle>
          <CardDescription>粘贴资料，统一由大模型整理成视频脚本。</CardDescription>
        </div>
        <Button disabled={!canGenerate} onClick={onGenerate}>开始整理</Button>
      </CardHeader>
      <CardContent>
        <Textarea id="source-content" name="source-content" aria-label="内容源" className="h-[470px] resize-none text-sm leading-7" value={source} onChange={(event) => setSource(event.target.value)} />
      </CardContent>
    </Card>
  );
}

type WaveSurferInstance = ReturnType<typeof WaveSurfer.create>;

function safelyDestroyExternalWidget(destroy: () => void) {
  try {
    destroy();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return;
    if (error instanceof Error && /removeChild/.test(error.message)) return;
    throw error;
  }
}

function VoiceoverPlayer({ src }: {
  src?: string;
}) {
  const waveformRef = React.useRef<HTMLDivElement | null>(null);
  const wavesurferRef = React.useRef<WaveSurferInstance | null>(null);
  const fallbackAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");

  React.useEffect(() => {
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoadError("");
    if (fallbackAudioRef.current) {
      fallbackAudioRef.current.pause();
      fallbackAudioRef.current = null;
    }

    if (!src || !waveformRef.current) {
      if (wavesurferRef.current) {
        safelyDestroyExternalWidget(() => wavesurferRef.current?.destroy());
      }
      wavesurferRef.current = null;
      return;
    }

    if (wavesurferRef.current) {
      safelyDestroyExternalWidget(() => wavesurferRef.current?.destroy());
      wavesurferRef.current = null;
    }

    const fallbackAudio = new Audio(src);
    fallbackAudio.preload = "metadata";
    fallbackAudioRef.current = fallbackAudio;
    const onFallbackLoaded = () => setDuration((value) => value || fallbackAudio.duration || 0);
    const onFallbackTimeUpdate = () => setCurrentTime(fallbackAudio.currentTime || 0);
    const onFallbackPlay = () => setPlaying(true);
    const onFallbackPause = () => setPlaying(false);
    const onFallbackEnded = () => setPlaying(false);
    fallbackAudio.addEventListener("loadedmetadata", onFallbackLoaded);
    fallbackAudio.addEventListener("timeupdate", onFallbackTimeUpdate);
    fallbackAudio.addEventListener("play", onFallbackPlay);
    fallbackAudio.addEventListener("pause", onFallbackPause);
    fallbackAudio.addEventListener("ended", onFallbackEnded);

    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      url: src,
      height: 72,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      cursorWidth: 2,
      cursorColor: "#18181b",
      progressColor: "#18181b",
      waveColor: "#d4d4d8",
      normalize: true,
      dragToSeek: true,
    });
    wavesurferRef.current = wavesurfer;

    const subscriptions = [
      wavesurfer.on("ready", () => {
        setReady(true);
        setDuration(wavesurfer.getDuration() || 0);
      }),
      wavesurfer.on("error", (error) => {
        setLoadError(error instanceof Error ? error.message : String(error || "音频波形加载失败"));
      }),
      wavesurfer.on("timeupdate", (time) => {
        setCurrentTime(time || 0);
      }),
      wavesurfer.on("interaction", (time) => {
        setCurrentTime(time || 0);
      }),
      wavesurfer.on("play", () => setPlaying(true)),
      wavesurfer.on("pause", () => setPlaying(false)),
      wavesurfer.on("finish", () => setPlaying(false)),
    ];

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      safelyDestroyExternalWidget(() => wavesurfer.destroy());
      if (wavesurferRef.current === wavesurfer) {
        wavesurferRef.current = null;
      }
      fallbackAudio.pause();
      fallbackAudio.removeEventListener("loadedmetadata", onFallbackLoaded);
      fallbackAudio.removeEventListener("timeupdate", onFallbackTimeUpdate);
      fallbackAudio.removeEventListener("play", onFallbackPlay);
      fallbackAudio.removeEventListener("pause", onFallbackPause);
      fallbackAudio.removeEventListener("ended", onFallbackEnded);
      if (fallbackAudioRef.current === fallbackAudio) fallbackAudioRef.current = null;
    };
  }, [src]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditing || event.key !== " ") return;
      event.preventDefault();
      wavesurferRef.current?.playPause().catch(() => undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function toggle() {
    if (!src) return;
    if (ready && wavesurferRef.current) {
      await wavesurferRef.current.playPause().catch(() => undefined);
      return;
    }
    const fallbackAudio = fallbackAudioRef.current;
    if (!fallbackAudio) return;
    if (fallbackAudio.paused) await fallbackAudio.play().catch(() => undefined);
    else fallbackAudio.pause();
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-4">
        <Button size="icon" className="h-12 w-12 shrink-0 rounded-full" disabled={!src} onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
          {playing ? <PauseCircle className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-3 font-mono text-xs text-zinc-500">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration || 0)}</span>
          </div>
          <div className="relative overflow-hidden rounded-md bg-zinc-100 px-3 py-2">
            <div className="relative z-10 min-h-[72px]" ref={waveformRef}>
              {!src ? <div className="flex h-[72px] items-center text-sm text-zinc-500">等待生成音频。</div> : null}
              {src && !ready ? <div className="flex h-[72px] items-center text-sm text-zinc-500">{loadError ? "波形加载失败，可直接播放音频。" : "正在加载波形，可直接播放。"}</div> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AudioReviewWorkspace(props: {
  project: Project | null;
  onGenerate: () => Promise<void>;
  onRefresh?: () => Promise<Project[] | undefined>;
  job: Job | null;
  locked: boolean;
}) {
  const segments = props.project?.segments || [];
  const previousAudioJobActive = React.useRef(false);

  const currentGenerating = props.job?.meta?.currentSegment || null;
  const failedCount = Number(props.job?.meta?.failed || 0);
  const totalDuration = props.project?.voiceover && props.project?.timings?.length ? props.project.timings.at(-1)?.end : null;
  const generatedAt = props.project?.voiceover ? formatDate(props.project.updatedAt) : "";
  const voiceoverSrc = props.project?.voiceover ? `${projectAssetPath(props.project.id, props.project.voiceover)}?v=${encodeURIComponent(props.project.updatedAt || props.project.voiceover)}` : undefined;

  React.useEffect(() => {
    const active = Boolean(props.job && isJobActive(props.job));
    const wasActive = previousAudioJobActive.current;
    previousAudioJobActive.current = active;
    if (wasActive && !active && props.job && ["done", "failed", "cancelled"].includes(props.job.status)) {
      props.onRefresh?.().catch(() => undefined);
    }
  }, [props.job?.id, props.job?.status, props.onRefresh]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>音频</CardTitle>
              <CardDescription>
                脚本 {segments.length} 段 · {props.project?.voiceover ? "完整旁白已生成" : "完整旁白未生成"}
                {currentGenerating ? " · 正在生成完整旁白" : ""}
                {failedCount ? ` · 失败 ${failedCount}` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!segments.length || props.locked} onClick={props.onGenerate}>
                {props.project?.voiceover ? "重新生成完整旁白" : "生成完整旁白"}
              </Button>
            </div>
          </div>
          <div className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              <InfoTile label="音频文件" value={props.project?.voiceover || "未生成"} />
              <InfoTile label="总时长" value={formatDuration(totalDuration)} />
              <InfoTile label="生成时间" value={generatedAt || "未生成"} />
            </div>
            <VoiceoverPlayer
              src={voiceoverSrc}
            />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function FinalVideoPlayer({ src, aspectRatio }: { src: string; aspectRatio?: string }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const playerRef = React.useRef<Plyr | null>(null);
  const plyrRatio = aspectRatio || "16:9";
  const [ratioWidth, ratioHeight] = plyrRatio.split(":").map((value) => Number(value));
  const ratioValue = ratioWidth > 0 && ratioHeight > 0 ? ratioWidth / ratioHeight : 16 / 9;
  const useNativeControls = ratioValue < 1;
  const playerMaxWidth = `${Math.min(1280, Math.round(78 * ratioValue * 10) / 10)}vh`;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !src) return;
    if (playerRef.current) {
      safelyDestroyExternalWidget(() => playerRef.current?.destroy());
      playerRef.current = null;
    }
    container.replaceChildren();

    const video = document.createElement("video");
    video.src = src;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.className = "rounded-md bg-black";
    container.appendChild(video);

    if (useNativeControls) return;

    const player = new Plyr(video, {
      controls: ["play-large", "restart", "rewind", "play", "fast-forward", "progress", "current-time", "duration", "mute", "settings", "pip", "download", "fullscreen"],
      iconUrl: "/plyr.svg",
      loadSprite: true,
      settings: ["speed"],
      speed: { selected: 1, options: [0.75, 1, 1.25, 1.5, 2] },
      seekTime: 5,
      clickToPlay: false,
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      hideControls: false,
      resetOnEnd: false,
      ratio: plyrRatio,
    });
    playerRef.current = player;
    return () => {
      safelyDestroyExternalWidget(() => player.destroy());
      if (playerRef.current === player) {
        playerRef.current = null;
      }
      if (container.isConnected) {
        container.replaceChildren();
      }
    };
  }, [src, plyrRatio, useNativeControls]);

  return (
    <div
      ref={containerRef}
      className={`video-player-shell ${useNativeControls ? "video-player-shell-native" : ""}`}
      style={{
        "--video-player-max-width": playerMaxWidth,
        aspectRatio: `${ratioWidth || 16} / ${ratioHeight || 9}`,
      } as React.CSSProperties}
    />
  );
}

function VisualEditCard({ project, locked, job, onGenerate, onCancelJob, onListStoryboards, onRegenerateStoryboard }: {
  project: Project | null;
  locked: boolean;
  job: Job | null;
  onGenerate: () => Promise<void>;
  onCancelJob: () => Promise<void>;
  onListStoryboards: () => Promise<{ storyboards: Storyboard[] }>;
  onRegenerateStoryboard: (file: string) => Promise<void>;
}) {
  const [items, setItems] = React.useState<Storyboard[]>([]);
  const [activeFile, setActiveFile] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const previousStoryboardJobActive = React.useRef(false);
  const runningStoryboardJob = Boolean(job && job.type === "storyboards" && isJobActive(job));
  const scenes = project?.renderPlan?.scenes || [];
  const itemSceneIds = new Set(items.map((item) => item.sceneId));
  const missingScenes = scenes.filter((scene) => !itemSceneIds.has(scene.id));
  const failed = job?.type === "storyboards" ? job.meta?.failed || 0 : 0;
  const total = job?.type === "storyboards" ? job.meta?.total || scenes.length || 0 : scenes.length || items.length;
  const generatedCount = Math.min(items.length, total || items.length);
  const activeItem = items.find((item) => item.file === activeFile) || items[0] || null;
  const imageSrc = activeItem && project ? `${activeItem.url || projectAssetPath(project.id, activeItem.path)}?v=${encodeURIComponent(`${activeItem.updatedAt}-${version}`)}` : "";

  async function refreshPages(keepFile = activeFile) {
    const payload = await onListStoryboards();
    setItems(payload.storyboards);
    setActiveFile(keepFile && payload.storyboards.some((item) => item.file === keepFile) ? keepFile : payload.storyboards[0]?.file || null);
  }

  React.useEffect(() => {
    if (project) refreshPages(null).catch(() => setItems([]));
  }, [project?.id, project?.updatedAt, project?.storyboards?.length]);

  React.useEffect(() => {
    if (!runningStoryboardJob) return;
    const timer = window.setInterval(() => {
      refreshPages(activeFile).then(() => setVersion((value) => value + 1)).catch(() => undefined);
    }, 1800);
    return () => window.clearInterval(timer);
  }, [runningStoryboardJob, activeFile, project?.id]);

  React.useEffect(() => {
    const wasRunning = previousStoryboardJobActive.current;
    previousStoryboardJobActive.current = runningStoryboardJob;
    if (wasRunning && !runningStoryboardJob) {
      refreshPages(activeFile).then(() => setVersion((value) => value + 1)).catch(() => undefined);
    }
  }, [runningStoryboardJob, activeFile, project?.id]);

  async function regenerateStoryboard(file: string) {
    await onRegenerateStoryboard(file);
    setActiveFile(file);
  }

  async function generateAllPages() {
    await onGenerate();
    await refreshPages(activeFile);
    setVersion((value) => value + 1);
  }

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader className="border-b border-zinc-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle>分镜图</CardTitle>
            <CardDescription>画廊式检查分镜图。生成任务会按顺序逐张出现，每张图都可以单独重新生成。</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {runningStoryboardJob ? (
              <Button variant="outline" disabled={job?.status === "cancelling"} onClick={() => onCancelJob()}>
                <PauseCircle className="h-4 w-4" />
                暂停生成
              </Button>
            ) : null}
            <Button disabled={!project || locked} onClick={generateAllPages}>{missingScenes.length ? `生成缺失分镜 (${missingScenes.length})` : "生成/更新分镜图"}</Button>
            <Button size="sm" variant="outline" disabled={!project} onClick={() => refreshPages(activeFile).catch(() => setItems([]))}>刷新</Button>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-zinc-500">
              {runningStoryboardJob
                ? `正在生成 ${job?.meta?.currentSegment || "分镜图"}${failed ? `，失败 ${failed} 张` : ""}`
                : items.length ? `已生成 ${items.length} 张分镜图${missingScenes.length ? `，缺 ${missingScenes.length} 张` : ""}${failed ? `，失败 ${failed} 张` : ""}` : "等待生成分镜图"}
            </span>
            <span className="font-mono text-xs text-zinc-500">{total ? `${generatedCount}/${total}` : `${items.length}`}</span>
          </div>
          {missingScenes.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>缺失分镜：</span>
                <span className="font-mono text-xs">{missingScenes.slice(0, 8).map((scene) => scene.id).join(", ")}</span>
                {missingScenes.length > 8 ? <span className="text-xs">+{missingScenes.length - 8}</span> : null}
              </div>
              <Button size="sm" disabled={!project || locked} onClick={generateAllPages}>生成缺失</Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-[minmax(0,1fr)_340px] gap-0 p-0 max-xl:grid-cols-1">
        <section className="border-r border-zinc-200 bg-zinc-50 p-4 max-xl:border-r-0 max-xl:border-b">
          {items.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {items.map((item) => {
                const src = `${item.url || (project ? projectAssetPath(project.id, item.path) : "")}?v=${encodeURIComponent(`${item.updatedAt}-${version}`)}`;
                const selected = activeItem?.file === item.file;
                const ratio = item.width && item.height ? `${item.width} / ${item.height}` : project?.aspectRatio?.replace(":", " / ") || "9 / 16";
                return (
                  <button
                    key={item.file}
                    className={`block overflow-hidden rounded-lg border bg-white shadow-sm transition-colors hover:border-zinc-500 ${selected ? "border-zinc-950 ring-2 ring-zinc-950/10" : "border-zinc-200"}`}
                    onClick={() => setActiveFile(item.file)}
                  >
                    <div className="grid w-full place-items-center overflow-hidden bg-white" style={{ aspectRatio: ratio }}>
                      <img alt={item.title} src={src} className="h-full w-full object-contain" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-[420px] place-items-center rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">
              <div>
                <div className="text-lg font-medium text-zinc-950">还没有分镜图</div>
                <p className="mt-2 text-sm leading-6">点击生成后，分镜会按顺序一张张出现在画廊里。</p>
                <Button className="mt-4" disabled={!project || locked} onClick={generateAllPages}>生成分镜图</Button>
              </div>
            </div>
          )}
        </section>

        <aside className="bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{activeItem?.title || "分镜预览"}</div>
              <div className="mt-1 font-mono text-xs text-zinc-500">{activeItem?.file || "未选择分镜"}</div>
            </div>
            {activeItem ? <Badge variant="secondary">{activeItem.width}x{activeItem.height}</Badge> : null}
          </div>
          {activeItem ? (
            <div className="grid gap-3">
              {imageSrc ? (
                <button className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950" onClick={() => window.open(imageSrc, "_blank", "noopener,noreferrer")}>
                  <img alt={activeItem.title} src={imageSrc} className="max-h-[360px] w-full object-contain" />
                </button>
              ) : null}
              <InfoTile label="时间" value={`${formatTime(activeItem.start)}-${formatTime(activeItem.end)}`} />
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-2 text-xs uppercase text-zinc-500">生成提示</div>
                <ScrollArea className="h-56 pr-3">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-600">{activeItem.prompt || "未记录提示词"}</p>
                </ScrollArea>
              </div>
              <Button disabled={locked} onClick={() => regenerateStoryboard(activeItem.file)}>重新生成当前分镜</Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-200 p-6 text-sm text-zinc-500">选择一个分镜后查看图片和提示。</div>
          )}
        </aside>
      </CardContent>
    </Card>
  );
}

function VideoCard({ project, locked, job, onRefresh, onRender, onSaveVideoSettings }: {
  project: Project | null;
  locked: boolean;
  job: Job | null;
  onRefresh: () => Promise<Project[]>;
  onRender: () => Promise<void>;
  onSaveVideoSettings: (videoSettings: VideoSettings) => Promise<void>;
}) {
  const storyboards = project?.storyboards || [];
  const canRender = Boolean(project?.voiceover && storyboards.length);
  const finalSrc = project?.finalVideo ? `${projectAssetPath(project.id, project.finalVideo)}?v=${encodeURIComponent(project.updatedAt || project.finalVideo)}` : "";
  const settings = project?.videoSettings || { captionsEnabled: true, captionPosition: "bottom", bgmEnabled: true, playbackSpeed: 1 };
  const [draftSettings, setDraftSettings] = React.useState<VideoSettings>(settings);
  const previousRenderJobActive = React.useRef(false);

  React.useEffect(() => {
    setDraftSettings({
      captionsEnabled: settings.captionsEnabled,
      captionPosition: settings.captionPosition,
      bgmEnabled: settings.bgmEnabled,
      playbackSpeed: settings.playbackSpeed ?? 1,
    });
  }, [settings.captionsEnabled, settings.captionPosition, settings.bgmEnabled, settings.playbackSpeed, project?.id]);

  const settingsChanged = draftSettings.captionsEnabled !== settings.captionsEnabled
    || draftSettings.captionPosition !== settings.captionPosition
    || draftSettings.bgmEnabled !== settings.bgmEnabled
    || draftSettings.playbackSpeed !== (settings.playbackSpeed ?? 1);
  const renderFailed = job?.status === "failed";
  const renderError = renderFailed ? summarizeRenderError(job?.error || job.logs?.slice(-1)[0] || "渲染失败") : "";

  React.useEffect(() => {
    const active = Boolean(job && isJobActive(job));
    const wasActive = previousRenderJobActive.current;
    previousRenderJobActive.current = active;
    if (wasActive && !active && job && ["done", "failed", "cancelled"].includes(job.status)) {
      onRefresh().catch(() => undefined);
    }
  }, [job?.id, job?.status, onRefresh]);

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>视频</CardTitle>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canRender || locked} onClick={onRender}>渲染最终视频</Button>
          {project?.finalVideo ? <Button variant="outline" asChild><a href={projectAssetPath(project.id, project.finalVideo)} target="_blank">导出 MP4</a></Button> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {renderError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">
            {renderError}
          </div>
        ) : null}
        <div className="rounded-lg border border-zinc-200 bg-zinc-950 p-4">
          <div className="grid place-items-center rounded-md bg-black/30 p-3">
            {project?.finalVideo ? (
              <FinalVideoPlayer src={finalSrc} aspectRatio={project.aspectRatio} />
            ) : (
              <div className="mx-auto grid aspect-[9/16] h-[64vh] min-h-[460px] max-h-[820px] w-auto max-w-full place-items-center rounded-md border border-dashed border-zinc-700 bg-zinc-900 p-6 text-center text-zinc-300">
                <div>
                  <div className="text-lg font-medium text-white">还没有最终视频</div>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    {canRender ? "点击渲染最终视频后，这里会播放真正导出的 MP4。" : "先生成分镜图和完整旁白，再渲染最终视频。"}
                  </p>
                  <Button className="mt-4" disabled={!canRender || locked} onClick={onRender}>渲染最终视频</Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">视频设置</div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">设置只影响下一次渲染，当前已生成的视频不会被改动。</p>
            </div>
            <Button disabled={!project || locked} onClick={() => onSaveVideoSettings(draftSettings)}>
              {settingsChanged ? "保存设置" : "重新保存"}
            </Button>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-4">
            <label className="flex min-h-24 items-start gap-3 rounded-lg border border-zinc-200 p-4">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-zinc-950"
                checked={draftSettings.captionsEnabled}
                onChange={(event) => setDraftSettings((current) => ({ ...current, captionsEnabled: event.target.checked }))}
                disabled={locked}
              />
              <span>
                <span className="block text-sm font-medium">开启字幕</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">渲染时把旁白字幕烧进最终视频。</span>
              </span>
            </label>

            <div className="rounded-lg border border-zinc-200 p-4">
              <div className="text-sm font-medium">字幕位置</div>
              <RadioGroup
                value={draftSettings.captionPosition}
                onValueChange={(value) => setDraftSettings((current) => ({ ...current, captionPosition: value as VideoSettings["captionPosition"] }))}
                className="mt-3 grid grid-cols-3 gap-2"
                disabled={locked || !draftSettings.captionsEnabled}
              >
                {[
                  { value: "top", label: "顶部" },
                  { value: "middle", label: "中部" },
                  { value: "bottom", label: "底部" },
                ].map((item) => (
                  <label key={item.value} className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border p-2 text-sm ${draftSettings.captionPosition === item.value ? "border-zinc-950 bg-zinc-50" : "border-zinc-200"}`}>
                    <RadioGroupItem value={item.value} />
                    {item.label}
                  </label>
                ))}
              </RadioGroup>
            </div>

            <label className="flex min-h-24 items-start gap-3 rounded-lg border border-zinc-200 p-4">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-zinc-950"
                checked={draftSettings.bgmEnabled}
                onChange={(event) => setDraftSettings((current) => ({ ...current, bgmEnabled: event.target.checked }))}
                disabled={locked}
              />
              <span>
                <span className="block text-sm font-medium">混入 BGM</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">渲染时加入默认背景音乐。</span>
              </span>
            </label>

            <div className="rounded-lg border border-zinc-200 p-4">
              <div className="text-sm font-medium">整体速度</div>
              <RadioGroup
                value={String(draftSettings.playbackSpeed ?? 1)}
                onValueChange={(value) => setDraftSettings((current) => ({ ...current, playbackSpeed: Number(value) }))}
                className="mt-3 grid grid-cols-2 gap-2"
                disabled={locked}
              >
                {[1, 1.1, 1.2, 1.3].map((speed) => (
                  <label key={speed} className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border p-2 text-sm ${Number(draftSettings.playbackSpeed ?? 1) === speed ? "border-zinc-950 bg-zinc-50" : "border-zinc-200"}`}>
                    <RadioGroupItem value={String(speed)} />
                    {speed.toFixed(1)}x
                  </label>
                ))}
              </RadioGroup>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function summarizeRenderError(error: string) {
  if (error.includes("No such filter: 'subtitles'") || error.includes("Filter not found")) {
    return "渲染失败：当前 FFmpeg 不支持 subtitles 滤镜。你的视频页开启了字幕，所以无法烧录字幕。请换一个支持 libass/subtitles 的 FFmpeg，或在视频设置里关闭字幕后重新渲染。";
  }
  const firstLine = error.split(/\r?\n/).find((line) => line.trim());
  return `渲染失败：${firstLine || error}`;
}

function JobPanel({ job, onCancel }: { job: Job | null; onCancel: () => Promise<void> }) {
  if (!job) return null;
  const running = job.status === "running" || job.status === "cancelling";
  return (
    <Card className="mt-4">
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">{job.label}</div>
            <div className="text-sm text-zinc-500">{job.status}</div>
          </div>
          {running && (
            <Button variant="outline" onClick={onCancel} disabled={job.status === "cancelling"}>
              <PauseCircle className="h-4 w-4" />
              停止任务
            </Button>
          )}
        </div>
        <pre className="max-h-36 overflow-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">{(job.logs || []).slice(-24).join("\n") || job.error || ""}</pre>
      </CardContent>
    </Card>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
