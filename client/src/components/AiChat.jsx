import { useState, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { X, Send, Trash2, MessageCircle, CheckCircle } from "lucide-react";
import { useTelegram } from "../hooks/useTelegram";

export default function AiChat() {
  const { initData } = useTelegram();
  const [open, setOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        headers: {
          "x-telegram-init-data": initData,
          "ngrok-skip-browser-warning": "true",
        },
      }),
    [initData]
  );

  const [input, setInput] = useState("");
  const { messages, sendMessage, status, setMessages } =
    useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    sendMessage({ text });
  };

  const clearChat = async () => {
    try {
      await fetch("/api/ai/history", {
        method: "DELETE",
        headers: {
          "x-telegram-init-data": initData,
          "ngrok-skip-browser-warning": "true",
        },
      });
      setMessages([]);
    } catch (e) {
      console.error("Clear history error:", e);
    }
  };

  const getMessageText = (msg) => {
    if (msg.parts) {
      return msg.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
    }
    return msg.content || "";
  };

  const getToolInvocations = (msg) => {
    if (!msg.parts) return [];
    return msg.parts.filter((p) => p.type === "tool-invocation");
  };

  const renderToolResult = (invocation) => {
    const { toolName, state, result } = invocation.toolInvocation || invocation;
    if (toolName === "createHomework") {
      if (state === "call") {
        return (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs my-1"
            style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
          >
            <span className="animate-pulse">📝</span>
            <span>Создаю домашку...</span>
          </div>
        );
      }
      if (state === "result" && result?.success) {
        return (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs my-1"
            style={{
              backgroundColor: "var(--tg-theme-secondary-bg-color)",
              border: "1px solid var(--tg-theme-button-color)",
            }}
          >
            <CheckCircle size={14} style={{ color: "var(--tg-theme-button-color)" }} />
            <span>
              Домашка создана: <strong>{result.taskTitle}</strong> ({result.subjectEmoji} {result.subjectName})
            </span>
          </div>
        );
      }
      if (state === "result" && result?.error) {
        return (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs my-1"
            style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
          >
            <span>❌ {result.error}</span>
          </div>
        );
      }
    }
    return null;
  };

  const renderMarkdown = (text) => {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // Code blocks
    html = html.replace(
      /```[\w]*\n([\s\S]*?)```/g,
      '<pre style="background:var(--tg-theme-secondary-bg-color);padding:8px;border-radius:8px;overflow-x:auto;font-size:12px;margin:4px 0">$1</pre>'
    );
    // Inline code
    html = html.replace(
      /`([^`]+)`/g,
      '<code style="background:var(--tg-theme-secondary-bg-color);padding:1px 4px;border-radius:4px;font-size:12px">$1</code>'
    );
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Italic
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    // Newlines to <br> (but not inside <pre>)
    html = html
      .split(/(<pre[\s\S]*?<\/pre>)/g)
      .map((part, i) => (i % 2 === 0 ? part.replace(/\n/g, "<br>") : part))
      .join("");
    return html;
  };

  return (
    <>
      {/* FAB button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-4 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
          style={{
            bottom: "70px",
            backgroundColor: "var(--tg-theme-button-color)",
            color: "var(--tg-theme-button-text-color)",
          }}
        >
          <MessageCircle size={22} />
        </button>
      )}

      {/* Bottom sheet overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Bottom sheet */}
      <div
        className="fixed left-0 right-0 bottom-0 z-50 flex flex-col transition-transform duration-300 ease-out"
        style={{
          height: "85vh",
          backgroundColor: "var(--tg-theme-bg-color)",
          borderRadius: "16px 16px 0 0",
          transform: open ? "translateY(0)" : "translateY(100%)",
          boxShadow: open ? "0 -4px 20px rgba(0,0,0,0.15)" : "none",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{
            borderBottom: "1px solid var(--tg-theme-secondary-bg-color)",
          }}
        >
          <div className="flex items-center gap-2">
            <MessageCircle
              size={18}
              style={{ color: "var(--tg-theme-button-color)" }}
            />
            <span className="font-semibold text-sm">AI Chat</span>
            {isLoading && (
              <span className="text-xs text-[var(--tg-theme-hint-color)] animate-pulse">
                ...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="p-1.5 rounded-lg"
                style={{ color: "var(--tg-theme-hint-color)" }}
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg"
              style={{ color: "var(--tg-theme-hint-color)" }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-sm text-[var(--tg-theme-hint-color)] mt-8">
              Задайте вопрос AI-помощнику
            </div>
          )}
          {messages.map((msg) => {
            const toolInvocations = getToolInvocations(msg);
            const text = getMessageText(msg);

            return (
              <div key={msg.id}>
                {/* Tool invocation cards */}
                {msg.role === "assistant" && toolInvocations.map((inv, i) => (
                  <div key={`tool-${i}`} className="flex justify-start">
                    <div className="max-w-[85%]">
                      {renderToolResult(inv)}
                    </div>
                  </div>
                ))}
                {/* Message bubble */}
                {text && (
                  <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[85%] px-3 py-2 rounded-2xl text-sm"
                      style={
                        msg.role === "user"
                          ? {
                              backgroundColor: "var(--tg-theme-button-color)",
                              color: "var(--tg-theme-button-text-color)",
                              borderBottomRightRadius: "4px",
                              whiteSpace: "pre-wrap",
                            }
                          : {
                              backgroundColor:
                                "var(--tg-theme-secondary-bg-color)",
                              borderBottomLeftRadius: "4px",
                            }
                      }
                    >
                      {msg.role === "user" ? (
                        text
                      ) : (
                        <span
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(text),
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 px-4 py-3 flex gap-2"
          style={{
            borderTop: "1px solid var(--tg-theme-secondary-bg-color)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Написать сообщение..."
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none disabled:opacity-50"
            style={{
              backgroundColor: "var(--tg-theme-secondary-bg-color)",
            }}
          />
          <button
            type="submit"
            disabled={!input || isLoading}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30"
            style={{
              backgroundColor: "var(--tg-theme-button-color)",
              color: "var(--tg-theme-button-text-color)",
            }}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </>
  );
}
