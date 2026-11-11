import { format } from "date-fns";
import Link from "next/link";
import clsx from "clsx";
import { CalendarDays, CircleCheck, ExternalLink, Flag, MessageCircle } from "lucide-react";
import { updateActionStatus, addActionComment } from "@/app/instalacoes/[installationId]/planos-de-acao/actions";
import { CriticalityBars } from "@/components/StatusIcons";
import type { GapCriticality } from "@prisma/client";

/**
 * Cores por status da ação (item 18):
 *   vermelho = não iniciada · amarelo = em andamento · verde = concluída
 */
export const ACTION_STATUS_META: Record<string, { label: string; dot: string; chip: string; border: string }> = {
  ABERTA: {
    label: "Não iniciada",
    dot: "bg-state-bad",
    chip: "bg-state-bad-soft text-state-bad",
    border: "border-l-state-bad",
  },
  EM_ANDAMENTO: {
    label: "Em andamento",
    dot: "bg-[#c2870f]",
    chip: "bg-state-warn-soft text-state-warn",
    border: "border-l-[#c2870f]",
  },
  CONCLUIDA: {
    label: "Concluída",
    dot: "bg-state-ok",
    chip: "bg-state-ok-soft text-state-ok",
    border: "border-l-state-ok",
  },
};

const PRIORITY_LABELS: Record<string, string> = {
  ALTA: "Prioridade alta",
  MEDIA: "Prioridade média",
  BAIXA: "Prioridade baixa",
};
const PRIORITY_COLOR: Record<string, string> = {
  ALTA: "text-state-bad",
  MEDIA: "text-[#c2870f]",
  BAIXA: "text-mineral-400",
};

/** Mostra só o domínio do link (o endereço completo fica no title). */
function shortUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface ActionItemData {
  id: string;
  code?: string | null;
  description: string;
  responsible: string;
  area: string | null;
  dueDate: Date | null;
  priority: string;
  status: string;
  closureEvidence: string | null;
  closureLink?: string | null;
  closureDocument?: { id: string; title: string } | null;
  dependsOn: { id: string; description: string; status: string } | null;
  comments?: { id: string; author: string; text: string; createdAt: Date }[];
  logs?: { id: string; actor: string; event: string; note: string | null; createdAt: Date }[];
}

const LOG_EVENT_LABELS: Record<string, string> = {
  ACAO_CRIADA: "Ação criada",
  STATUS_ALTERADO: "Status alterado",
};

export function ActionItem({
  action,
  code,
  criticality,
  requirementCode,
  requirementHref,
  installationId,
  requirementId,
  documents = [],
  overdue = false,
  readOnly = false,
  hideStatus = false,
  defaultAuthor = "",
}: {
  /** Nome de quem está logado, para o campo "Seu nome" dos comentários. */
  defaultAuthor?: string;
  action: ActionItemData;
  /** Código exibido (o salvo na ação ou um calculado para ações antigas). */
  code?: string;
  criticality?: GapCriticality | null;
  requirementCode?: string;
  requirementHref?: string;
  installationId?: string;
  requirementId?: string;
  /** Documentos da estrutura, para escolher como evidência de encerramento. */
  documents?: { id: string; title: string }[];
  overdue?: boolean;
  readOnly?: boolean;
  /** Oculta o selo de status quando a coluna do quadro já diz o status. */
  hideStatus?: boolean;
}) {
  const meta = ACTION_STATUS_META[action.status] ?? ACTION_STATUS_META.ABERTA;
  const displayCode = action.code ?? code;
  const blockedByDependency =
    !!action.dependsOn && action.dependsOn.status !== "CONCLUIDA" && action.status !== "CONCLUIDA";
  const historyCount = (action.comments?.length ?? 0) + (action.logs?.length ?? 0);

  return (
    <div
      className={clsx(
        "rounded-xl border border-l-4 bg-white p-3.5",
        meta.border,
        overdue ? "border-y-state-bad-line border-r-state-bad-line" : "border-y-mineral-200 border-r-mineral-200"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {displayCode && <span className="font-mono text-xs font-semibold text-mineral-700">{displayCode}</span>}
        {requirementCode && requirementHref && (
          <Link href={requirementHref} className="text-xs font-medium text-brand-600 hover:underline">
            Req. {requirementCode}
          </Link>
        )}
        {!hideStatus && (
          <span className={clsx("ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.chip)}>
            <span className={clsx("h-1.5 w-1.5 rounded-full", meta.dot)} />
            {meta.label}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-sm leading-snug text-mineral-900">{action.description}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mineral-500">
        <span className="font-medium text-mineral-700">{action.responsible}</span>
        {action.dueDate && (
          <span
            className={clsx("inline-flex items-center gap-1", overdue && "font-semibold text-state-bad")}
            title={overdue ? "Prazo vencido" : "Prazo"}
          >
            <CalendarDays size={12} />
            {format(action.dueDate, "dd/MM/yyyy")}
          </span>
        )}
        <span
          className={clsx("inline-flex", PRIORITY_COLOR[action.priority])}
          title={PRIORITY_LABELS[action.priority] ?? action.priority}
          aria-label={PRIORITY_LABELS[action.priority] ?? action.priority}
        >
          <Flag size={12} fill="currentColor" />
        </span>
        {criticality && criticality !== "NAO_SE_APLICA" && <CriticalityBars value={criticality} />}
      </div>

      {action.dependsOn && action.status !== "CONCLUIDA" && (
        <p className="mt-1.5 text-xs text-mineral-500">
          Depende de: {action.dependsOn.description.slice(0, 80)}
          {action.dependsOn.description.length > 80 ? "…" : ""}
        </p>
      )}

      {action.status === "CONCLUIDA" && (action.closureDocument || action.closureLink || action.closureEvidence) && (
        <div className="mt-2 space-y-1 rounded-lg bg-state-ok-soft/60 px-2.5 py-2 text-xs text-mineral-700">
          <p className="sr-only">Evidência de encerramento</p>
          {action.closureDocument && (
            <a
              href={`/api/documentos/${action.closureDocument.id}/download`}
              className="flex items-center gap-1.5 hover:underline"
            >
              <CircleCheck size={12} className="shrink-0 text-state-ok" />
              <span className="truncate">{action.closureDocument.title}</span>
            </a>
          )}
          {action.closureLink && (
            <a
              href={action.closureLink}
              target="_blank"
              rel="noopener noreferrer"
              title={action.closureLink}
              className="flex items-center gap-1.5 hover:underline"
            >
              <ExternalLink size={12} className="shrink-0" />
              {shortUrl(action.closureLink)}
            </a>
          )}
          {action.closureEvidence && <p className="text-mineral-600">{action.closureEvidence}</p>}
        </div>
      )}

      {blockedByDependency && !readOnly && (
        <p className="mt-2 text-[11px] text-mineral-500">Aguardando a dependência.</p>
      )}

      {!readOnly && action.status === "ABERTA" && !blockedByDependency && (
        <form action={updateActionStatus.bind(null, action.id, "EM_ANDAMENTO")} className="mt-2.5">
          <button type="submit" className="btn-secondary">
            Iniciar
          </button>
        </form>
      )}

      {!readOnly && action.status === "EM_ANDAMENTO" && !blockedByDependency && (
        <details className="mt-2.5">
          <summary className="btn-primary cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            Concluir
          </summary>
          <form
            action={updateActionStatus.bind(null, action.id, "CONCLUIDA")}
            className="mt-2 space-y-2 rounded-lg bg-mineral-50 p-3"
          >
            <p className="text-xs font-medium text-mineral-700">Evidência de encerramento</p>
            <label className="block text-[11px] text-mineral-600">
              Documento (anexar)
              <input
                type="file"
                name="closureFile"
                className="mt-1 block w-full text-xs text-mineral-600 file:mr-2 file:rounded-full file:border-0 file:bg-brand-500 file:px-3 file:py-1 file:text-xs file:font-medium file:text-white"
              />
            </label>
            {documents.length > 0 && (
              <label className="block text-[11px] text-mineral-600">
                ou escolha da Documentação
                <select name="closureDocumentId" defaultValue="" className="input mt-1 text-xs">
                  <option value="">—</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-[11px] text-mineral-600">
              Link
              <input
                type="url"
                name="closureLink"
                required
                placeholder="https://…"
                className="input mt-1 text-xs"
              />
            </label>
            <input name="closureEvidence" placeholder="Observação (opcional)" className="input text-xs" />
            <button type="submit" className="btn-primary">
              Confirmar conclusão
            </button>
          </form>
        </details>
      )}

      {(historyCount > 0 || (!readOnly && installationId)) && (
        <details className="mt-2.5 border-t border-mineral-100 pt-2">
          <summary title="Histórico e comentários" className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-mineral-500 hover:text-brand-600 [&::-webkit-details-marker]:hidden">
            <MessageCircle size={13} aria-label="Histórico e comentários" />
            {historyCount > 0 ? historyCount : ""}
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {action.logs?.map((log) => (
              <p key={log.id} className="text-[11px] text-mineral-500">
                <span className="font-medium">{LOG_EVENT_LABELS[log.event] ?? log.event}</span> · {log.actor} ·{" "}
                {format(log.createdAt, "dd/MM/yyyy HH:mm")}
                {log.note && <span className="block">{log.note}</span>}
              </p>
            ))}
            {action.comments?.map((c) => (
              <p key={c.id} className="rounded bg-mineral-50 px-2 py-1.5 text-[11px] text-mineral-600">
                <span className="font-medium">{c.author}</span>{" "}
                <span className="text-mineral-500">{format(c.createdAt, "dd/MM/yyyy HH:mm")}</span>
                <span className="block">{c.text}</span>
              </p>
            ))}
            {!readOnly && installationId && (
              <form action={addActionComment} className="space-y-1.5 pt-1">
                <input type="hidden" name="installationId" value={installationId} />
                <input type="hidden" name="actionId" value={action.id} />
                {requirementId && <input type="hidden" name="requirementId" value={requirementId} />}
                <input
                  name="author"
                  required
                  placeholder="Seu nome"
                  defaultValue={defaultAuthor}
                  className="input w-full text-[11px]"
                />
                <input name="text" required placeholder="Comentário" className="input w-full text-[11px]" />
                <button type="submit" className="text-[11px] font-medium text-brand-600 hover:underline">
                  Comentar →
                </button>
              </form>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
