"use client";

import { useRef, useState, useTransition } from "react";
import { Send, Bot, User, FileText, AlertTriangle } from "lucide-react";
import { askQuestion } from "@/app/instalacoes/[installationId]/assistente/actions";
import type { ChatSource } from "@/lib/ai-chat";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  sources?: ChatSource[];
}

const SUGGESTIONS = [
  "Existe plano de resposta a emergências para esta estrutura?",
  "Quem é o Engenheiro de Registro responsável?",
  "Há evidência de consulta pública com comunidades afetadas?",
];

export function ChatPanel({
  installationId,
  className,
}: {
  installationId: string;
  /** Permite usar o chat dentro do painel flutuante do Assistente (item 6). */
  className?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isPending) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    startTransition(async () => {
      try {
        const result = await askQuestion(installationId, trimmed);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: result.answer, sources: result.sources },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "error",
            content: error instanceof Error ? error.message : "Não foi possível responder a pergunta.",
          },
        ]);
      } finally {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
    });
  }

  return (
    <div
      className={
        className ??
        "flex h-[calc(100vh-220px)] min-h-[420px] flex-col rounded-xl border border-mineral-200 bg-white shadow-sm"
      }
    >
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <Bot className="text-brand-500" size={32} strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-mineral-700">
                Pergunte qualquer coisa sobre esta instalação
              </p>
              <p className="mt-1 max-w-sm text-xs text-mineral-500">
                Respostas com base na Documentação desta estrutura.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-mineral-200 px-3 py-1.5 text-xs text-mineral-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
            {isPending && (
              <div className="flex items-center gap-2 text-xs text-mineral-500">
                <Bot size={16} className="text-brand-400" />
                Consultando os documentos...
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-mineral-100 px-4 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte sobre a estrutura, evidências ou requisitos..."
          className="input flex-1"
          disabled={isPending}
          maxLength={1000}
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={14} />
          Enviar
        </button>
      </form>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white">
          {msg.content}
        </div>
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mineral-100 text-mineral-500">
          <User size={14} />
        </div>
      </div>
    );
  }

  if (msg.role === "error") {
    return (
      <div className="flex gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
          <AlertTriangle size={14} />
        </div>
        <div className="max-w-[75%] rounded-2xl rounded-tl-sm bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Bot size={14} />
      </div>
      <div className="max-w-[75%] space-y-2">
        <div className="space-y-1 rounded-2xl rounded-tl-sm bg-mineral-100 px-4 py-2.5 text-sm text-mineral-800">
          <LiteMarkdown text={msg.content} />
        </div>
        {msg.sources && msg.sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.sources.map((s) => (
              <span
                key={s.documentId}
                className="inline-flex items-center gap-1 rounded-full border border-mineral-200 bg-white px-2.5 py-1 text-[11px] text-mineral-500"
                title={s.type}
              >
                <FileText size={10} />
                {s.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Formatação mínima da resposta da IA: **negrito**, listas com "- " e
 * parágrafos. Remove ids internos de documento que às vezes vêm no texto.
 */
function LiteMarkdown({ text }: { text: string }) {
  const clean = text.replace(/\s*\((?:id|documentId)\s*[=:]\s*[a-z0-9]+\)/gi, "").replace(/^#{1,6}\s+/gm, "");
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.replace(/\*/g, "")
    );
  return (
    <>
      {clean.split(/\n+/).map((line, i) => {
        const bullet = line.match(/^\s*[-•]\s+(.*)$/);
        return bullet ? (
          <p key={i} className="flex gap-1.5 pl-1">
            <span aria-hidden>•</span>
            <span>{inline(bullet[1])}</span>
          </p>
        ) : (
          <p key={i}>{inline(line)}</p>
        );
      })}
    </>
  );
}
