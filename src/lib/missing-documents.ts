import { tokenize } from "@/lib/ai-simulator";
import type { DocumentFile, Requirement } from "@prisma/client";

export interface MissingDocumentHint {
  requirementId: string;
  code: string;
  title: string;
  expectedEvidence: string;
}


/**
 * Aproximação do item 9.3 da proposta ("identificar documentos faltantes"):
 * compara a evidência esperada de cada requisito (biblioteca de referência)
 * com o texto de TODA a base documental da instalação — não só com o que já
 * foi formalmente vinculado como evidência. Se nenhum documento da base tem
 * sobreposição textual relevante com a evidência esperada, é provável que o
 * tipo de documento certo simplesmente não tenha sido enviado ainda.
 *
 * Mesma heurística determinística de palavras-chave do simulador de IA
 * (`src/lib/ai-simulator.ts`), aplicada num sentido diferente: em vez de
 * "qual documento melhor explica este requisito", pergunta "existe ALGUM
 * documento que sequer se aproxime do que era esperado".
 */
// A "evidência esperada" importada é o mesmo texto genérico para todos os
// requisitos ("procedimentos, registros, relatórios técnicos…"), então
// compará-la com os documentos marcava os 77 como faltando. A comparação usa
// os termos distintivos do próprio requisito (português e inglês), como a
// análise incremental.
const DISTINCTIVE_MAX_REQS = 4;
const RELEVANCE_CAP = 20;
const RELEVANCE_MIN = 0.35;
const RELEVANCE_MIN_TERMS = 3;

export function detectMissingDocumentHints(
  requirements: (Pick<Requirement, "id" | "code" | "title" | "description" | "expectedEvidence"> & {
    descriptionEn?: string | null;
  })[],
  documents: Pick<DocumentFile, "title" | "extractedText">[]
): MissingDocumentHint[] {
  const perReq = new Map(
    requirements.map((r) => [r.id, tokenize(`${r.title} ${r.description} ${r.descriptionEn ?? ""}`)])
  );
  const df = new Map<string, number>();
  for (const toks of perReq.values()) for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  const docTokens = documents.map((d) => tokenize(`${d.title} ${d.extractedText ?? ""}`));

  const hints: MissingDocumentHint[] = [];
  for (const requirement of requirements) {
    const distinct = [...(perReq.get(requirement.id) ?? [])].filter((t) => (df.get(t) ?? 0) <= DISTINCTIVE_MAX_REQS);
    if (distinct.length === 0) continue;
    const found = docTokens.some((toks) => {
      const matched = distinct.filter((t) => toks.has(t)).length;
      return matched >= RELEVANCE_MIN_TERMS && matched / Math.min(distinct.length, RELEVANCE_CAP) >= RELEVANCE_MIN;
    });
    if (!found) {
      hints.push({
        requirementId: requirement.id,
        code: requirement.code,
        title: requirement.title,
        expectedEvidence: requirement.expectedEvidence ?? "",
      });
    }
  }
  return hints;
}
