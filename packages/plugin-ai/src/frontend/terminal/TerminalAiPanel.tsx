import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Bot, GripVertical, Loader2, Paperclip, Send, Square, X } from "lucide-react";
import { Button } from "@termix-ssh/plugin-sdk/ui";
import {
  AI_PROVIDERS_CHANGED_EVENT,
  decideApproval,
  deleteAiConversation,
  getAiConversation,
  getAiProviderModels,
  getAiProviders,
  getHostThreads,
  type AiProposal,
  type AiProvider,
} from "../ai-api";
import { AiMessage } from "../AiMessage";
import { AiToolCall } from "../AiToolCall";
import {
  buildTimeline,
  finishedRunEntries,
  userEntry,
  type HistoryEntry,
} from "../transcript";
import { useAiStream } from "../use-ai-stream";
import { TerminalProposalCard } from "./TerminalProposalCard";
import {
  clampToolbarPosition,
  persistAiPanelPosition,
  readStoredAiPanelPosition,
  type ToolbarPosition,
} from "./panel-geometry";

type Mode = "manual" | "auto" | "guard";

interface TerminalAiPanelProps {  hostLabel: string;
  hostId: number;
  activeTab?: string | null;
  /** Terminal output to open with, from a contributed action. */
  initialContext?: string;
  onClose: () => void;
  onRunInTerminal: (command: string) => void;
  /** Fills a side panel instead of floating over the terminal. */
  embedded?: boolean;
}

/**
 * The chat docked to a terminal tab. It uses /ai/chat/stream with its read
 * and propose tools (propose_run_command, ProposalCard), so it respects the
 * admin/user gates and never runs a command without an explicit approve.
 */
export function TerminalAiPanel({
  hostLabel,
  hostId,
  activeTab,
  initialContext,
  onClose,
  onRunInTerminal,
  embedded = false,
}: TerminalAiPanelProps) {
  const { t } = useTranslation();
  const { state, send, stop, dismissApproval } = useAiStream();

  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [images, setImages] = useState<string[]>([]);
  const [queue, setQueue] = useState<Array<{ message: string; images: string[] }>>([]);
  const queuedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Reads picked files as data URLs; the server writes them out for the CLI. */
  const pickImages = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: string[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      if (!file.type.startsWith("image/") || file.size > 6 * 1024 * 1024) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      }).catch(() => "");
      if (dataUrl) next.push(dataUrl);
    }
    setImages((current) => [...current, ...next].slice(0, 4));
  }, []);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [resolvedProposals, setResolvedProposals] = useState<
    Record<number, { status: "applied" | "rejected"; resultSummary?: string }>
  >({});
  const conversationIdRef = useRef<number | null>(null);
  const runCountRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<
    Array<{ id: number; title: string | null }>
  >([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [freshThread, setFreshThread] = useState(false);

  // A host keeps its own list of threads: reopening the panel resumes the
  // newest one, and every other host has its own.
  const loadThreads = useCallback(async () => {
    try {
      setThreads(await getHostThreads(hostId));
    } catch {
      setThreads([]);
    }
  }, [hostId]);

  const openThread = useCallback(async (id: number) => {
    setActiveThreadId(id);
    conversationIdRef.current = id;
    setFreshThread(false);
    try {
      const thread = await getAiConversation(id);
      setHistory(
        (thread.messages ?? [])
          .filter((row) => row.role === "user" || row.role === "assistant")
          .map((row) => ({
            kind: "message" as const,
            role: row.role as "user" | "assistant",
            content: row.content,
            images: row.images,
          })),
      );
    } catch {
      setHistory([]);
    }
  }, []);

  const startNewThread = useCallback(() => {
    setActiveThreadId(null);
    conversationIdRef.current = null;
    setFreshThread(true);
    setHistory([]);
  }, []);

  /** Deletes the open thread, then leaves the panel on a clean one. */
  const removeThread = useCallback(async () => {
    const id = activeThreadId;
    if (!id) return;
    if (!window.confirm("删除这个对话？此操作不可撤销。")) return;
    try {
      await deleteAiConversation(id);
    } catch {
      return;
    }
    startNewThread();
    const list = await getHostThreads(hostId).catch(() => []);
    setThreads(list);
    if (list.length > 0) void openThread(list[0].id);
  }, [activeThreadId, hostId, openThread, startNewThread]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await getHostThreads(hostId).catch(() => []);
      if (!alive) return;
      setThreads(list);
      if (list.length > 0) void openThread(list[0].id);
      else startNewThread();
    })();
    return () => {
      alive = false;
    };
  }, [hostId, openThread, startNewThread]);

  // Prefilled rather than sent: the user sees exactly what the terminal is
  // about to hand the model, and can trim it or add a question first.
  useEffect(() => {
    if (!initialContext) return;
    setInput((current) =>
      current
        ? current
        : t("ai.terminalContextPrefill", { output: initialContext }),
    );
  }, [initialContext, t]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [position, setPosition] = useState<ToolbarPosition>(
    readStoredAiPanelPosition,
  );
  const positionRef = useRef(position);
  positionRef.current = position;
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    basePosition: ToolbarPosition;
  } | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const host = panel?.offsetParent as HTMLElement | null;
    if (!panel || !host || embedded) return;
    const next = clampToolbarPosition(
      positionRef.current,
      panel.getBoundingClientRect(),
      host.getBoundingClientRect(),
      positionRef.current,
    );
    if (next.x !== positionRef.current.x || next.y !== positionRef.current.y) {
      positionRef.current = next;
      setPosition(next);
    }
    // Only re-clamp when the panel first mounts; drag handles the rest.
  }, []);

  const handleDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (embedded) return;
    if (event.button !== 0 || event.pointerType === "touch") return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      basePosition: positionRef.current,
    };
  };
  const handleDragPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const panel = panelRef.current;
    const host = panel?.offsetParent as HTMLElement | null;
    if (!panel || !host) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const next = clampToolbarPosition(
      { x: drag.basePosition.x + deltaX, y: drag.basePosition.y + deltaY },
      panel.getBoundingClientRect(),
      host.getBoundingClientRect(),
      positionRef.current,
    );
    positionRef.current = next;
    setPosition(next);
  };
  const handleDragPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    persistAiPanelPosition(positionRef.current);
    dragRef.current = null;
    if (event.type !== "lostpointercapture") {
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        // The browser may have already released capture for this pointer.
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getAiProviders()
        .then((list) => {
          if (cancelled) return;
          setProviders(list);
          setProviderId((current) =>
            current && list.some((entry) => entry.id === current)
              ? current
              : (list[0]?.id ?? null),
          );
        })
        .catch(() => {
          if (!cancelled) setProviders([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void load();
    window.addEventListener(AI_PROVIDERS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(AI_PROVIDERS_CHANGED_EVENT, load);
    };
  }, []);

  // The model list rides on the provider route: with the Claude engine the
  // server answers with the cc-switch aliases, so this picker stays live.
  useEffect(() => {
    if (!providerId) {
      setModels([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const list = await getAiProviderModels(providerId);
        if (!alive) return;
        setModels(list);
        setModel((current) =>
          current && list.includes(current) ? current : (list[0] ?? ""),
        );
      } catch {
        if (alive) setModels([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [providerId]);

  useEffect(() => {
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.assistantText, state.tools.length, history.length]);

  const handleResolved = useCallback(
    (id: number, status: "applied" | "rejected", resultSummary?: string) => {
      setResolvedProposals((current) => ({
        ...current,
        [id]: { status, resultSummary },
      }));
    },
    [],
  );

  const sendNow = useCallback(
    (message: string, pictures: string[]) => {
      if (!providerId) return;
      setHistory((current) => [...current, userEntry(message, pictures)]);
      void send({
        message,
        providerId,
        model: model || undefined,
        conversationId: conversationIdRef.current,
        activeTab: activeTab ?? `terminal:${hostLabel}`,
        extra: {
          hostId,
          mode,
          ...(pictures.length > 0 ? { images: pictures } : {}),
          ...(freshThread ? { newThread: true } : {}),
        },
        onComplete: (conversationId, reply, tools) => {
          queuedRef.current = false;
          conversationIdRef.current = conversationId;
          setFreshThread(false);
          if (conversationId) {
            setActiveThreadId(conversationId);
            void loadThreads();
          }
          const runId = runCountRef.current++;
          setHistory((current) => [
            ...current,
            ...finishedRunEntries(runId, tools, reply),
          ]);
        },
      });
    },
    [activeTab, freshThread, hostLabel, loadThreads, mode, model, providerId, send],
  );

  const handleSend = useCallback(() => {
    const message = input.trim();
    if (!message || !providerId) return;
    setInput("");
    setImages([]);
    if (state.streaming) {
      // A turn is running: hold this message instead of dropping the picture.
      setQueue((current) => [...current, { message, images }]);
      return;
    }
    sendNow(message, images);
  }, [images, input, providerId, sendNow, state.streaming]);

  // Whatever was queued goes out as soon as the running turn finishes.
  useEffect(() => {
    if (state.streaming || queuedRef.current || queue.length === 0) return;
    const [next, ...rest] = queue;
    queuedRef.current = true;
    setQueue(rest);
    sendNow(next.message, next.images);
  }, [queue, sendNow, state.streaming]);

  const hasDraft = input.trim().length > 0 || images.length > 0;

  const proposals: AiProposal[] = state.proposals.map((proposal) => {
    const resolved = resolvedProposals[proposal.id];
    if (!resolved) return proposal;
    return {
      ...proposal,
      status: resolved.status,
      resultSummary: resolved.resultSummary ?? proposal.resultSummary,
    };
  });

  const timeline = buildTimeline(history, state, proposals);

  return (
    <div
      ref={panelRef}
      className={
        embedded
          ? "flex h-full min-h-0 flex-col bg-background"
          : "absolute right-2 top-12 z-[120] flex max-h-[calc(100%-4rem)] w-[min(420px,calc(100vw-1rem))] flex-col border border-border bg-background shadow-xl"
      }
      style={
        embedded
          ? undefined
          : { transform: `translate(${position.x}px, ${position.y}px)` }
      }
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b border-border px-3 py-2 ${
          embedded ? "" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerEnd}
        onPointerCancel={handleDragPointerEnd}
        onLostPointerCapture={handleDragPointerEnd}
      >
        <div className="flex min-w-0 items-center gap-2">
          {!embedded && (
            <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Bot className="size-4 shrink-0 text-accent-brand" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 truncate text-[13px] font-bold text-foreground">
              {t("ai.assistant")}
              {state.streaming && (
                <span className="flex items-center gap-1 rounded border border-accent-brand/40 bg-accent-brand/10 px-1 text-[10px] font-normal text-accent-brand">
                  <Loader2 className="size-2.5 animate-spin" />
                  运行中
                </span>
              )}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {hostLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={stop}
            disabled={!state.streaming}
            title={t("ai.stop")}
          >
            <Square className="size-3.5" />
          </Button>
          {!embedded && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={onClose}
              title={t("common.close")}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 border-b border-border px-2 py-1">
        <div className="flex items-center gap-1">
          <select
            className="min-w-0 flex-1 truncate bg-transparent py-1 text-[13px] outline-none"
            value={activeThreadId ?? ""}
            onChange={(event) => {
              const id = Number(event.target.value);
              if (Number.isFinite(id) && id > 0) void openThread(id);
            }}
          >
            {activeThreadId === null && <option value="">新对话</option>}
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {(thread.title || `对话 ${thread.id}`).slice(0, 40)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-border px-2 text-[13px] leading-6"
            title="新对话"
            onClick={startNewThread}
          >
            +
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 text-[13px] leading-6 disabled:opacity-40"
            title="删除当前对话"
            disabled={activeThreadId === null}
            onClick={() => void removeThread()}
          >
            ×
          </button>
        </div>

      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        {timeline.length === 0 && !loading && (
          <div className="text-[13px] text-muted-foreground">
            {t("ai.terminalPanelEmpty")}
          </div>
        )}
        {!loading && providers.length === 0 && (
          <div className="border border-border bg-muted/30 px-2 py-1.5 text-[13px] text-muted-foreground">
            {t("ai.noProvidersConfigured")}
          </div>
        )}
        {state.streaming && (
          <div
            role="status"
            className="flex items-center gap-2 text-[13px] text-muted-foreground"
          >
            <Loader2 className="size-3.5 animate-spin text-accent-brand" />
            {t("agents.working")}
          </div>
        )}

        {state.error && (
          <div className="border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[13px] text-destructive">
            {state.error}
          </div>
        )}
        {timeline.map((item) => {
          if (item.kind === "message") {
            return (
              <div key={item.key} className="flex flex-col gap-1">
                {item.images && item.images.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.images.map((src, index) => (
                      <img
                        key={index}
                        src={src}
                        alt=""
                        className="max-h-40 rounded border border-border object-contain"
                      />
                    ))}
                  </div>
                )}
                <AiMessage role={item.role} content={item.content} />
              </div>
            );
          }
          if (item.kind === "tool") {
            return (
              <AiToolCall
                key={item.key}
                tool={item.tool}
                streaming={item.live && state.streaming}
              />
            );
          }
          return (
            <TerminalProposalCard
              key={item.key}
              proposal={item.proposal}
              hostId={hostId}
              onRunInTerminal={onRunInTerminal}
              onResolved={handleResolved}
            />
          );
        })}
      </div>

      {state.approvals.map((approval) => (
        <div
          key={approval.id}
          className="border-t border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px]"
        >
          <div className="font-medium">
            需要你确认：{approval.toolName}
          </div>
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all opacity-80">
            {JSON.stringify(approval.input, null, 2).slice(0, 600)}
          </pre>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5"
              onClick={() => {
                void decideApproval(approval.id, "allow");
                dismissApproval(approval.id);
              }}
            >
              允许
            </button>
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5"
              onClick={() => {
                void decideApproval(approval.id, "deny");
                dismissApproval(approval.id);
              }}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}

      <div className="border-t border-border p-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void pickImages(event.target.files);
            event.target.value = "";
          }}
        />
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-2 focus-within:ring-1 focus-within:ring-ring">
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {images.map((src, index) => (
                <div key={index} className="relative">
                  <img
                    src={src}
                    alt=""
                    className="size-10 rounded-md border border-border object-cover"
                  />
                  <button
                    type="button"
                    className="absolute -right-1 -top-1 size-4 rounded-full border border-border bg-background text-[10px] leading-none"
                    onClick={() =>
                      setImages((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {queue.length > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              已排队 {queue.length} 条，这一轮跑完自动发
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.some((file) => file.type.startsWith("image/"))) {
                event.preventDefault();
                void pickImages(event.clipboardData.files);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={t("ai.terminalPanelPlaceholder")}
            rows={2}
            className="max-h-40 min-h-12 resize-none bg-transparent px-1 py-1 text-[13px] text-foreground outline-none"
            disabled={state.streaming || providers.length === 0}
          />
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded p-1 hover:bg-muted disabled:opacity-40"
              title="添加图片（也可直接 Ctrl+V 粘贴）"
              disabled={state.streaming}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className="size-4" />
            </button>
            <select
              className="shrink-0 cursor-pointer bg-transparent text-[11px] text-muted-foreground outline-none"
              title="权限模式"
              value={mode}
              onChange={(event) => setMode(event.target.value as Mode)}
            >
              <option value="auto">自动</option>
              <option value="guard">保护</option>
              <option value="manual">手动</option>
            </select>
            <select
              className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-[11px] text-muted-foreground outline-none"
              title="模型"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {models.length === 0 && <option value="">模型</option>}
              {models.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ml-auto flex size-7 items-center justify-center rounded-full bg-accent-brand text-white disabled:opacity-40"
              disabled={!state.streaming && (!input.trim() || !providerId)}
              onClick={() => {
                if (state.streaming && !hasDraft) {
                  stop();
                  return;
                }
                handleSend();
              }}
              title={
                state.streaming
                  ? hasDraft
                    ? "排队发送"
                    : t("ai.stop")
                  : t("ai.send")
              }
            >
              {state.streaming && !hasDraft ? (
                <Square className="size-3" />
              ) : (
                <Send className="size-3.5" />
              )}
            </button>
          </div>
        </div>
        {state.usage && (
          <div className="mt-1.5 flex items-center gap-3 px-1 text-[10px] text-muted-foreground">
            <span>输入 {state.usage.promptTokens.toLocaleString()}</span>
            <span>输出 {state.usage.completionTokens.toLocaleString()}</span>
            <span>合计 {(state.usage.promptTokens + state.usage.completionTokens).toLocaleString()} tok</span>
          </div>
        )}
      </div>
    </div>
  );
}
