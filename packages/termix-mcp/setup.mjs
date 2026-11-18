#!/usr/bin/env node
/**
 * One-time setup: writes ~/.termix-mcp.json, checks the CLI can reach Termix,
 * and prints the two client snippets. No dependencies, no service.
 *
 *   node setup.mjs --url http://127.0.0.1:30001 --key tmx_... --exec read-only
 *   node setup.mjs --test
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { CONFIG_FILE, DEFAULTS, loadConfig, redact } from "./src/config.mjs";
import { resolveCliEntry, runTermix } from "./src/cli.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, "bin", "termix-mcp.mjs");

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [flag, inline] = token.slice(2).split("=");
    if (inline !== undefined) {
      out[flag] = inline;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      out[flag] = argv[index + 1];
      index += 1;
    } else {
      out[flag] = true;
    }
  }
  return out;
}

function readRawConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function ask(rl, question, fallback) {
  const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `)).trim();
  return answer || fallback || "";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const testOnly = Boolean(args.test);
  const config = { ...DEFAULTS, ...readRawConfig() };

  if (!testOnly) {
    const cliEntry = resolveCliEntry();
    if (!cliEntry) {
      console.log(
        "! The Termix CLI was not found. Install it first:\n    npm install -g @termix-ssh/cli",
      );
    } else {
      console.log(`✓ termix CLI: ${cliEntry}`);
    }

    const interactive = !args.url && !args.key && process.stdin.isTTY;
    let rl;
    if (interactive) rl = createInterface({ input: process.stdin, output: process.stdout });

    config.url = args.url || (interactive ? await ask(rl, "Termix URL", config.url) : config.url);
    config.apiKey =
      args.key || (interactive ? await ask(rl, "API key (tmx_..., input is visible)", "") : config.apiKey);
    config.allowExec =
      args.exec ||
      (interactive
        ? await ask(rl, 'Command mode: off | read-only | all', config.allowExec)
        : config.allowExec);

    if (rl) await rl.close();

    writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(`✓ wrote ${CONFIG_FILE}`);
  }

  const loaded = loadConfig();
  if (!loaded.apiKey) {
    console.log("! No API key in the config. Create one in Termix: Settings → API keys → New.");
    printSnippets(loaded);
    process.exitCode = 1;
    return;
  }

  const result = await runTermix(["version"], loaded, { timeoutMs: 20000 });
  if (result.code === 0) {
    console.log("✓ Termix answered:");
    console.log(String(result.stdout).trim().split("\n").map((line) => `    ${line}`).join("\n"));
  } else {
    console.log("✗ Termix did not answer cleanly:");
    console.log(redact(`${result.stderr || result.stdout}`.trim(), loaded));
    process.exitCode = 1;
  }

  printSnippets(loaded);
}

function printSnippets(config) {
  const nodePath = process.execPath;
  const serverPath = resolve(serverEntry);

  console.log("\n── Claude Code ──────────────────────────────────────────────");
  console.log(
    `claude mcp add termix -s user -- "${nodePath}" "${serverPath}"`,
  );

  console.log("\n── DeepSeek Harness (设置 → MCP, stdio) ──────────────────────");
  console.log(
    JSON.stringify(
      {
        servers: {
          termix: {
            transport: "stdio",
            command: nodePath,
            args: [serverPath],
            enabled: true,
          },
        },
      },
      null,
      2,
    ),
  );

  console.log("\n── Any other MCP client ────────────────────────────────────");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          termix: { command: nodePath, args: [serverPath] },
        },
      },
      null,
      2,
    ),
  );

  console.log(
    `\nmode: allowExec=${config.allowExec}  maxOutput=${config.maxOutput}  hosts=${
      config.hosts.length ? config.hosts.join(",") : "all"
    }`,
  );
  console.log("turn it off: add \"enabled\": false to the config file, or delete the MCP entry.");
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
