const { spawn } = require("child_process");

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { onLog, onChild, signal, ...spawnOptions } = options;
    const child = spawn(command, args, spawnOptions);
    onChild?.(child);
    let stdout = "";
    let stderr = "";
    const abort = () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2500).unref?.();
    };
    if (signal) {
      if (signal.aborted) abort();
      signal.addEventListener("abort", abort, { once: true });
    }
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      onLog?.(chunk.toString());
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      onLog?.(chunk.toString());
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", abort);
      if (signal?.aborted) {
        reject(new Error("Job cancelled"));
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr || stdout}`));
    });
  });
}

module.exports = { runCommand };
