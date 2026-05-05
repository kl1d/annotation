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
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type AiChatMessage } from "../lib/api";

export type AiActionPrompt = {
  id: number;
  prompt: string;
};

const contextOptions = [
  { value: "session", label: "Session" },
  { value: "timeline", label: "Timeline" },
  { value: "memo", label: "Memo" },
  { value: "logs", label: "Logs" },
  { value: "surveys", label: "Surveys" },
];

const aiChatStoragePrefix = "annotation-workbench.ai-chat";

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
  const [contextMode, setContextMode] = useState("session");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

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
        if (!sessionId) {
          return {
            content: [{ type: "text", text: "Open a session to use session-aware AI assistance." }],
          };
        }
        if (aiConfigured === false) {
          return {
            content: [{ type: "text", text: "AI Assistant is not configured yet. Open Settings > AI Assistant to choose a provider and model." }],
          };
        }
        try {
          const response = await api.runSessionAiChat(
            sessionId,
            {
              action: "chat",
              context_mode: contextMode,
              messages: messages
                .filter((message) => message.role === "user" || message.role === "assistant")
                .map((message): AiChatMessage => ({
                  role: message.role,
                  content: extractMessageText(message.content),
                }))
                .filter((message) => Boolean(message.content.trim())),
            },
            abortSignal,
          );
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
  const historyKey = sessionId ? `${aiChatStoragePrefix}.${sessionId}` : "";
  const loadedHistoryKey = useRef<string | null>(null);

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
        <button
          aria-label="Close AI Assistant"
          className="ai-collab-close"
          onClick={onClose}
          type="button"
        >
          <XIcon />
        </button>
      </div>
      <AssistantRuntimeProvider runtime={runtime}>
        <AiActionBridge actionPrompt={actionPrompt} />
        <ThreadPrimitive.Root className="ai-thread-root">
          <AiHistoryPersistence storageKey={historyKey} />
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
                  ? "Ask about this session, or use an action above to start from the current review context."
                  : "Open a session to use the AI collaborator with review context."}
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
            disabled={!sessionId}
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

function AiHistoryPersistence({ storageKey }: { storageKey: string }) {
  const messages = useThread((state) => state.messages);
  const isRunning = useThread((state) => state.isRunning);

  useEffect(() => {
    if (!storageKey || isRunning) {
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
    }
  }, [isRunning, messages, storageKey]);

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
  onContextModeChange,
}: {
  contextMode: string;
  disabled: boolean;
  onContextModeChange: (value: string) => void;
}) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const selectedContext = contextOptions.find((option) => option.value === contextMode) ?? contextOptions[0];

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
              {contextOptions.map((option) => (
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
          placeholder={disabled ? "Open a session to chat" : "Ask anything"}
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

function loadStoredAiMessages(storageKey: string) {
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
      )
      .map((message) => ({
        role: message.role,
        content: [{ type: "text" as const, text: message.content }],
      }));
  } catch {
    return [];
  }
}

function formatAiError(error: unknown) {
  const message = error instanceof Error ? error.message : "The AI request failed.";
  return `AI request failed: ${message}`;
}
