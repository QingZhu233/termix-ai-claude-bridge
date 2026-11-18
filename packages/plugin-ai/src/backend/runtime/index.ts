import { runAgent, type EngineEvent, type EngineOptions } from "../engine.js";
import { runClaude } from "./claude.js";

/**
 * Which agent loop answers a chat turn.
 *
 * `builtin` is the shipped loop: one provider call per step, Termix owns the
 * tools and the proposals. `claude` hands the turn to the local Claude Code
 * CLI, which brings its own loop, memory and tool discipline; Termix still
 * stores the transcript and still renders whatever tools report back.
 */
export type EngineId = "builtin" | "claude";

export const DEFAULT_ENGINE: EngineId = "claude";

/** Durable place for a conversation's engine session id. */
export interface SessionStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

export function normalizeEngine(value: unknown): EngineId {
  if (value === "builtin") return "builtin";
  return DEFAULT_ENGINE;
}

export async function* runAssistant(
  options: EngineOptions & {
    engine?: EngineId;
    sessionStore?: SessionStore;
    /** Where a running turn asks the panel for permission. */
    approval?: { url: string; session: string; auto?: boolean };
    /** auto lets the model decide, guard asks only for destructive work, manual asks always. */
    mode?: "manual" | "auto" | "guard";
  },
): AsyncGenerator<EngineEvent> {
  if (options.engine === "claude") {
    yield* runClaude(
      options,
      options.sessionStore,
      options.approval,
      options.mode ?? "auto",
    );
    return;
  }
  yield* runAgent(options);
}
