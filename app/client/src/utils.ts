import type { Job, Segment } from "./types";

export function formatDate(value?: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(value?: number | null) {
  return value ? `${value.toFixed(1)}s` : "no audio";
}

export function formatTime(value?: number | null) {
  if (!value) return "00:00";
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function segmentVisualDescription(segment: Segment) {
  return segment.visualDescription || "";
}

export function templateName(id?: string) {
  return id === "stickman" || !id ? "火柴人极简解释图" : id;
}

export function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    script_ready: "脚本已生成",
    audio_generating: "音频生成中",
    audio_review: "音频已生成",
    audio_approved: "音频已生成",
    video_ready: "视频已完成",
  };
  return labels[status || ""] || status || "未开始";
}

export function isJobActive(job: Job | null) {
  return job?.status === "running" || job?.status === "cancelling";
}

export function jobKey(job: Job) {
  return `${job.projectId || "global"}:${job.type}`;
}

export function hasActiveBlockingJob(jobsByKey: Record<string, Job>, allowedTypes: string[] = []) {
  return Object.values(jobsByKey).some((job) => isJobActive(job) && !allowedTypes.includes(job.type || ""));
}

export function projectJob(jobsByKey: Record<string, Job>, projectId: string | undefined, type: string) {
  return Object.values(jobsByKey).find((job) => job.projectId === projectId && job.type === type) || null;
}

export function routeProjectId() {
  const match = window.location.hash.match(/^#\/projects\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
