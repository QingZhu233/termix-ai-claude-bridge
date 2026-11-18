import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EngineEvent, EngineOptions } from "../engine.js";
import type { ChatMessage } from "../providers/types.js";
import type { SessionStore } from "./index.js";
import { resolveClaudeChoice } from "./claude-config.js";

/**
 * The Claude runtime: hand the turn to the local `claude` CLI instead of
 * driving a provider ourselves. The CLI brings its own agent loop, its own
 * memory of the turn and its own tools; Termix keeps the transcript, the
 * proposals and the permissions.
 *
 * Tools come from the termix-mcp server we already run, so the model reaches
 * hosts through Termix rather than through a shell on this machine.
 */

const EXE_TAIL = join(
  "node_modules",
  "@anthropic-ai",
  "claude-code",
  "bin",
  "claude.exe",
);

/** Claude Code ships a native binary; use it directly so argv needs no shell. */
export function resolveClaudeExe(): string | null {
  const override = process.env.CLAUDE_CODE_EXE;
  if (override && existsSync(override)) return override;

  // Termix's backend is not a node.exe, so process.execPath points at the app.
  // Ask PATH where the shim lives and look for the package beside it.
  const pathDirs = (process.env.PATH || "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter(Boolean);
  const candidates: string[] = [
    join(process.env.USERPROFILE || "", ".local", "bin", "claude.exe"),
    join(process.env.APPDATA || "", "npm", EXE_TAIL),
    join(process.env.LOCALAPPDATA || "", "npm", EXE_TAIL),
  ];
  for (const dir of pathDirs) {
    candidates.push(join(dir, "claude.exe"));
    candidates.push(join(dir, EXE_TAIL));
  }
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

/** The termix-mcp entry, resolved next to this plugin's own install. */
function resolveTermixMcp(): string | null {
  const override = process.env.TERMIX_MCP_ENTRY;
  if (override && existsSync(override)) return override;
  const candidates = [
    join(process.cwd(), "..", "termix-mcp", "bin", "termix-mcp.mjs"),
    join(
      process.env.USERPROFILE || "",
      "Documents",
      "deepseek-harness",
      "default-workspace",
      "termix-mcp",
      "bin",
      "termix-mcp.mjs",
    ),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

/** How many stored turns to replay into the prompt. */
const HISTORY_TURNS = 12;
/** Longest transcript handed to one run, in characters. */
const HISTORY_CHARS = 24_000;

function renderHistory(history: ChatMessage[]): string {
  const lines: string[] = [];
  for (const message of history) {
    if (message.role === "user") lines.push(`User: ${message.content}`);
    else if (message.role === "assistant" && message.content)
      lines.push(`Assistant: ${message.content}`);
    else if (message.role === "tool")
      lines.push(`Tool result (${message.toolName ?? "tool"}): ${message.content}`);
  }
  let text = lines.join("\n\n");
  if (text.length > HISTORY_CHARS) text = text.slice(-HISTORY_CHARS);
  return text;
}

function buildPrompt(options: EngineOptions): string {
  const prior = renderHistory(options.history);
  const latest = options.history[options.history.length - 1];
  const question = latest?.role === "user" ? latest.content : "";
  const head = prior.endsWith(question)
    ? prior.slice(0, prior.length - question.length)
    : prior;
  return [
    "You are answering inside Termix, an SSH server manager.",
    "Reach hosts only through the termix_* MCP tools; never assume a shell on this machine.",
    "Call termix_hosts first when you need a host id.",
    "Answer in the same language the user wrote in.",
    head.trim() ? `Earlier in this conversation:\n${head.trim()}` : "",
    `Now answer this:\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface JsonLine {
  type?: string;
  subtype?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
    content_block?: { type?: string; id?: string; name?: string };
  };
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
  result?: string;
  is_error?: boolean;
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Claude keeps its own transcript; remember which session belongs to which chat. */
const sessions = new Map<number, string>();

const sessionKey = (conversationId: number) => `claude-session:${conversationId}`;

/** Drops a stored session so the next turn starts clean again. */
export function forgetClaudeSession(conversationId: number): void {
  sessions.delete(conversationId);
}

/**
 * Streams one Claude run as Termix's own event vocabulary, so the existing
 * chat UI renders it without knowing which engine answered.
 */
export async function* runClaude(
  options: EngineOptions,
  store?: SessionStore,
  approval?: { url: string; session: string; auto?: boolean },
  mode: "manual" | "auto" | "guard" = "auto",
): AsyncGenerator<EngineEvent> {
  const exe = resolveClaudeExe();
  if (!exe) {
    yield {
      type: "error",
      message:
        "Claude Code was not found. Install it (npm i -g @anthropic-ai/claude-code) or set CLAUDE_CODE_EXE.",
    };
    return;
  }

  const mcpEntry = resolveTermixMcp();
  const mcpConfig = mcpEntry
    ? JSON.stringify({
        mcpServers: {
          termix: {
            command: process.execPath,
            args: [mcpEntry],
            ...(approval
              ? {
                  env: {
                    TERMIX_APPROVAL_URL: approval.url,
                    TERMIX_APPROVAL_SESSION: approval.session,
                    TERMIX_APPROVAL_AUTO:
                      approval.auto === false ? "off" : "on",
                  },
                }
              : {}),
          },
        },
      })
    : null;

  // Reading is free; anything that changes a host goes through the panel.
  const READ_TOOLS = [
    "mcp__termix__termix_version",
    "mcp__termix__termix_hosts",
    "mcp__termix__termix_host_get",
    "mcp__termix__termix_status",
    "mcp__termix__termix_snippets",
    "mcp__termix__termix_alerts",
    "mcp__termix__termix_fleets",
    "mcp__termix__termix_plugins",
    "WebFetch",
    "WebSearch",
    "Read",
    "Glob",
    "Grep",
    "LS",
  ];
  const WRITE_TOOLS = ["mcp__termix__termix_exec", "mcp__termix__termix_fleet_exec"];

  const allowed =
    mode === "manual"
      ? READ_TOOLS
      : mode === "guard"
        ? READ_TOOLS
        : [...READ_TOOLS, ...WRITE_TOOLS];
  const allowedTools = allowed.join(",");

  // auto hands the judgement to the model: no cards, nothing routed to us.
  // guard keeps the destructive list; manual asks for everything.
  const permissionArgs =
    mode === "auto"
      ? ["--permission-mode", "acceptEdits"]
      : [
          "--permission-mode",
          mode === "guard" ? "acceptEdits" : "default",
          ...(approval ? ["--permission-prompt-tool", "mcp__termix__approval_prompt"] : []),
        ];

  const conversationId = options.context.conversationId;
  if (!sessions.has(conversationId) && store) {
    const saved = await store.get(sessionKey(conversationId));
    if (typeof saved === "string" && saved) sessions.set(conversationId, saved);
  }
  const resumeId = sessions.get(conversationId);
  const latestTurn = options.history[options.history.length - 1];
  const question = latestTurn?.role === "user" ? latestTurn.content : "";

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    ...permissionArgs,
    // A resumed session already carries the system prompt and the history.
    ...(resumeId ? ["--resume", resumeId] : ["--append-system-prompt", options.system]),
    // A cc-switch alias ("claude-opus-5[1M]") is a real --model value; the
    // placeholder "claude" only means "no choice was made".
    ...(options.model && options.model !== "claude"
      ? ["--model", resolveClaudeChoice(options.model)]
      : []),
    ...(mcpConfig
      ? ["--mcp-config", mcpConfig, "--strict-mcp-config", "--allowedTools", allowedTools]
      : []),
  ];

  const env = { ...process.env };
  // Only an Anthropic provider may steer the CLI; an OpenAI-compatible row
  // would point it at a URL that does not speak /v1/messages. Otherwise the
  // CLI keeps whatever cc-switch configured, which is the point.
  if (options.config.providerType === "anthropic") {
    if (options.config.apiKey) env.ANTHROPIC_API_KEY = String(options.config.apiKey);
    if (options.config.baseUrl) env.ANTHROPIC_BASE_URL = String(options.config.baseUrl);
  }

  const child = spawn(exe, args, {
    env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const aborted = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
  };
  options.signal?.addEventListener("abort", aborted, { once: true });

  child.stdin.end(resumeId && question ? question : buildPrompt(options));

  let buffer = "";
  let assistantText = "";
  const seenTools = new Set<string>();
  /** Tool call id → name, so a result can be attached to the card that asked. */
  const nameById = new Map<string, string>();
  let failure = "";
  let result = "";

  const handle = (line: string): EngineEvent[] => {
    const events: EngineEvent[] = [];
    let parsed: JsonLine;
    try {
      parsed = JSON.parse(line) as JsonLine;
    } catch {
      return events;
    }
    // Every frame carries the session it belongs to; keep the latest one so
    // the next turn resumes this very conversation instead of rebuilding it.
    if (parsed.session_id) {
      sessions.set(conversationId, parsed.session_id);
      if (store) void store.set(sessionKey(conversationId), parsed.session_id);
    }

    // Token-level deltas, when the CLI sends them.
    if (parsed.type === "stream_event") {
      const delta = parsed.event?.delta;
      if (delta?.type === "text_delta" && delta.text) {
        assistantText += delta.text;
        events.push({ type: "token", text: delta.text });
      }
      return events;
    }

    if (parsed.type === "assistant" || parsed.type === "user") {
      for (const block of parsed.message?.content ?? []) {
        if (block.type === "tool_use" && block.id && !seenTools.has(block.id)) {
          seenTools.add(block.id);
          nameById.set(block.id, block.name ?? "tool");
          events.push({
            type: "tool_call",
            name: block.name ?? "tool",
            arguments: block.input ?? {},
          });
        } else if (block.type === "tool_result") {
          const id = block.tool_use_id ?? "";
          events.push({
            type: "tool_result",
            name: nameById.get(id) ?? "tool",
            result: block.content ?? "",
          });
        } else if (
          block.type === "text" &&
          parsed.type === "assistant" &&
          !assistantText
        ) {
          // No delta stream: fall back to the finished block.
          assistantText += block.text ?? "";
          events.push({ type: "token", text: block.text ?? "" });
        }
      }
      return events;
    }

    if (parsed.type === "result") {
      result = parsed.result ?? "";
      if (parsed.is_error) failure = result || "Claude reported an error";
      // The CLI reports what the turn cost; feed the existing usage meter so
      // the assistant's token counter reflects Claude runs too.
      const usage = parsed.usage;
      if (usage) {
        const promptTokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
        events.push({
          type: "usage",
          usage: {
            source: "assistant",
            promptTokens,
            completionTokens: usage.output_tokens ?? 0,
            estimated: false,
          },
        });
      }
      return events;
    }

    if (parsed.type === "system" && parsed.subtype === "error") {
      failure = JSON.stringify(parsed).slice(0, 500);
    }
    return events;
  };

  try {
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) for (const event of handle(line)) yield event;
        index = buffer.indexOf("\n");
      }
    }
  } finally {
    options.signal?.removeEventListener("abort", aborted);
  }

  const exitCode = await new Promise<number>((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once("close", (code) => resolve(code ?? -1));
  });

  if (options.signal?.aborted) return;

  if (failure) {
    yield { type: "error", message: failure };
    return;
  }
  if (exitCode !== 0 && !assistantText) {
    yield {
      type: "error",
      message: `Claude exited with code ${exitCode}. Check that cc-switch points it at a working endpoint.`,
    };
    return;
  }

  const final = result || assistantText;
  // The route appends its own "done" after the loop, so this emits only the
  // assistant message it will store.
  yield { type: "message", message: { role: "assistant", content: final } };
}
