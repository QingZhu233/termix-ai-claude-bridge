import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const TAIL = join("node_modules", "@termix-ssh", "cli", "dist", "index.js");

/**
 * The CLI ships as one ESM file. Running it through `node` instead of the
 * `termix` shim keeps arguments out of a shell, so a command like
 * `df -h | head` reaches the CLI exactly as written.
 */
export function resolveCliEntry() {
  const override = process.env.TERMIX_CLI_JS;
  if (override && existsSync(override)) return override;

  // The caller is often not node.exe (Termix's backend is an Electron app), so
  // process.execPath is not where the global packages live. Ask PATH instead.
  const pathDirs = (process.env.PATH || "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter(Boolean);
  const candidates = [
    join(process.env.APPDATA || "", "npm", TAIL),
    join(process.env.LOCALAPPDATA || "", "npm", TAIL),
    join(process.env.ProgramFiles || "", "nodejs", TAIL),
  ];
  for (const dir of pathDirs) candidates.push(join(dir, TAIL));
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export class CliError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "CliError";
    this.details = details;
  }
}

/**
 * Runs one CLI command. The API key travels in the environment, never in
 * argv, so it does not sit in the process list for anyone to read.
 */
export function runTermix(args, config, { timeoutMs } = {}) {
  const entry = resolveCliEntry();
  const command = entry ? process.execPath : "termix";
  const argv = entry
    ? [entry, "--url", config.url, "--json", ...args]
    : ["--url", config.url, "--json", ...args];

  const env = { ...process.env };
  delete env.TERMIX_TOKEN;
  if (config.apiKey) env.TERMIX_API_KEY = config.apiKey;
  env.TERMIX_URL = config.url;
  env.NO_COLOR = "1";

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, argv, {
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ code: -1, stdout: "", stderr: String(error?.message || error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const limit = timeoutMs ?? config.timeoutMs;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      resolve({
        code: -1,
        stdout,
        stderr: `timed out after ${limit} ms`,
        timedOut: true,
      });
    }, limit);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(error?.message || error) });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** JSON when the CLI printed JSON, raw text otherwise. */
export function parseOutput(result) {
  const text = (result.stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The CLI answers auth and permission problems on stderr with a phrase worth
 * repeating to the model verbatim.
 */
export function describeFailure(result) {
  const stderr = (result.stderr || "").trim();
  const stdout = (result.stdout || "").trim();
  if (result.timedOut) return stderr || "the Termix CLI timed out";
  if (stderr) return stderr;
  if (stdout) return stdout;
  return `termix exited with code ${result.code}`;
}
