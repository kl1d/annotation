import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  useThread,
  useThreadRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AiChatMessage } from "../lib/api";

export type AiActionPrompt = {
  id: number;
  prompt: string;
};

const contextOptions = [
  { value: "general", label: "General", requiresSession: false },
  { value: "session", label: "Session", requiresSession: true },
  { value: "timeline", label: "Timeline", requiresSession: true },
  { value: "memo", label: "Memo", requiresSession: true },
  { value: "logs", label: "Logs", requiresSession: true },
  { value: "surveys", label: "Surveys", requiresSession: true },
];

const aiChatStoragePrefix = "annotation-workbench.ai-chat";
const aiChatThreadsSuffix = "threads";
const aiChatThreadHistoryPrefix = "thread";

type AiChatThreadSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

type SessionAiCollaboratorProps = {
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  sessionId?: string;
  actionPrompt?: AiActionPrompt | null;
};

export default function SessionAiCollaborator({
  open,
  onClose,
  onOpen,
  sessionId,
  actionPrompt,
}: SessionAiCollaboratorProps) {
  return (
    <>
      {!open ? (
        <div className="ai-floating-dock">
          <button
            aria-label="Open AI Assistant"
            className="ai-floating-button"
            onClick={onOpen}
            type="button"
          >
            <img alt="" aria-hidden="true" src="/ai-logo.svg" />
          </button>
        </div>
      ) : null}
      <SessionAiPanel actionPrompt={actionPrompt} onClose={onClose} open={open} sessionId={sessionId} />
    </>
  );
}

function SessionAiPanel({
  actionPrompt,
  onClose,
  open,
  sessionId,
}: {
  actionPrompt?: AiActionPrompt | null;
  onClose: () => void;
  open: boolean;
  sessionId?: string;
}) {
  const [contextMode, setContextMode] = useState(sessionId ? "session" : "general");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!sessionId && contextMode !== "general") {
      setContextMode("general");
    }
  }, [contextMode, sessionId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    api
      .getAiConfig()
      .then((config) => setAiConfigured(config.configured))
      .catch(() => setAiConfigured(false));
  }, [open]);

  const modelAdapter = useMemo<ChatModelAdapter>(
    () => ({
      async run({ messages, abortSignal }) {
        if (aiConfigured === false) {
          return {
            content: [{ type: "text", text: "AI Assistant is not configured yet. Open Settings > AI Assistant to choose a provider and model." }],
          };
        }
        try {
          const payload = {
            action: "chat",
            context_mode: contextMode,
            messages: messages
              .filter((message) => message.role === "user" || message.role === "assistant")
              .map((message): AiChatMessage => ({
                role: message.role,
                content: extractMessageText(message.content),
              }))
              .filter((message) => Boolean(message.content.trim())),
          };
          const response =
            sessionId && contextMode !== "general"
              ? await api.runSessionAiChat(sessionId, payload, abortSignal)
              : await api.runAiChat(payload, abortSignal);
          return {
            content: [{ type: "text", text: response.message }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: formatAiError(error) }],
          };
        }
      },
    }),
    [aiConfigured, contextMode, sessionId],
  );
  const runtime = useLocalRuntime(modelAdapter);
  const chatScopeKey = chatHistoryScopeKey(sessionId, contextMode);
  const legacyHistoryKey = sessionId && contextMode !== "general" ? `${aiChatStoragePrefix}.${sessionId}` : `${aiChatStoragePrefix}.general`;
  const [activeThreadId, setActiveThreadId] = useState("");
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const [threadListVersion, setThreadListVersion] = useState(0);
  const refreshThreads = useCallback(() => setThreadListVersion((current) => current + 1), []);
  const threadSummaries = useMemo(() => loadAiThreadSummaries(chatScopeKey), [chatScopeKey, threadListVersion]);
  const activeThread = threadSummaries.find((thread) => thread.id === activeThreadId) ?? threadSummaries[0];
  const historyKey = activeThreadId ? aiThreadHistoryKey(chatScopeKey, activeThreadId) : "";
  const loadedHistoryKey = useRef<string | null>(null);

  useEffect(() => {
    const summaries = ensureAiThreadSummaries(chatScopeKey, legacyHistoryKey);
    setActiveThreadId(summaries[0]?.id ?? "");
    refreshThreads();
    setThreadMenuOpen(false);
  }, [chatScopeKey, legacyHistoryKey, refreshThreads]);

  useEffect(() => {
    if (!historyKey) {
      loadedHistoryKey.current = null;
      runtime.thread.reset();
      return;
    }
    if (loadedHistoryKey.current === historyKey) {
      return;
    }
    loadedHistoryKey.current = historyKey;
    runtime.thread.reset(loadStoredAiMessages(historyKey));
  }, [historyKey]);

  return (
    <aside className={`ai-collab-panel ${open ? "" : "hidden"}`} aria-hidden={!open} aria-label="AI Assistant">
      <div className="ai-collab-header">
        <div className="ai-collab-title">
          <img alt="" aria-hidden="true" src="/ai-logo.svg" />
          <div>
            <p className="eyebrow">AI</p>
            <h3>Assistant</h3>
          </div>
        </div>
        <div className="ai-collab-header-actions">
          <button
            aria-label="Clear AI chat"
            className="ai-collab-close"
            onClick={() => {
              const nextThread = deleteAiThread(chatScopeKey, activeThreadId) ?? createAiThreadSummary();
              if (!loadAiThreadSummaries(chatScopeKey).some((thread) => thread.id === nextThread.id)) {
                saveAiThreadSummaries(chatScopeKey, [nextThread]);
              }
              setActiveThreadId(nextThread.id);
              refreshThreads();
              runtime.thread.reset(loadStoredAiMessages(aiThreadHistoryKey(chatScopeKey, nextThread.id)));
            }}
            title="Clear chat"
            type="button"
          >
            <TrashIcon />
          </button>
          <button
            aria-label="Close AI Assistant"
            className="ai-collab-close"
            onClick={onClose}
            type="button"
          >
            <XIcon />
          </button>
        </div>
      </div>
      <AssistantRuntimeProvider runtime={runtime}>
        <AiActionBridge actionPrompt={actionPrompt} />
        <ThreadPrimitive.Root className="ai-thread-root">
          <AiHistoryPersistence
            onPersist={refreshThreads}
            scopeKey={chatScopeKey}
            storageKey={historyKey}
            threadId={activeThreadId}
          />
          <div className="ai-chat-switcher">
            <div className="ai-thread-menu">
              <button
                aria-expanded={threadMenuOpen}
                className="ai-thread-trigger"
                onClick={() => setThreadMenuOpen((current) => !current)}
                type="button"
              >
                <MessageIcon />
                <span>{activeThread?.title ?? "New chat"}</span>
              </button>
              {threadMenuOpen ? (
                <div className="ai-thread-options" role="menu">
                  {threadSummaries.map((thread) => (
                    <button
                      className={thread.id === activeThreadId ? "active" : ""}
                      key={thread.id}
                      onClick={() => {
                        setActiveThreadId(thread.id);
                        setThreadMenuOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <span>{thread.title}</span>
                      <small>{formatThreadDate(thread.updatedAt)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className="ai-thread-new"
              onClick={() => {
                const nextThread = createAiThreadSummary();
                saveAiThreadSummaries(chatScopeKey, [nextThread, ...loadAiThreadSummaries(chatScopeKey)]);
                setActiveThreadId(nextThread.id);
                refreshThreads();
                runtime.thread.reset();
              }}
              type="button"
            >
              <PlusIcon />
              New chat
            </button>
          </div>
          <ThreadPrimitive.Viewport className="ai-thread-viewport">
            {aiConfigured === false ? (
              <div className="ai-config-notice">
                <strong>AI Assistant is not configured.</strong>
                <p>Choose a provider and model before using chat or wand actions.</p>
                <Link className="ghost-button" to="/settings">
                  Open Settings
                </Link>
              </div>
            ) : null}
            <ThreadPrimitive.Empty>
              <div className="ai-thread-empty">
                {sessionId
                  ? "Ask generally, or choose a session context for review-aware help."
                  : "Ask anything. Open a session later to add review context."}
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
              }}
            />
            <AiThinkingIndicator />
          </ThreadPrimitive.Viewport>
          <Composer
            contextMode={contextMode}
            disabled={false}
            hasSession={Boolean(sessionId)}
            onContextModeChange={setContextMode}
          />
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </aside>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 5V3.8h6V5m-8 0h10m-8.8 0 .7 11.2h6.2L13.8 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 6.2h10M5 10h7.6M4 3.8h12a1.8 1.8 0 0 1 1.8 1.8v6.9a1.8 1.8 0 0 1-1.8 1.8H9.2L5.1 17v-2.7H4a1.8 1.8 0 0 1-1.8-1.8V5.6A1.8 1.8 0 0 1 4 3.8Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function AiHistoryPersistence({
  onPersist,
  scopeKey,
  storageKey,
  threadId,
}: {
  onPersist: () => void;
  scopeKey: string;
  storageKey: string;
  threadId: string;
}) {
  const messages = useThread((state) => state.messages);
  const isRunning = useThread((state) => state.isRunning);

  useEffect(() => {
    if (!storageKey || !threadId || isRunning) {
      return;
    }
    const chatMessages = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message): AiChatMessage => ({
        role: message.role,
        content: extractMessageText(message.content),
      }))
      .filter((message) => Boolean(message.content.trim()));

    if (chatMessages.length) {
      localStorage.setItem(storageKey, JSON.stringify(chatMessages.slice(-30)));
      updateAiThreadSummary(scopeKey, threadId, chatMessages);
      onPersist();
    }
  }, [isRunning, messages, onPersist, scopeKey, storageKey, threadId]);

  return null;
}

function AiThinkingIndicator() {
  const isRunning = useThread((state) => state.isRunning);

  if (!isRunning) {
    return null;
  }

  return (
    <div className="ai-thinking" role="status" aria-live="polite">
      <img alt="" aria-hidden="true" src="/ai-logo.svg" />
      Assistant is thinking
    </div>
  );
}

function AiActionBridge({ actionPrompt }: { actionPrompt?: AiActionPrompt | null }) {
  const thread = useThreadRuntime();
  const lastPromptId = useRef<number | null>(null);

  useEffect(() => {
    if (!actionPrompt || actionPrompt.id === lastPromptId.current) {
      return;
    }
    lastPromptId.current = actionPrompt.id;
    thread.append({
      role: "user",
      content: [{ type: "text", text: actionPrompt.prompt }],
      startRun: true,
    });
  }, [actionPrompt, thread]);

  return null;
}

function Composer({
  contextMode,
  disabled,
  hasSession,
  onContextModeChange,
}: {
  contextMode: string;
  disabled: boolean;
  hasSession: boolean;
  onContextModeChange: (value: string) => void;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const availableContextOptions = contextOptions.filter((option) => hasSession || !option.requiresSession);
  const selectedContext = availableContextOptions.find((option) => option.value === contextMode) ?? availableContextOptions[0];

  return (
    <ComposerPrimitive.Root className="ai-composer">
      <div className="ai-composer-pill">
        <div className="ai-context-menu">
          <button
            aria-expanded={contextMenuOpen}
            aria-label="Choose AI context"
            className="ai-context-trigger"
            onClick={() => setContextMenuOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">+</span>
            <strong>{selectedContext.label}</strong>
          </button>
          {contextMenuOpen ? (
            <div className="ai-context-options" role="menu">
              {availableContextOptions.map((option) => (
                <button
                  className={option.value === contextMode ? "active" : ""}
                  key={option.value}
                  onClick={() => {
                    onContextModeChange(option.value);
                    setContextMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <ComposerPrimitive.Input
          className="ai-composer-input"
          disabled={disabled}
          placeholder="Ask anything"
          rows={1}
          submitMode="enter"
        />
        <ComposerPrimitive.Send aria-label="Send" className="ai-composer-send" disabled={disabled}>
          <ArrowUpIcon />
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 15V5m0 0L5.8 9.2M10 5l4.2 4.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="ai-message ai-message-user">
      <MessagePrimitive.Parts>
        {({ part }) => (part.type === "text" ? <MessagePartPrimitive.Text /> : null)}
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="ai-message ai-message-assistant">
      <MessagePrimitive.Parts>
        {({ part }) => (part.type === "text" ? <MessagePartPrimitive.Text /> : null)}
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  );
}

function extractMessageText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part) {
        return String(part.text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function chatHistoryScopeKey(sessionId: string | undefined, contextMode: string) {
  if (!sessionId || contextMode === "general") {
    return `${aiChatStoragePrefix}.general`;
  }
  return `${aiChatStoragePrefix}.${sessionId}.${contextMode}`;
}

function aiThreadIndexKey(scopeKey: string) {
  return `${scopeKey}.${aiChatThreadsSuffix}`;
}

function aiThreadHistoryKey(scopeKey: string, threadId: string) {
  return `${scopeKey}.${aiChatThreadHistoryPrefix}.${threadId}`;
}

function createAiThreadId() {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAiThreadSummary(messages: AiChatMessage[] = []): AiChatThreadSummary {
  return {
    id: createAiThreadId(),
    title: aiThreadTitle(messages),
    updatedAt: new Date().toISOString(),
  };
}

function loadAiThreadSummaries(scopeKey: string): AiChatThreadSummary[] {
  try {
    const raw = localStorage.getItem(aiThreadIndexKey(scopeKey));
    if (!raw) {
      return [];
    }
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) {
      return [];
    }
    return items
      .filter((item): item is AiChatThreadSummary =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.updatedAt === "string",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

function saveAiThreadSummaries(scopeKey: string, summaries: AiChatThreadSummary[]) {
  const deduped = summaries.filter(
    (summary, index, items) => items.findIndex((item) => item.id === summary.id) === index,
  );
  localStorage.setItem(aiThreadIndexKey(scopeKey), JSON.stringify(deduped.slice(0, 16)));
}

function ensureAiThreadSummaries(scopeKey: string, legacyHistoryKey: string) {
  const summaries = loadAiThreadSummaries(scopeKey);
  if (summaries.length) {
    return summaries;
  }

  const legacyMessages = loadStoredChatMessages(legacyHistoryKey);
  const summary = createAiThreadSummary(legacyMessages);
  saveAiThreadSummaries(scopeKey, [summary]);
  if (legacyMessages.length) {
    localStorage.setItem(aiThreadHistoryKey(scopeKey, summary.id), JSON.stringify(legacyMessages.slice(-30)));
  }
  return [summary];
}

function updateAiThreadSummary(scopeKey: string, threadId: string, messages: AiChatMessage[]) {
  const summaries = loadAiThreadSummaries(scopeKey).filter((thread) => thread.id !== threadId);
  saveAiThreadSummaries(scopeKey, [
    {
      id: threadId,
      title: aiThreadTitle(messages),
      updatedAt: new Date().toISOString(),
    },
    ...summaries,
  ]);
}

function deleteAiThread(scopeKey: string, threadId: string) {
  if (threadId) {
    localStorage.removeItem(aiThreadHistoryKey(scopeKey, threadId));
  }
  const summaries = loadAiThreadSummaries(scopeKey).filter((thread) => thread.id !== threadId);
  saveAiThreadSummaries(scopeKey, summaries);
  return summaries[0] ?? null;
}

function aiThreadTitle(messages: AiChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUserMessage) {
    return "New chat";
  }
  const title = firstUserMessage.content.trim().replace(/\s+/g, " ");
  return title.length > 36 ? `${title.slice(0, 34)}...` : title;
}

function formatThreadDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function loadStoredChatMessages(storageKey: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }
    const messages = JSON.parse(raw);
    if (!Array.isArray(messages)) {
      return [];
    }
    return messages
      .filter((message): message is AiChatMessage =>
        message &&
        typeof message === "object" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
      );
  } catch {
    return [];
  }
}

function loadStoredAiMessages(storageKey: string) {
  return loadStoredChatMessages(storageKey)
      .map((message) => ({
        role: message.role,
        content: [{ type: "text" as const, text: message.content }],
      }));
}

function formatAiError(error: unknown) {
  const message = error instanceof Error ? error.message : "The AI request failed.";
  return `AI request failed: ${message}`;
}
