import type { DocumentFile } from "@prisma/client";
import { runDocumentAgent } from "@/lib/ai-agent";
import { recurrenceLabel, type ApplicableObligation, type LegalStatus } from "@/lib/legal-catalog";

/**
 * Sugestão de status para uma obrigação legal. Como na avaliação GISTM, a IA
 * só sugere: a decisão final, a data de cumprimento e a observação são de uma
 * pessoa.
 */
export interface LegalSuggestion {
  status: LegalStatus;
  justification: string;
  documentId: string | null;
  excerpt: string | null;
}

function normalize(t: string) {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Leitura por palavras: procura nos documentos os termos característicos da
 * obrigação. Achou → "Em dia" a confirmar (com o trecho); não achou → "Sem
 * evidência". Nunca conclui "Pendente": isso depende de data e de julgamento.
 */
export function suggestByKeywords(
  item: ApplicableObligation,
  documents: Pick<DocumentFile, "id" | "title" | "extractedText">[]
): LegalSuggestion {
  const { obligation, applies } = item;
  if (applies === false) {
    return {
      status: "NAO_APLICAVEL",
      justification: "Pelo cadastro da estrutura (país, PNSB, DPA, método construtivo ou classe), esta obrigação não se aplica.",
      documentId: null,
      excerpt: null,
    };
  }
  const terms = obligation.evidenceTerms.map(normalize);
  let best: { doc: (typeof documents)[number]; hits: number; at: number } | null = null;
  for (const doc of documents) {
    const text = normalize(`${doc.title} ${doc.extractedText ?? ""}`);
    let hits = 0;
    let at = -1;
    for (const t of terms) {
      const i = text.indexOf(t);
      if (i >= 0) {
        hits++;
        if (at < 0) at = i;
      }
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { doc, hits, at };
  }
  const missingData = applies === null ? " Complete o cadastro da estrutura para confirmar se ela se aplica." : "";
  if (!best || best.hits < Math.min(2, terms.length)) {
    return {
      status: "SEM_EVIDENCIA",
      justification: `Nenhum documento da base trata desta obrigação (${recurrenceLabel(item.recurrence).toLowerCase()}).${missingData}`,
      documentId: null,
      excerpt: null,
    };
  }
  const raw = best.doc.extractedText ?? "";
  const start = Math.max(0, normalize(raw).indexOf(terms.find((t) => normalize(raw).includes(t)) ?? "") - 100);
  const excerpt = raw ? raw.slice(start, start + 280).replace(/\s+/g, " ").trim() : null;
  return {
    status: "CONFORME",
    justification:
      `"${best.doc.title}" trata desta obrigação. Confirme a data em que ela foi cumprida pela última vez ` +
      `e se está dentro do prazo (${recurrenceLabel(item.recurrence).toLowerCase()}).${missingData}`,
    documentId: best.doc.id,
    excerpt: excerpt ? `…${excerpt}…` : null,
  };
}

const REGISTRAR_TOOL = {
  name: "registrar_verificacao",
  description: "Registra o resultado da verificação da obrigação legal. Chame uma vez, depois de consultar os documentos.",
  input_schema: {
    type: "object" as const,
    properties: {
      status: { type: "string", enum: ["CONFORME", "NAO_CONFORME", "NAO_APLICAVEL", "SEM_EVIDENCIA"] },
      justification: { type: "string" },
      documentId: { type: "string", description: "id do documento citado, ou vazio" },
      excerpt: { type: "string", description: "trecho citado, ou vazio" },
    },
    required: ["status", "justification", "documentId", "excerpt"],
    additionalProperties: false,
  },
};

/** Leitura com a IA real (Claude) pela base documental. Falhou → null. */
export async function suggestWithAi(
  installationId: string,
  item: ApplicableObligation,
  today = new Date()
): Promise<LegalSuggestion | null> {
  try {
    const o = item.obligation;
    const system =
      "Você verifica obrigações legais e normativas de barragens de rejeitos com base nos documentos da " +
      "estrutura. Responda em português. Use as ferramentas para procurar e ler os documentos antes de concluir. " +
      "Status: CONFORME = há registro de cumprimento dentro do prazo; NAO_CONFORME = há registro de atraso, " +
      "descumprimento ou de que a exigência não foi atendida; NAO_APLICAVEL = a obrigação não vale para esta " +
      "estrutura; SEM_EVIDENCIA = os documentos não permitem concluir. Na justificativa, cite a data do último " +
      "cumprimento quando encontrar. Uma pessoa vai validar a sua sugestão.";
    const user =
      `Data de hoje: ${today.toISOString().slice(0, 10)}.\n` +
      `Norma: ${item.norm.name} — ${o.article}.\n` +
      `Obrigação: ${o.title}. ${o.description}\n` +
      `Periodicidade: ${recurrenceLabel(item.recurrence)}.\n` +
      `Aplicabilidade pelo cadastro: ${item.applies === true ? "aplica" : item.applies === false ? "não aplica" : "indefinida"}.\n` +
      `Termos úteis para busca: ${o.evidenceTerms.join(", ")}.`;
    const result = await runDocumentAgent(installationId, system, user, {
      maxTokens: 1024,
      finalTool: REGISTRAR_TOOL,
      forceFirstTool: "listar_documentos",
    });
    const p = result.finalToolInput;
    if (!p || typeof p.status !== "string" || typeof p.justification !== "string") return null;
    if (!["CONFORME", "NAO_CONFORME", "NAO_APLICAVEL", "SEM_EVIDENCIA"].includes(p.status)) return null;
    return {
      status: p.status as LegalStatus,
      justification: p.justification,
      documentId: typeof p.documentId === "string" && p.documentId ? p.documentId : null,
      excerpt: typeof p.excerpt === "string" && p.excerpt ? p.excerpt.slice(0, 400) : null,
    };
  } catch {
    return null;
  }
}
