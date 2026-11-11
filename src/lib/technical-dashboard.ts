import { prisma } from "@/lib/prisma";
import { getInstallationContext } from "@/lib/context";
import { detectMissingDocumentHints, type MissingDocumentHint } from "@/lib/missing-documents";
import type { EvidenceRobustness, FinalClassification } from "@prisma/client";

export interface DivergenceItem {
  id: string;
  code: string;
  title: string;
  aiClassification: FinalClassification;
  finalClassification: FinalClassification;
  reviewedBy: string | null;
}

export interface NoEvidenceItem {
  id: string;
  code: string;
  title: string;
  status: string;
}

export interface ActivityItem {
  id: string;
  requirementCode: string;
  actor: string;
  action: string;
  note: string | null;
  createdAt: Date;
}

export async function computeTechnicalDashboard(installationId: string, cycleId?: string) {
  const { installation, cycle, allCycles, isLatestCycle } = await getInstallationContext(
    installationId,
    cycleId
  );

  const [requirements, assessments, documents] = await Promise.all([
    prisma.requirement.findMany({ orderBy: { code: "asc" } }),
    prisma.assessment.findMany({
      where: { installationId: installation.id, cycleId: cycle.id },
      include: {
        requirement: true,
        auditLogs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    }),
    prisma.documentFile.findMany({
      where: { installationId: installation.id },
      select: { title: true, extractedText: true },
    }),
  ]);

  const assessmentByRequirement = new Map(assessments.map((a) => [a.requirementId, a]));

  const missingDocumentHints: MissingDocumentHint[] = detectMissingDocumentHints(
    requirements.filter((r) => {
      const a = assessmentByRequirement.get(r.id);
      return (a?.finalClassification ?? a?.aiClassification) !== "NAO_SE_APLICA";
    }),
    documents
  );

  // Divergência IA x revisor humano: onde a classificação final validada
  // discorda da última sugestão da IA — mostra onde o julgamento humano está
  // corrigindo (ou contestando) a leitura automática com mais frequência.
  const divergences: DivergenceItem[] = assessments
    .filter(
      (a) =>
        a.status === "VALIDADO" &&
        a.aiClassification !== null &&
        a.finalClassification !== null &&
        a.aiClassification !== a.finalClassification
    )
    .map((a) => ({
      id: a.requirementId,
      code: a.requirement.code,
      title: a.requirement.title,
      aiClassification: a.aiClassification!,
      finalClassification: a.finalClassification!,
      reviewedBy: a.reviewedBy,
    }));

  const validated = assessments.filter((a) => a.status === "VALIDADO");
  const robustnessBreakdown: Record<EvidenceRobustness, number> = {
    ROBUSTA: 0,
    PARCIAL: 0,
    FRACA: 0,
    AUSENTE: 0,
  };
  for (const a of validated) {
    if (a.finalRobustness) robustnessBreakdown[a.finalRobustness]++;
  }

  // Requisitos sem NENHUMA evidência vinculada (nem sugerida pela IA, nem
  // anexada manualmente) — um risco de auditoria concreto: o requisito pode
  // até ter uma classificação, mas não tem nada que a sustente.
  const evidenceCounts = await prisma.evidence.groupBy({
    by: ["requirementId"],
    where: { document: { installationId: installation.id } },
    _count: { _all: true },
  });
  const requirementIdsWithEvidence = new Set(evidenceCounts.map((e) => e.requirementId));
  const isNotApplicable = (id: string) => {
    const a = assessmentByRequirement.get(id);
    return (a?.finalClassification ?? a?.aiClassification) === "NAO_SE_APLICA";
  };
  const noEvidence: NoEvidenceItem[] = requirements
    .filter((r) => !requirementIdsWithEvidence.has(r.id) && !isNotApplicable(r.id))
    .map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      status: assessmentByRequirement.get(r.id)?.status ?? "SUGESTAO_IA",
    }));

  const confidences = assessments
    .map((a) => a.aiConfidence)
    .filter((c): c is number => c !== null);
  const avgAiConfidence =
    confidences.length > 0
      ? Math.round((confidences.reduce((s, c) => s + c, 0) / confidences.length) * 100)
      : null;
  const lowConfidenceCount = assessments.filter(
    (a) => a.aiConfidence !== null && a.aiConfidence < 0.5
  ).length;

  const pendingHumanReview = assessments.filter((a) => a.status === "EM_REVISAO").length;
  const neverRead = requirements.length - assessments.filter((a) => a.aiClassification !== null).length;

  const recentActivity: ActivityItem[] = assessments
    .flatMap((a) => a.auditLogs.map((log) => ({ ...log, requirementCode: a.requirement.code })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map((log) => ({
      id: log.id,
      requirementCode: log.requirementCode,
      actor: log.actor,
      action: log.action,
      note: log.note,
      createdAt: log.createdAt,
    }));

  return {
    installation,
    cycle,
    allCycles,
    isLatestCycle,
    totalRequirements: requirements.length,
    divergences,
    divergenceRate:
      validated.length > 0 ? Math.round((divergences.length / validated.length) * 100) : 0,
    robustnessBreakdown,
    validatedCount: validated.length,
    noEvidence,
    avgAiConfidence,
    lowConfidenceCount,
    pendingHumanReview,
    neverRead,
    recentActivity,
    missingDocumentHints,
  };
}
