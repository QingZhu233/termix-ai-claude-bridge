import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where setup.mjs writes, and where this server reads, unless overridden. */
export const CONFIG_FILE =
  process.env.TERMIX_MCP_CONFIG || join(homedir(), ".termix-mcp.json");

export const DEFAULTS = {
  // false: the server starts, reports no tools, and does nothing else.
  enabled: true,
  // The desktop app serves its own backend on this port. A self-hosted
  // instance would be https://your-host:8080.
  url: "http://127.0.0.1:30001",
  apiKey: "",
  // "off"     - exec tools are not even listed
  // "read-only" - exec is listed, but only allowlisted diagnostic commands run
  // "all"     - exec runs anything
  allowExec: "read-only",
  // Characters kept from one command result. Longer output is cut in the
  // middle so both the head and the tail survive.
  maxOutput: 4000,
  // Wall clock per CLI call, milliseconds.
  timeoutMs: 60000,
  // Host ids the server may touch. Empty means every host in Termix.
  hosts: [],
};

function readConfigFile() {
  let raw;
  try {
    raw = readFileSync(CONFIG_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Cannot read ${CONFIG_FILE}: ${error.message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the file must hold one JSON object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${error.message}`);
  }
}

function bool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off)$/i.test(value)) return false;
  }
  return fallback;
}

function int(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** File first, environment second, defaults last. Environment always wins. */
export function loadConfig() {
  const file = readConfigFile();
  const config = { ...DEFAULTS, ...file };

  if (process.env.TERMIX_URL) config.url = process.env.TERMIX_URL;
  if (process.env.TERMIX_API_KEY) config.apiKey = process.env.TERMIX_API_KEY;
  if (process.env.TERMIX_MCP_ALLOW_EXEC) {
    config.allowExec = process.env.TERMIX_MCP_ALLOW_EXEC;
  }
  if (process.env.TERMIX_MCP_MAX_OUTPUT) {
    config.maxOutput = process.env.TERMIX_MCP_MAX_OUTPUT;
  }
  if (process.env.TERMIX_MCP_HOSTS) {
    config.hosts = process.env.TERMIX_MCP_HOSTS;
  }

  config.enabled = bool(config.enabled, true);
  config.maxOutput = int(config.maxOutput, DEFAULTS.maxOutput, 200, 200000);
  config.timeoutMs = int(config.timeoutMs, DEFAULTS.timeoutMs, 1000, 600000);
  config.url = String(config.url || "").replace(/\/+$/, "");
  config.apiKey = String(config.apiKey || "").trim();

  if (!["off", "read-only", "all"].includes(config.allowExec)) {
    throw new Error(
      `allowExec must be "off", "read-only" or "all" (got ${JSON.stringify(
        config.allowExec,
      )})`,
    );
  }

  if (typeof config.hosts === "string") {
    config.hosts = config.hosts
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(config.hosts)) config.hosts = [];
  config.hosts = config.hosts.map(String);

  return config;
}

/** Never let the key reach a log line or a tool result. */
export function redact(text, config) {
  if (!config?.apiKey) return text;
  return String(text).split(config.apiKey).join("[redacted]");
}
