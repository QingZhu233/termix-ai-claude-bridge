import { buildTools } from "./tools.mjs";
import { loadConfig, redact } from "./config.mjs";
import { CliError } from "./cli.mjs";

const SERVER_NAME = "termix-mcp";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_FALLBACK = "2024-11-05";

function log(message, config) {
  process.stderr.write(`[termix-mcp] ${redact(message, config)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

/**
 * A stdio MCP server: the client spawns it, it answers, it exits with the
 * client. No port, no background task, nothing left running afterwards.
 */
export function startServer() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    log(`configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const tools = config.enabled ? buildTools(config) : [];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  log(
    `ready: enabled=${config.enabled} tools=${tools.length} allowExec=${config.allowExec} url=${config.url}`,
    config,
  );
  if (!config.apiKey) {
    log(
      "no API key yet: create one in Termix under Settings, API keys, then run `node setup.mjs`",
      config,
    );
  }

  let buffer = "";
  let inflight = 0;
  let ended = false;

  // A client keeps stdin open for the whole session. If it closes, let the
  // calls already running finish their reply before leaving, so a piped
  // smoke test does not lose the answer to its last request.
  const exitWhenDrained = () => {
    if (ended && inflight === 0) process.exit(0);
  };

  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        inflight += 1;
        void handle(line).finally(() => {
          inflight -= 1;
          exitWhenDrained();
        });
      }
      newline = buffer.indexOf("\n");
    }
  });

  process.stdin.on("end", () => {
    ended = true;
    exitWhenDrained();
  });

  async function handle(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, "parse error");
      return;
    }

    const { id, method, params } = message ?? {};
    const isRequest = id !== undefined && id !== null;

    try {
      switch (method) {
        case "initialize": {
          const requested = params?.protocolVersion;
          reply(id, {
            protocolVersion: requested || PROTOCOL_FALLBACK,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions:
              "Termix hosts over SSH. Call termix_hosts first to learn the ids. " +
              (config.allowExec === "read-only"
                ? "termix_exec is limited to single read-only diagnostic commands."
                : config.allowExec === "all"
                  ? "termix_exec can change the machine; prefer read-only commands unless the user asked for a change."
                  : "Running commands is disabled; only inventory tools are available."),
          });
          return;
        }
        case "notifications/initialized":
        case "initialized":
        case "notifications/cancelled":
          return;
        case "ping":
          if (isRequest) reply(id, {});
          return;
        case "tools/list":
          reply(id, {
            tools: tools.map(({ name, title, description, inputSchema }) => ({
              name,
              title,
              description,
              inputSchema,
            })),
          });
          return;
        case "resources/list":
          reply(id, { resources: [] });
          return;
        case "prompts/list":
          reply(id, { prompts: [] });
          return;
        case "tools/call": {
          const name = params?.name;
          const args = params?.arguments ?? {};
          const tool = byName.get(name);
          if (!config.enabled) {
            reply(id, textResult("termix-mcp is disabled in its config file.", true));
            return;
          }
          if (!tool) {
            reply(id, textResult(`Unknown tool: ${name}`, true));
            return;
          }
          try {
            const output = await tool.run(args);
            reply(id, textResult(String(output)));
          } catch (error) {
            const message =
              error instanceof CliError
                ? error.message
                : String(error?.message || error);
            log(`tool ${name} failed: ${message}`, config);
            reply(id, textResult(redact(message, config), true));
          }
          return;
        }
        default:
          if (isRequest) fail(id, -32601, `method not found: ${method}`);
          return;
      }
    } catch (error) {
      if (isRequest) fail(id, -32603, String(error?.message || error));
    }
  }

  const shutdown = () => process.exit(0);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
