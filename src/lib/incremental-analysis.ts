import { prisma } from "@/lib/prisma";
import { simulateAiReading, tokenize } from "@/lib/ai-simulator";
import { isAutoNotApplicable } from "@/lib/applicability";
import type { FinalClassification } from "@prisma/client";

// Análise incremental (item 28): só documentos novos. Não apaga nada,
// não muda requisito já validado (só marca "Rever") e salva um resumo
// em AnalysisRun.

// Só contam termos que aparecem em poucos requisitos, senão todo
// documento parecia relevante pra tudo.
export const DISTINCTIVE_MAX_REQS = 4;
/**
 * Fração mínima dos termos distintivos do requisito presentes no documento,
 * contada sobre no máximo RELEVANCE_CAP termos: requisitos longos (com itens
 * a, b, c…) têm dezenas de termos e um documento curto sobre o tema nunca
 * passaria de 35% de todos eles.
 */
export const RELEVANCE_MIN = 0.35;
export const RELEVANCE_CAP = 20;
/** E pelo menos esta quantidade de termos distintivos em comum. */
export const RELEVANCE_MIN_TERMS = 3;
/** Acima desta relevância, um requisito validado como gap recebe o aviso "Rever". */
export const STRONG_RELEVANCE = 0.5;

function distinctiveTokens(
  requirements: { id: string; title: string; description: string; descriptionEn?: string | null }[]
) {
  // Texto em português e em inglês: boa parte dos documentos técnicos é em inglês.
  const perReq = new Map(
    requirements.map((r) => [r.id, tokenize(`${r.title} ${r.description} ${r.descriptionEn ?? ""}`)])
  );
  const df = new Map<string, number>();
  for (const toks of perReq.values()) for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  const out = new Map<string, Set<string>>();
  for (const [id, toks] of perReq) out.set(id, new Set([...toks].filter((t) => (df.get(t) ?? 0) <= DISTINCTIVE_MAX_REQS)));
  return out;
}

function relevance(distinct: Set<string>, docTokens: Set<string>) {
  if (distinct.size === 0) return { score: 0, matched: 0 };
  let matched = 0;
  for (const t of distinct) if (docTokens.has(t)) matched++;
  return { score: matched / Math.min(distinct.size, RELEVANCE_CAP), matched };
}

export interface IncrementalDocResult {
  documentId: string;
  title: string;
  /** Requisitos em que o documento entrou como evidência nova. */
  evidenceAdded: string[];
  /** Requisitos validados em que o documento sugere outra classificação (viraram "Rever"). */
  flaggedForReview: string[];
  /** Requisitos não validados cuja sugestão da IA mudou por causa do documento. */
  suggestionChanged: string[];
  /** Sem texto lido (imagem, formato sem extração): nada pôde ser avaliado. */
  noText: boolean;
}

export interface IncrementalSummary {
  runAt: string;
  documents: IncrementalDocResult[];
  totals: { evidenceAdded: number; flaggedForReview: number; suggestionChanged: number };
}

const NAMES: Record<FinalClassification, string> = {
  ATENDE_TOTALMENTE: "Atende totalmente",
  ATENDE_PARCIALMENTE: "Atende parcialmente",
  NAO_ATENDE: "Não atende",
  NAO_SE_APLICA: "Não se aplica",
};

function excerptOf(text: string | null, title: string, code: string) {
  if (!text) return `Documento "${title}" relacionado ao requisito ${code}.`;
  return text.slice(0, 240).trim() + (text.length > 240 ? "…" : "");
}

export async function countNewDocuments(installationId: string) {
  return prisma.documentFile.count({ where: { installationId, analyzedAt: null } });
}

export async function analyzeNewDocuments(
  installationId: string,
  cycleId: string,
  actor: string
): Promise<IncrementalSummary | null> {
  const [allDocs, requirements, assessments] = await Promise.all([
    prisma.documentFile.findMany({ where: { installationId } }),
    prisma.requirement.findMany({ orderBy: { code: "asc" } }),
    prisma.assessment.findMany({ where: { installationId, cycleId } }),
  ]);
  const newDocs = allDocs.filter((d) => d.analyzedAt === null);
  if (newDocs.length === 0) return null;

  const byReq = new Map(assessments.map((a) => [a.requirementId, a]));
  const distinct = distinctiveTokens(requirements);
  const newDocTokens = new Map(newDocs.map((d) => [d.id, tokenize(d.extractedText ?? "")]));
  const results = new Map<string, IncrementalDocResult>(
    newDocs.map((d) => [
      d.id,
      { documentId: d.id, title: d.title, evidenceAdded: [], flaggedForReview: [], suggestionChanged: [], noText: !d.extractedText },
    ])
  );

  for (const req of requirements) {
    const current = byReq.get(req.id);
    if (current && isAutoNotApplicable(current.aiJustification)) continue;

    const reqDistinct = distinct.get(req.id) ?? new Set<string>();
    const scored = newDocs
      .filter((d) => d.extractedText)
      .map((d) => ({ d, ...relevance(reqDistinct, newDocTokens.get(d.id)!) }))
      .filter((x) => x.score >= RELEVANCE_MIN && x.matched >= RELEVANCE_MIN_TERMS);
    const relevantNew = scored.map((x) => x.d);
    if (relevantNew.length === 0) continue; // o documento novo não fala deste requisito

    // 1. Acrescenta as evidências do documento novo (sem apagar nenhuma).
    await prisma.evidence.createMany({
      data: relevantNew.map((d) => ({
        requirementId: req.id,
        documentId: d.id,
        excerpt: excerptOf(d.extractedText, d.title, req.code),
        aiGenerated: true,
      })),
    });
    for (const d of relevantNew) results.get(d.id)!.evidenceAdded.push(req.code);

    const docNames = relevantNew.map((d) => `"${d.title}"`).join(", ");

    if (current?.status === "VALIDADO") {
      // 2. Decisão humana intocada. Evidência nova só pode reforçar o
      // atendimento, então o aviso vale para requisitos validados como gap
      // ("Não atende" / "Atende parcialmente") quando o documento novo é
      // fortemente relacionado. Com a IA real, troque este critério pela
      // comparação entre a nova classificação do modelo e a validada.
      const strong = scored.filter((x) => x.score >= STRONG_RELEVANCE).map((x) => x.d);
      const isGap =
        current.finalClassification === "NAO_ATENDE" || current.finalClassification === "ATENDE_PARCIALMENTE";
      if (isGap && strong.length > 0) {
        const names = strong.map((d) => `"${d.title}"`).join(", ");
        await prisma.assessment.update({
          where: { id: current.id },
          data: {
            reviewFlag:
              `${names} pode mudar esta avaliação (validada como "${NAMES[current.finalClassification!]}").`,
            reviewFlagAt: new Date(),
          },
        });
        await prisma.auditLog.create({
          data: {
            assessmentId: current.id,
            actor,
            action: "REVISAO_SUGERIDA",
            note: `Documento novo: ${names}.`,
          },
        });
        for (const d of strong) results.get(d.id)!.flaggedForReview.push(req.code);
      }
      continue;
    }

    // 3. Ainda não validado: atualiza a sugestão da IA, relendo TODA a
    // documentação (antiga + nova), já que ninguém revisou ainda.
    const suggestion = simulateAiReading(req, allDocs);
    const changed = current?.aiClassification !== suggestion.classification;
    const data = {
      aiClassification: suggestion.classification,
      aiRobustness: suggestion.robustness,
      aiCriticality: suggestion.criticality,
      aiInfoSufficiency: suggestion.infoSufficiency,
      aiJustification: suggestion.justification,
      aiConfidence: suggestion.confidence,
      status: "EM_REVISAO" as const,
    };
    const saved = current
      ? await prisma.assessment.update({ where: { id: current.id }, data })
      : await prisma.assessment.create({ data: { requirementId: req.id, installationId, cycleId, ...data } });
    await prisma.auditLog.create({
      data: {
        assessmentId: saved.id,
        actor: "IA (simulada)",
        action: "SUGESTAO_IA_GERADA",
        note: `Análise de documento novo: ${docNames}. Classificação sugerida: ${suggestion.classification}.`,
      },
    });
    if (changed) for (const d of relevantNew) results.get(d.id)!.suggestionChanged.push(req.code);
  }

  await prisma.documentFile.updateMany({
    where: { id: { in: newDocs.map((d) => d.id) } },
    data: { analyzedAt: new Date() },
  });

  // Códigos em ordem numérica (2.1 antes de 13.3), para o resumo ler bem.
  const byCode = (x: string, y: string) => {
    const [a1, a2] = x.split(".").map(Number);
    const [b1, b2] = y.split(".").map(Number);
    return a1 - b1 || a2 - b2;
  };
  const documents = [...results.values()].map((d) => ({
    ...d,
    evidenceAdded: d.evidenceAdded.sort(byCode),
    flaggedForReview: d.flaggedForReview.sort(byCode),
    suggestionChanged: d.suggestionChanged.sort(byCode),
  }));
  const summary: IncrementalSummary = {
    runAt: new Date().toISOString(),
    documents,
    totals: {
      evidenceAdded: documents.reduce((n, d) => n + d.evidenceAdded.length, 0),
      flaggedForReview: new Set(documents.flatMap((d) => d.flaggedForReview)).size,
      suggestionChanged: new Set(documents.flatMap((d) => d.suggestionChanged)).size,
    },
  };

  await prisma.analysisRun.create({
    data: { installationId, cycleId, mode: "INCREMENTAL", summaryJson: JSON.stringify(summary), createdBy: actor },
  });

  return summary;
}

export async function latestIncrementalSummary(installationId: string, cycleId: string) {
  const run = await prisma.analysisRun.findFirst({
    where: { installationId, cycleId, mode: "INCREMENTAL" },
    orderBy: { createdAt: "desc" },
  });
  if (!run) return null;
  try {
    return { ...(JSON.parse(run.summaryJson) as IncrementalSummary), createdBy: run.createdBy };
  } catch {
    return null;
  }
}
