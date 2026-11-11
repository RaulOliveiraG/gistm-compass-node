"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getInstallationContext, assertInstallationOwnership } from "@/lib/context";
import { getOrCreateAssessment } from "@/lib/assessments";
import { simulateAiReading } from "@/lib/ai-simulator";
import { generateRealAiAssessment } from "@/lib/ai-evidence";
import { flash } from "@/lib/flash";
import { isAutoNotApplicable } from "@/lib/applicability";
import { analyzeNewDocuments } from "@/lib/incremental-analysis";
import { auth } from "@/auth";
import type {
  DocumentFile,
  EvidenceRobustness,
  FinalClassification,
  GapCriticality,
  InfoSufficiency,
  Requirement,
} from "@prisma/client";

async function assertAssessmentBelongsToInstallation(installationId: string, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment || assessment.installationId !== installationId) {
    throw new Error("Avaliação não encontrada nesta instalação.");
  }
}

function revalidateRequirement(installationId: string, requirementId: string) {
  revalidatePath(`/instalacoes/${installationId}/requisitos/${requirementId}`);
  revalidatePath(`/instalacoes/${installationId}/requisitos`);
  revalidatePath(`/instalacoes/${installationId}/dashboard`);
  revalidatePath("/instalacoes");
}

async function applyAiSuggestion(
  requirement: Pick<Requirement, "id" | "code" | "title" | "description" | "expectedEvidence">,
  documents: Pick<DocumentFile, "id" | "title" | "extractedText">[],
  installationId: string,
  cycleId: string,
  useRealAi: boolean
) {
  const assessment = await getOrCreateAssessment(requirement.id, installationId, cycleId);
  const suggestion = simulateAiReading(requirement, documents);

  // A heurística determinística é sempre calculada primeiro — é o fallback
  // garantido. Quando pedido, a Claude de verdade decide a classificação
  // inteira (não só o texto) com base no conteúdo real dos documentos; se a
  // chamada falhar por qualquer motivo, fica valendo a sugestão heurística
  // sem quebrar o fluxo de avaliação.
  let classification = suggestion.classification;
  let robustness = suggestion.robustness;
  let criticality = suggestion.criticality;
  let infoSufficiency = suggestion.infoSufficiency;
  let confidence = suggestion.confidence;
  let justification = suggestion.justification;
  let evidences = suggestion.evidences;
  let usedRealAi = false;

  if (useRealAi) {
    // Se houver uma análise externa (Gap Analysis de consultoria) importada
    // para este requisito nesta instalação, passa como referência para a IA
    // ponderar — ver ExternalAnalysis / seed-metalkol-gap-analysis.mjs.
    const prior = await prisma.externalAnalysis.findFirst({
      where: { installationId, requirementId: requirement.id },
      orderBy: { updatedAt: "desc" },
      select: { content: true },
    });
    const real = await generateRealAiAssessment(requirement, installationId, prior?.content ?? null);
    if (real) {
      classification = real.classification;
      robustness = real.robustness;
      criticality = real.criticality;
      infoSufficiency = real.infoSufficiency;
      confidence = real.confidence;
      justification = real.justification;
      evidences = real.evidences.length > 0 ? real.evidences : suggestion.evidences;
      usedRealAi = true;
    }
  }

  // Remove sugestões anteriores da IA (mantém evidências anexadas manualmente
  // por um revisor humano) e recria a partir da nova leitura.
  await prisma.evidence.deleteMany({
    where: { requirementId: requirement.id, aiGenerated: true, document: { installationId } },
  });
  if (evidences.length > 0) {
    await prisma.evidence.createMany({
      data: evidences.map((e) => ({
        requirementId: requirement.id,
        documentId: e.documentId,
        excerpt: e.excerpt,
        aiGenerated: true,
      })),
    });
  }

  await prisma.assessment.update({
    where: { id: assessment.id },
    data: {
      aiClassification: classification,
      aiRobustness: robustness,
      aiCriticality: criticality,
      aiInfoSufficiency: infoSufficiency,
      aiJustification: justification,
      aiConfidence: confidence,
      status: assessment.status === "VALIDADO" ? "VALIDADO" : "EM_REVISAO",
    },
  });

  await prisma.auditLog.create({
    data: {
      assessmentId: assessment.id,
      actor: usedRealAi ? "IA (Claude)" : "IA (simulada)",
      action: "SUGESTAO_IA_GERADA",
      note: `Classificação sugerida: ${classification}.`,
    },
  });
}

export async function runAiSimulation(installationId: string, requirementId: string) {
  const { installation, cycle } = await getInstallationContext(installationId);

  const requirement = await prisma.requirement.findUniqueOrThrow({
    where: { id: requirementId },
  });
  const documents = await prisma.documentFile.findMany({
    where: { installationId: installation.id },
  });

  await applyAiSuggestion(requirement, documents, installation.id, cycle.id, true);

  revalidateRequirement(installation.id, requirementId);
  await flash("Sugestão da IA atualizada.");
}

// Análise em lote com a IA real (Claude) em vez da leitura por palavras-chave.
// Desligada por padrão por causa do custo e do tempo: ligue com
// AI_BATCH_REAL_AI=true. Sem chave da API, cai na leitura por palavras-chave.
const BATCH_REAL_AI = process.env.AI_BATCH_REAL_AI === "true";

export async function runAiSimulationForAll(installationId: string) {
  const { installation, cycle, isLatestCycle } = await getInstallationContext(installationId);
  if (!isLatestCycle) {
    throw new Error("Não é possível rodar a IA em um ciclo encerrado.");
  }

  const [requirements, documents, existing] = await Promise.all([
    prisma.requirement.findMany(),
    prisma.documentFile.findMany({ where: { installationId: installation.id } }),
    prisma.assessment.findMany({
      where: { installationId: installation.id, cycleId: cycle.id },
      select: { requirementId: true, aiJustification: true },
    }),
  ]);

  // Requisitos com "Não se aplica" automático (estrutura nova/em construção)
  // não são reanalisados, a regra de aplicabilidade prevalece (item 12).
  const autoNsa = new Set(
    existing.filter((a) => isAutoNotApplicable(a.aiJustification)).map((a) => a.requirementId)
  );
  const toAnalyze = requirements.filter((r) => !autoNsa.has(r.id));

  // Antes era um laço sequencial com ~4 consultas por requisito (77 x 4 em
  // série). Em lotes paralelos o tempo total cai bastante (item 3), sem
  // abrir conexões demais com o banco.
  const BATCH = 8;
  for (let i = 0; i < toAnalyze.length; i += BATCH) {
    await Promise.all(
      toAnalyze
        .slice(i, i + BATCH)
        .map((requirement) => applyAiSuggestion(requirement, documents, installation.id, cycle.id, BATCH_REAL_AI))
    );
  }

  // Todos os documentos entraram nesta leitura: nenhum fica como "novo".
  await prisma.documentFile.updateMany({
    where: { installationId: installation.id, analyzedAt: null },
    data: { analyzedAt: new Date() },
  });

  revalidatePath(`/instalacoes/${installation.id}/requisitos`);
  revalidatePath(`/instalacoes/${installation.id}/dashboard`);
  revalidatePath(`/instalacoes/${installation.id}/documentos`);
  revalidatePath("/instalacoes");
  await flash(`Análise concluída: ${toAnalyze.length} sugestões para validar.`);
}

/**
 * "Analisar documentos novos": avalia só os documentos que ainda não passaram
 * pela IA, acrescenta evidências sem apagar nada e nunca altera uma decisão
 * validada, apenas marca "Rever" quando o documento novo discorda.
 */
export async function runAiForNewDocuments(installationId: string) {
  const { installation, cycle, isLatestCycle } = await getInstallationContext(installationId);
  if (!isLatestCycle) throw new Error("Não é possível rodar a IA em um ciclo encerrado.");
  const session = await auth();
  const actor = session?.user?.name ?? session?.user?.email ?? "Usuário";

  const summary = await analyzeNewDocuments(installation.id, cycle.id, actor);

  revalidatePath(`/instalacoes/${installation.id}/requisitos`);
  revalidatePath(`/instalacoes/${installation.id}/dashboard`);
  revalidatePath(`/instalacoes/${installation.id}/documentos`);
  revalidatePath("/instalacoes");

  if (!summary) {
    await flash("Nenhum documento novo para analisar.", "info");
    return;
  }
  const t = summary.totals;
  const touched = new Set(summary.documents.flatMap((d) => d.evidenceAdded)).size;
  await flash(
    touched === 0
      ? `${summary.documents.length} documento(s) analisado(s): nenhuma evidência nova encontrada.`
      : `${summary.documents.length} documento(s) analisado(s): evidência nova em ${touched} requisito(s)` +
          (t.flaggedForReview > 0 ? `, ${t.flaggedForReview} validado(s) para rever` : "") +
          ". Veja o resumo na Análise.",
    t.flaggedForReview > 0 ? "warn" : "ok"
  );
}

/** Dispensa o aviso "Rever" mantendo a decisão validada como está. */
export async function dismissReviewFlag(installationId: string, assessmentId: string, requirementId: string) {
  await assertInstallationOwnership(installationId);
  await assertAssessmentBelongsToInstallation(installationId, assessmentId);
  const session = await auth();
  await prisma.assessment.update({ where: { id: assessmentId }, data: { reviewFlag: null, reviewFlagAt: null } });
  await prisma.auditLog.create({
    data: {
      assessmentId,
      actor: session?.user?.name ?? "Usuário",
      action: "REVISAO_DISPENSADA",
      note: "Decisão validada mantida após documento novo.",
    },
  });
  revalidateRequirement(installationId, requirementId);
  await flash("Aviso dispensado. A decisão validada foi mantida.");
}

export async function validateAssessment(formData: FormData) {
  const installationId = String(formData.get("installationId"));
  const assessmentId = String(formData.get("assessmentId"));
  const requirementId = String(formData.get("requirementId"));
  const themeId = String(formData.get("themeId") ?? "");
  const finalClassification = String(formData.get("finalClassification")) as FinalClassification;
  const finalRobustness = String(formData.get("finalRobustness")) as EvidenceRobustness;
  const finalCriticality = String(formData.get("finalCriticality")) as GapCriticality;
  const finalInfoSufficiency = String(formData.get("finalInfoSufficiency")) as InfoSufficiency;
  const finalJustification = String(formData.get("finalJustification") ?? "").trim();
  const reviewedBy = String(formData.get("reviewedBy") ?? "").trim() || "Revisor técnico";
  const saveAsTemplate = formData.get("saveAsTemplate") === "on";
  const templateTitle = String(formData.get("templateTitle") ?? "").trim();

  if (!finalJustification) {
    throw new Error("A justificativa técnica final é obrigatória para validar a avaliação.");
  }

  await assertInstallationOwnership(installationId);
  await assertAssessmentBelongsToInstallation(installationId, assessmentId);

  await prisma.assessment.update({
    where: { id: assessmentId },
    data: {
      finalClassification,
      finalRobustness,
      finalCriticality,
      finalInfoSufficiency,
      finalJustification,
      status: "VALIDADO",
      reviewedBy,
      reviewedAt: new Date(),
      reviewFlag: null,
      reviewFlagAt: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      assessmentId,
      actor: reviewedBy,
      action: "AVALIACAO_VALIDADA",
      note: `Classificação final: ${finalClassification}.`,
    },
  });

  // Snapshot estruturado da decisão (versionamento de decisões, não só o
  // log textual) — permite comparar exatamente o que mudou entre validações.
  const lastRevision = await prisma.assessmentRevision.findFirst({
    where: { assessmentId },
    orderBy: { version: "desc" },
  });
  await prisma.assessmentRevision.create({
    data: {
      assessmentId,
      version: (lastRevision?.version ?? 0) + 1,
      finalClassification,
      finalRobustness,
      finalCriticality,
      finalInfoSufficiency,
      finalJustification,
      reviewedBy,
    },
  });

  if (saveAsTemplate && themeId) {
    await prisma.justificationTemplate.create({
      data: {
        themeId,
        title: templateTitle || `Modelo — ${finalClassification}`,
        text: finalJustification,
        createdBy: reviewedBy,
      },
    });
  }

  revalidateRequirement(installationId, requirementId);
  await flash("Avaliação validada.");
}

export async function addComment(formData: FormData) {
  const installationId = String(formData.get("installationId"));
  const assessmentId = String(formData.get("assessmentId"));
  const requirementId = String(formData.get("requirementId"));
  const author = String(formData.get("author") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();

  if (!author) throw new Error("Informe seu nome para comentar.");
  if (!text) throw new Error("Escreva um comentário.");

  await assertInstallationOwnership(installationId);
  await assertAssessmentBelongsToInstallation(installationId, assessmentId);

  await prisma.comment.create({ data: { assessmentId, author, text } });

  revalidatePath(`/instalacoes/${installationId}/requisitos/${requirementId}`);
  await flash("Comentário publicado.");
}


export async function addManualEvidence(formData: FormData) {
  const installationId = String(formData.get("installationId"));
  const requirementId = String(formData.get("requirementId"));
  const documentId = String(formData.get("documentId"));
  const excerpt = String(formData.get("excerpt") ?? "").trim();

  if (!documentId) throw new Error("Selecione um documento.");
  if (!excerpt) throw new Error("Descreva o trecho de evidência.");

  await assertInstallationOwnership(installationId);
  const document = await prisma.documentFile.findUnique({ where: { id: documentId } });
  if (!document || document.installationId !== installationId) {
    throw new Error("Documento não encontrado nesta instalação.");
  }

  await prisma.evidence.create({
    data: { requirementId, documentId, excerpt, aiGenerated: false },
  });

  revalidatePath(`/instalacoes/${installationId}/requisitos/${requirementId}`);
  await flash("Evidência vinculada.");
}

export async function removeEvidence(
  installationId: string,
  requirementId: string,
  evidenceId: string
) {
  await assertInstallationOwnership(installationId);
  const evidence = await prisma.evidence.findUnique({
    where: { id: evidenceId },
    include: { document: true },
  });
  if (!evidence || evidence.document.installationId !== installationId) {
    throw new Error("Evidência não encontrada nesta instalação.");
  }

  await prisma.evidence.delete({ where: { id: evidenceId } });
  revalidatePath(`/instalacoes/${installationId}/requisitos/${requirementId}`);
  await flash("Evidência removida.");
}
