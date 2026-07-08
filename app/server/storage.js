const fsp = require("fs/promises");
const path = require("path");
const { PROJECTS_DIR } = require("./config");

function safeId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function projectPath(projectId, ...parts) {
  const safe = safeId(projectId);
  if (!safe) throw new Error("Invalid project id");
  const target = path.join(PROJECTS_DIR, safe, ...parts);
  const allowed = path.join(PROJECTS_DIR, safe);
  if (target !== allowed && !target.startsWith(`${allowed}${path.sep}`)) throw new Error("Invalid project path");
  return target;
}

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

module.exports = { safeId, projectPath, exists, readJson, writeJson };
