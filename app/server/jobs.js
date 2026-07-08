const { now } = require("./time");

const jobs = new Map();

function createJob(label, runner, options = {}) {
  const id = `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const controller = new AbortController();
  const job = {
    id,
    label,
    projectId: options.projectId || null,
    type: options.type || "general",
    status: "running",
    logs: [],
    meta: options.meta || {},
    createdAt: now(),
    updatedAt: now(),
    result: null,
    error: null,
    cancellable: true,
    controller,
  };
  jobs.set(id, job);
  const log = (line) => {
    job.logs.push(...String(line).split(/\r?\n/).filter(Boolean).slice(-20));
    job.logs = job.logs.slice(-120);
    job.updatedAt = now();
  };
  Promise.resolve()
    .then(() => runner(log, controller.signal, job))
    .then((result) => {
      if (controller.signal.aborted) {
        job.status = "cancelled";
        job.error = "Job cancelled";
        job.updatedAt = now();
        return;
      }
      job.status = "done";
      job.result = result || null;
      job.updatedAt = now();
    })
    .catch((error) => {
      job.status = controller.signal.aborted || error.message === "Job cancelled" ? "cancelled" : "failed";
      job.error = error.message;
      job.updatedAt = now();
    });
  return job;
}

function publicJob(job) {
  if (!job) return null;
  const { controller, ...safe } = job;
  return safe;
}

function canRunTogether(existingType, nextType) {
  const concurrent = new Set(["storyboards", "audio"]);
  return concurrent.has(existingType) && concurrent.has(nextType) && existingType !== nextType;
}

function activeProjectJob(projectId, nextType = null) {
  for (const job of jobs.values()) {
    if (job.projectId !== projectId || (job.status !== "running" && job.status !== "cancelling")) continue;
    if (!nextType || !canRunTogether(job.type, nextType)) return job;
  }
  return null;
}

function createProjectJob(projectId, label, type, runner, meta = {}) {
  const active = activeProjectJob(projectId, type);
  if (active) {
    const error = new Error(`Project already has a running task: ${active.label}`);
    error.activeJob = active;
    throw error;
  }
  return createJob(label, runner, { projectId, type, meta });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("Job cancelled");
}

module.exports = { jobs, createJob, publicJob, createProjectJob, throwIfAborted };
