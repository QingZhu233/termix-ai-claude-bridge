import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * What cc-switch actually applied to Claude Code.
 *
 * cc-switch writes ~/.claude/settings.json and points ANTHROPIC_BASE_URL at
 * its own local proxy. Each role carries three values: the alias Claude Code
 * accepts on --model, the display name it shows, and a description. This
 * module surfaces all three so the Termix picker reads like the CLI's.
 */

export interface ClaudeModelOption {
  /** Opus, Sonnet, Haiku — the role cc-switch calls the mapping by. */
  tier: string;
  /** The alias Claude Code accepts on --model. */
  alias: string;
  /** The name cc-switch shows in its mapping table. */
  display: string;
  /** `Sonnet · deepseek-v4.1-flash`, what this picker shows. */
  label: string;
}

export interface ClaudeConfigSnapshot {
  models: ClaudeModelOption[];
  baseUrl?: string;
  proxy: boolean;
  file: string;
}

const TIERS: Array<{ tier: string; key: string }> = [
  { tier: "Opus", key: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { tier: "Sonnet", key: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { tier: "Haiku", key: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
  { tier: "Fable", key: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  { tier: "Subagent", key: "ANTHROPIC_DEFAULT_SUBAGENT_MODEL" },
];

/** cc-switch writes "·" as a byte-mangled "路" in these strings. */
function tidy(value: string | undefined): string {
  return (value ?? "").replace(/\s*路\s*/g, " · ").trim();
}

export function readClaudeConfig(): ClaudeConfigSnapshot | null {
  const file = join(homedir(), ".claude", "settings.json");
  let parsed: { env?: Record<string, string> };
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const env = parsed.env ?? {};
  const models: ClaudeModelOption[] = [];
  for (const { tier, key } of TIERS) {
    const alias = env[key];
    if (!alias) continue;
    const display = tidy(env[`${key}_NAME`]);
    const description = tidy(env[`${key}_DESCRIPTION`]);
    const label = [tier, display || description].filter(Boolean).join(" · ");
    models.push({ tier, alias, display, label });
  }
  return {
    models,
    baseUrl: env.ANTHROPIC_BASE_URL,
    proxy: env.ANTHROPIC_AUTH_TOKEN === "PROXY_MANAGED",
    file,
  };
}

/**
 * The picker hands back a label (`Sonnet · deepseek-v4.1-flash`), while the
 * CLI wants the alias. Anything unrecognised passes through untouched, so a
 * plain alias typed by hand still works.
 */
export function resolveClaudeChoice(choice: string): string {
  const snapshot = readClaudeConfig();
  if (!snapshot) return choice;
  const wanted = choice.split("·")[0].trim().toLowerCase();
  const hit = snapshot.models.find(
    (model) => model.tier.toLowerCase() === wanted,
  );
  return hit?.alias ?? choice;
}
