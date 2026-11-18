import { checkCommand } from "./guard.mjs";
import { askApproval } from "./approval.mjs";
import {
  CliError,
  describeFailure,
  parseOutput,
  runTermix,
} from "./cli.mjs";
import { redact } from "./config.mjs";

/** Cuts long text in the middle so a log's head and tail both survive. */
export function truncate(text, limit) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  const half = Math.max(1, Math.floor((limit - 60) / 2));
  const cut = value.length - half * 2;
  return `${value.slice(0, half)}\n… [${cut} characters cut] …\n${value.slice(-half)}`;
}

function pack(value, config) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return truncate(redact(text, config), config.maxOutput);
}

function assertHost(config, hostId) {
  if (!hostId) throw new CliError("hostId is required");
  if (config.hosts.length && !config.hosts.includes(String(hostId))) {
    throw new CliError(
      `host ${hostId} is not in the allowed list (${config.hosts.join(", ")})`,
    );
  }
}

async function call(args, config, options) {
  const result = await runTermix(args, config, options);
  if (result.code === 255) {
    throw new CliError(describeFailure(result));
  }
  return result;
}

/**
 * Every tool is one CLI command. Keeping them thin means Termix keeps owning
 * permissions, credentials and auditing; this server only translates.
 */
export function buildTools(config) {
  const tools = [
    {
      name: "termix_version",
      title: "Termix connection check",
      description:
        "Report the CLI version plus the Termix server's health and version. Use this first when another Termix tool fails, to tell an auth problem from a network one.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => pack(await callAndParse(["version"], config), config),
    },
    {
      name: "termix_hosts",
      title: "List Termix hosts",
      description:
        "List the SSH hosts saved in Termix with their ids, addresses, users and tags. Secrets are never printed. Start here: every other tool needs a hostId.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Case-insensitive filter over name, address, user and tags.",
          },
        },
        additionalProperties: false,
      },
      run: async ({ query } = {}) => {
        const hosts = await callAndParse(["hosts", "list"], config);
        const list = normalizeHosts(hosts);
        if (!query) return pack(limitHosts(list, config), config);
        const needle = String(query).toLowerCase();
        const filtered = list.filter((host) =>
          JSON.stringify(host).toLowerCase().includes(needle),
        );
        return pack(limitHosts(filtered, config), config);
      },
    },
    {
      name: "termix_host_get",
      title: "Read one Termix host",
      description:
        "Show one host's saved configuration by id. Credentials are stripped by the CLI, so this is safe to read out loud.",
      inputSchema: {
        type: "object",
        properties: { hostId: { type: "string", description: "Host id from termix_hosts." } },
        required: ["hostId"],
        additionalProperties: false,
      },
      run: async ({ hostId }) => {
        assertHost(config, hostId);
        return pack(await callAndParse(["hosts", "get", String(hostId)], config), config);
      },
    },
    {
      name: "termix_status",
      title: "Online or offline",
      description:
        "Show whether hosts are reachable, by connecting to their port. Pass a hostId for one host.",
      inputSchema: {
        type: "object",
        properties: { hostId: { type: "string", description: "Optional host id." } },
        additionalProperties: false,
      },
      run: async ({ hostId } = {}) => {
        if (hostId) assertHost(config, hostId);
        const args = hostId ? ["status", String(hostId)] : ["status"];
        return pack(await callAndParse(args, config), config);
      },
    },
    {
      name: "termix_snippets",
      title: "Saved snippets",
      description:
        "List the command snippets saved in Termix. Useful when the user has already written down the exact command they run by hand.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => pack(await callAndParse(["snippets", "list"], config), config),
    },
    {
      name: "termix_alerts",
      title: "Alert inbox",
      description: "List the newest Termix alerts, undismissed first.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "How many alerts to return (1-100, default 20).",
          },
        },
        additionalProperties: false,
      },
      run: async ({ limit = 20 } = {}) => {
        const alerts = await callAndParse(["alerts", "list"], config);
        const list = Array.isArray(alerts) ? alerts : alerts?.alerts ?? [];
        const size = Math.min(100, Math.max(1, Number(limit) || 20));
        return pack(list.slice(0, size), config);
      },
    },
    {
      name: "termix_fleets",
      title: "Host fleets",
      description: "List fleets (named groups of hosts) and their ids.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => pack(await callAndParse(["fleets", "list"], config), config),
    },
    {
      name: "termix_plugins",
      title: "Server plugins",
      description:
        "List the Termix plugins on the server and which CLI commands they enable. A command failing with exit code 8 usually means its plugin is off.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => pack(await callAndParse(["plugins", "list"], config), config),
    },
    {
      name: "approval_prompt",
      title: "Ask the user before acting",
      description:
        "Claude Code calls this when a tool is outside its allowlist. It opens a request in the Termix assistant panel and waits for a person to allow or deny it.",
      inputSchema: {
        type: "object",
        properties: {
          tool_name: { type: "string", description: "The tool being requested." },
          input: { type: "object", description: "The arguments the tool would run with." },
          tool_use_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["tool_name"],
        additionalProperties: true,
      },
      run: async ({ tool_name, input, reason } = {}) =>
        JSON.stringify(
          await askApproval({
            toolName: String(tool_name ?? "tool"),
            input: input ?? {},
            reason: typeof reason === "string" ? reason : undefined,
          }),
        ),
    },
  ];

  if (config.allowExec !== "off") {
    tools.push(
      {
        name: "termix_exec",
        title: "Run a command on a host",
        description:
          config.allowExec === "read-only"
            ? "Run one diagnostic command over SSH and return its output. Read-only mode: a single command only, no pipes or redirection, and only allowlisted prefixes (df, free, uptime, ps, ls, ss, journalctl, systemctl status, docker ps/logs, cat /proc|/sys|/etc)."
            : "Run a shell command over SSH on a host and return stdout, stderr and the exit code. This can change the machine.",
        inputSchema: {
          type: "object",
          properties: {
            hostId: { type: "string", description: "Host id from termix_hosts." },
            command: { type: "string", description: "The command to run." },
            timeoutMs: {
              type: "number",
              description: "Optional per-call timeout in milliseconds.",
            },
          },
          required: ["hostId", "command"],
          additionalProperties: false,
        },
        run: async ({ hostId, command, timeoutMs } = {}) => {
          assertHost(config, hostId);
          const verdict = checkCommand(command, config.allowExec);
          if (!verdict.ok) throw new CliError(verdict.reason);

          const result = await runTermix(
            ["exec", String(hostId), String(command)],
            config,
            timeoutMs ? { timeoutMs: Math.trunc(Number(timeoutMs)) } : undefined,
          );
          const body = [
            `exit code: ${result.code}`,
            result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "stdout: (empty)",
            result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n");
          if (result.code === 255) throw new CliError(truncate(body, config.maxOutput));
          return truncate(redact(body, config), config.maxOutput);
        },
      },
      {
        name: "termix_fleet_exec",
        title: "Run a command across a fleet",
        description:
          "Run one command on every host of a fleet. Exits non-zero if any host failed. Use sparingly: this touches several machines at once.",
        inputSchema: {
          type: "object",
          properties: {
            fleetId: { type: "string", description: "Fleet id from termix_fleets." },
            command: { type: "string", description: "The command to run on every host." },
          },
          required: ["fleetId", "command"],
          additionalProperties: false,
        },
        run: async ({ fleetId, command } = {}) => {
          if (!fleetId) throw new CliError("fleetId is required");
          if (config.allowExec !== "all") {
            const verdict = checkCommand(command, "read-only");
            if (!verdict.ok) {
              throw new CliError(`fleet exec is ${config.allowExec}: ${verdict.reason}`);
            }
          }
          return pack(await call(["fleets", "exec", String(fleetId), String(command)], config), config);
        },
      },
    );
  }

  return tools;
}

async function callAndParse(args, config) {
  const result = await call(args, config);
  const parsed = parseOutput(result);
  if (parsed === null) {
    if (result.code !== 0) throw new CliError(describeFailure(result));
    return result.stdout.trim();
  }
  return parsed;
}

function normalizeHosts(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.hosts)) return value.hosts;
  return value;
}

function limitHosts(list, config) {
  if (!Array.isArray(list) || !config.hosts.length) return list;
  return list.filter((host) => {
    const id = String(host?.id ?? host?.hostId ?? "");
    return config.hosts.includes(id);
  });
}
