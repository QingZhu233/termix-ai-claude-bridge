import { randomUUID } from "node:crypto";

/**
 * Pending permission requests for Claude runs.
 *
 * The CLI asks through an MCP tool; that tool calls back into this plugin and
 * waits. The panel renders whatever arrived here and answers, which resolves
 * the wait. Everything is in memory: an unanswered request dies with the run.
 */
export interface PendingApproval {
  id: string;
  session: string;
  toolName: string;
  input: unknown;
  reason?: string;
  createdAt: number;
  decision?: "allow" | "deny";
  waiters: Array<(decision: "allow" | "deny") => void>;
}

export type ApprovalEvent = {
  type: "approval";
  approval: {
    id: string;
    toolName: string;
    input: unknown;
    reason?: string;
  };
};

export function createApprovalHub() {
  const pending = new Map<string, PendingApproval>();
  const emitters = new Map<string, (event: ApprovalEvent) => void>();

  return {
    /** The chat route registers how to reach its panel for one run. */
    attach(session: string, emit: (event: ApprovalEvent) => void) {
      emitters.set(session, emit);
    },
    detach(session: string) {
      emitters.delete(session);
      for (const [id, item] of pending) {
        if (item.session === session) pending.delete(id);
      }
    },

    request(input: {
      session: string;
      toolName: string;
      input: unknown;
      reason?: string;
    }): PendingApproval {
      const approval: PendingApproval = {
        id: randomUUID(),
        session: input.session,
        toolName: input.toolName,
        input: input.input,
        reason: input.reason,
        createdAt: Date.now(),
        waiters: [],
      };
      pending.set(approval.id, approval);
      emitters.get(input.session)?.({ type: "approval", approval: {
        id: approval.id,
        toolName: approval.toolName,
        input: approval.input,
        reason: approval.reason,
      } });
      return approval;
    },

    find(id: string, session: string): PendingApproval | null {
      const item = pending.get(id);
      if (!item || item.session !== session) return null;
      return item;
    },

    /** Resolves the waiting MCP call. The first answer wins. */
    decide(id: string, decision: "allow" | "deny"): boolean {
      const item = pending.get(id);
      if (!item) return false;
      if (!item.decision) {
        item.decision = decision;
        for (const waiter of item.waiters) waiter(decision);
        item.waiters = [];
      }
      return true;
    },

    /** Long poll: resolves as soon as a decision exists. */
    wait(id: string, session: string, timeoutMs: number): Promise<"allow" | "deny" | null> {
      const item = this.find(id, session);
      if (!item) return Promise.resolve(null);
      if (item.decision) return Promise.resolve(item.decision);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        item.waiters.push((decision) => {
          clearTimeout(timer);
          resolve(decision);
        });
      });
    },
  };
}

export type ApprovalHub = ReturnType<typeof createApprovalHub>;
