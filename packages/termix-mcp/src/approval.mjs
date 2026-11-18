/**
 * Asks the Termix assistant panel whether a tool may run.
 *
 * Claude Code calls an MCP tool named on --permission-prompt-tool whenever it
 * wants something outside its allowlist. That tool lands here: we open a
 * request with the plugin, then wait for the human to press allow or deny in
 * the panel. No answer in time means no.
 */

const TIMEOUT_MS = 110_000;

import { loadConfig } from "./config.mjs";
import { checkCommand } from "./guard.mjs";

/** Read-only Termix calls the panel does not need to see. */
const SAFE_TOOLS = new Set([
  "mcp__termix__termix_version",
  "mcp__termix__termix_hosts",
  "mcp__termix__termix_host_get",
  "mcp__termix__termix_status",
  "mcp__termix__termix_snippets",
  "mcp__termix__termix_alerts",
  "mcp__termix__termix_fleets",
  "mcp__termix__termix_plugins",
]);

/**
 * Commands that can end the machine or its data. Even auto mode stops for
 * these: they are the one class where a misread prompt costs more than a
 * click.
 */
const DESTRUCTIVE = [
  /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+\/(\s|$|\*)/,
  /\bmkfs(\.[a-z0-9]+)?\b/,
  /\bdd\b[^\n]*\bof=\/dev\//,
  /\b(shutdown|reboot|poweroff|halt)\b/,
  /\biptables\s+(-F|--flush)\b/,
  /\bnft\s+flush\b/,
  /\buserdel\b/,
  /\bpasswd\s/,
  /\bchmod\s+-R\s+777\s+\//,
  /\bdocker\s+(system|volume|image)\s+prune\b/,
  /\bgit\s+push\s+.*--force\b/,
  />\s*\/etc\//,
];

function isDestructive(command) {
  return DESTRUCTIVE.some((pattern) => pattern.test(command));
}

/**
 * What auto mode swallows: everything except the destructive list. Manual
 * turns every call into a card; bypass never reaches this function.
 */
function autoApproved(toolName, input) {
  const mode = process.env.TERMIX_APPROVAL_AUTO;
  if (mode === "off") return false;
  if (SAFE_TOOLS.has(toolName)) return true;

  const isExec =
    toolName === "mcp__termix__termix_exec" ||
    toolName === "mcp__termix__termix_fleet_exec";
  if (!isExec) return false;

  const command = String(input?.command ?? "");
  return !isDestructive(command);
}

function channel() {
  const url = process.env.TERMIX_APPROVAL_URL;
  const session = process.env.TERMIX_APPROVAL_SESSION;
  if (!url || !session) return null;
  // The plugin's routes sit behind Termix's login, so reuse the API key this
  // server already holds; the session token says which run is asking.
  let authorization = "";
  try {
    const apiKey = loadConfig().apiKey;
    if (apiKey) authorization = `Bearer ${apiKey}`;
  } catch {
    // No config: the request will be refused, which is the safe answer.
  }
  return { url: url.replace(/\/+$/, ""), session, authorization };
}

export async function askApproval({ toolName, input, reason }) {
  if (autoApproved(toolName, input)) return { behavior: "allow" };

  const chan = channel();
  if (!chan) {
    return {
      behavior: "deny",
      message: "No approval channel is configured, so the action was refused.",
    };
  }

  let id;
  try {
    const created = await fetch(`${chan.url}/approvals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Approval-Session": chan.session,
        ...(chan.authorization
          ? { Authorization: chan.authorization }
          : {}),
      },
      body: JSON.stringify({ toolName, input, reason }),
    });
    if (!created.ok) throw new Error(`HTTP ${created.status}`);
    ({ id } = await created.json());
  } catch (error) {
    return {
      behavior: "deny",
      message: `The approval request could not be opened: ${error.message}`,
    };
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `${chan.url}/approvals/${encodeURIComponent(id)}`,
        {
          headers: {
            "X-Approval-Session": chan.session,
            ...(chan.authorization
              ? { Authorization: chan.authorization }
              : {}),
          },
          signal: AbortSignal.timeout(25_000),
        },
      );
      if (response.status === 408) continue;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.decision === "allow") return { behavior: "allow" };
      if (body.decision === "deny") {
        return { behavior: "deny", message: "The user denied this action." };
      }
    } catch {
      // Keep waiting: a long poll that times out is still a pending request.
    }
  }
  return { behavior: "deny", message: "Nobody answered the approval in time." };
}
