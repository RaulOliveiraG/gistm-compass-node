import Link from "next/link";
import { notFound } from "next/navigation";
import { format, addDays } from "date-fns";
import { Sparkles, Trash2, FileText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getInstallationContext } from "@/lib/context";
import { getOrCreateAssessment } from "@/lib/assessments";
import { classificationLabel, criticalityLabel } from "@/lib/ai-simulator";
import { generateActionSuggestion } from "@/lib/ai-action";
import {
  Card,
  CardHeader,
  ClassificationBadge,
  CriticalityBadge,
  EmptyState,
  RobustnessBadge,
  InfoSufficiencyBadge,
} from "@/components/ui";
import {
  runAiSimulation,
  validateAssessment,
  addManualEvidence,
  removeEvidence,
  addComment,
  dismissReviewFlag,
} from "../actions";
import { createAction } from "@/app/instalacoes/[installationId]/planos-de-acao/actions";
import { ActionItem } from "@/components/ActionItem";
import { CycleSwitcher } from "@/components/CycleSwitcher";
import { resolveLang } from "@/lib/lang";
import { shortTitle } from "@/lib/short-titles";
import { ClassificationIcon, CriticalityBars as CritBars } from "@/components/StatusIcons";
import { parseRequirement } from "@/lib/requirement-parts";
import { CriticalityInfo, RobustnessInfo, ClassificationInfo } from "@/components/InfoTip";
import { isAutoNotApplicable } from "@/lib/applicability";

const FINAL_CLASSIFICATIONS = [
  { value: "ATENDE_TOTALMENTE", label: "Atende totalmente" },
  { value: "ATENDE_PARCIALMENTE", label: "Atende parcialmente" },
  { value: "NAO_ATENDE", label: "Não atende" },
  { value: "NAO_SE_APLICA", label: "Não se aplica" },
];
const ROBUSTNESS_OPTIONS = [
  { value: "ROBUSTA", label: "Robusta" },
  { value: "PARCIAL", label: "Parcial" },
  { value: "FRACA", label: "Fraca" },
  { value: "AUSENTE", label: "Ausente" },
];
const CRITICALITY_OPTIONS = [
  { value: "ALTA", label: "Alta" },
  { value: "MEDIA", label: "Média" },
  { value: "BAIXA", label: "Baixa" },
  { value: "NAO_SE_APLICA", label: "Não se aplica (sem gap)" },
];
const INFO_SUFFICIENCY_OPTIONS = [
  { value: "SUFICIENTE", label: "Informação suficiente" },
  { value: "INSUFICIENTE", label: "Informação insuficiente" },
];
const PRIORITY_OPTIONS = [
  { value: "ALTA", label: "Alta" },
  { value: "MEDIA", label: "Média" },
  { value: "BAIXA", label: "Baixa" },
];

export default async function RequirementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ installationId: string; requirementId: string }>;
  searchParams: Promise<{ cycle?: string; template?: string; lang?: string; aiAction?: string }>;
}) {
  const { installationId, requirementId } = await params;
  // Nome de quem está logado: preenche "Revisado por" e "Seu nome".
  const userName = (await auth())?.user?.name ?? "";
  const { cycle: cycleParam, template: templateParam, lang: langParam, aiAction: aiActionParam } =
    await searchParams;
  const lang = await resolveLang(langParam);
  const pick = (pt: string, en: string | null | undefined) => (lang === "en" ? en ?? pt : pt);
  const { installation, cycle, allCycles, isLatestCycle } = await getInstallationContext(
    installationId,
    cycleParam
  );

  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    include: { theme: { include: { principle: true } } },
  });
  if (!requirement) notFound();

  const assessmentRef = await getOrCreateAssessment(requirementId, installation.id, cycle.id);

  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentRef.id },
    include: {
      actions: {
        orderBy: { createdAt: "desc" },
        include: {
          dependsOn: { select: { id: true, description: true, status: true } },
          closureDocument: { select: { id: true, title: true } },
          comments: { orderBy: { createdAt: "desc" } },
          logs: { orderBy: { createdAt: "desc" } },
        },
      },
      auditLogs: { orderBy: { createdAt: "desc" } },
      comments: { orderBy: { createdAt: "desc" } },
      revisions: { orderBy: { version: "desc" } },
    },
  });

  const templates = await prisma.justificationTemplate.findMany({
    where: { themeId: requirement.themeId },
    orderBy: { createdAt: "desc" },
  });
  const selectedTemplate = templateParam
    ? templates.find((t) => t.id === templateParam)
    : undefined;

  // Requirement é compartilhado entre instalações — as evidências precisam
  // ser filtradas pelos documentos desta instalação, senão vazariam
  // evidências de outra estrutura para o mesmo número de requisito.
  const evidences = await prisma.evidence.findMany({
    where: { requirementId, document: { installationId: installation.id } },
    include: { document: true },
    orderBy: { createdAt: "desc" },
  });

  const documents = await prisma.documentFile.findMany({
    where: { installationId: installation.id },
    orderBy: { title: "asc" },
  });

  const canCreateAction =
    isLatestCycle &&
    (assessment.finalClassification === "ATENDE_PARCIALMENTE" ||
      assessment.finalClassification === "NAO_ATENDE");

  // Sugestão de plano de ação a partir do gap: a criticidade definida na
  // revisão técnica vira prioridade e prazo padrão da ação (alta = 30 dias,
  // média = 90, baixa = 180); a descrição nasce com o contexto do requisito
  // já preenchido, restando ao revisor detalhar a ação corretiva em si —
  // nenhum texto de remediação é inventado automaticamente.
  const suggestedPriority: "ALTA" | "MEDIA" | "BAIXA" =
    assessment.finalCriticality === "ALTA" || assessment.finalCriticality === "BAIXA"
      ? assessment.finalCriticality
      : "MEDIA";
  const suggestedDueDateDays =
    suggestedPriority === "ALTA" ? 30 : suggestedPriority === "MEDIA" ? 90 : 180;
  const suggestedDueDate = format(addDays(new Date(), suggestedDueDateDays), "yyyy-MM-dd");

  // Sugestão com IA real é sob demanda (via botão "Sugerir ação com IA", que
  // recarrega a página com ?aiAction=1) — nunca dispara sozinha ao abrir a
  // tela. Se falhar por qualquer motivo, cai de volta pro texto-modelo.
  let suggestedDescription = canCreateAction
    ? `Adequar o atendimento ao requisito ${requirement.code} — "${requirement.title}" ` +
      `(classificado como "${classificationLabel(assessment.finalClassification)}", ` +
      `criticidade ${criticalityLabel(assessment.finalCriticality).toLowerCase()}). ` +
      `Descreva aqui a ação corretiva específica necessária para sanar o gap.`
    : "";
  let suggestedArea = "";
  let aiActionSuggested = false;

  if (canCreateAction && aiActionParam === "1") {
    const realSuggestion = await generateActionSuggestion(
      requirement,
      assessment.finalClassification!,
      assessment.finalRobustness!,
      assessment.finalCriticality!,
      assessment.finalJustification ?? assessment.aiJustification ?? ""
    );
    if (realSuggestion) {
      suggestedDescription = realSuggestion.description;
      suggestedArea = realSuggestion.area ?? "";
      aiActionSuggested = true;
    }
  }

  return (
    <div>
      <div className="content-shell pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="truncate text-xs text-mineral-500">
            <Link href={`/instalacoes/${installation.id}/requisitos`} className="font-medium text-brand-600 hover:underline">
              ← Análise
            </Link>
            {" / "}Princípio {requirement.theme.number}
          </p>
          <CycleSwitcher cycles={allCycles} currentCycleId={cycle.id} />
        </div>

        <div className="mt-3 rounded-2xl border border-mineral-200/80 bg-white px-6 py-5 shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 text-mineral-900" style={{ fontSize: "1.5rem" }}>
              <span className="mr-2 font-mono text-mineral-400">{requirement.code}</span>
              {shortTitle(requirement.code, pick(requirement.title, requirement.titleEn), lang)}
            </h1>
            <div className="flex items-center gap-2">
              <ClassificationIcon
                value={assessment.status === "VALIDADO" ? assessment.finalClassification : assessment.aiClassification}
                validated={assessment.status === "VALIDADO"}
                size={28}
              />
              <CritBars value={assessment.status === "VALIDADO" ? assessment.finalCriticality : assessment.aiCriticality} />
            </div>
          </div>

          {/* Texto oficial com as subdivisões a, b, c (item 13). */}
          {(() => {
            const parts = parseRequirement(pick(requirement.description, requirement.descriptionEn));
            return (
              <details className="group/txt mt-3 max-w-4xl text-sm leading-relaxed text-mineral-700">
                <summary className="cursor-pointer list-none text-xs font-medium text-brand-600 hover:underline [&::-webkit-details-marker]:hidden">
                  <span className="group-open/txt:hidden">Texto oficial{parts.items.length > 0 ? ` (a–${String.fromCharCode(96 + parts.items.length)})` : ""} ▸</span>
                  <span className="hidden group-open/txt:inline">Ocultar texto oficial ▾</span>
                </summary>
                <div className="mt-2">
                {parts.intro && <p>{parts.intro}</p>}
                {parts.items.length > 0 && (
                  <ol className="mt-2 space-y-2">
                    {parts.items.map((it) => (
                      <li key={it.label} className="flex gap-2.5">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                          {it.label}
                        </span>
                        <div className="min-w-0">
                          {it.text && <p>{it.text}</p>}
                          {it.subItems.length > 0 && (
                            <ul className="mt-1 space-y-1 text-mineral-600">
                              {it.subItems.map((si) => (
                                <li key={si.label} className="flex gap-2">
                                  <span className="w-6 shrink-0 text-right font-mono text-xs text-mineral-400">{si.label}.</span>
                                  <span>{si.text}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                </div>
              </details>
            );
          })()}

          {requirement.expectedEvidence && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:underline">
                {lang === "en" ? "Expected evidence" : "Evidência esperada"}
              </summary>
              <p className="mt-1.5 max-w-3xl rounded-lg bg-mineral-50 px-3 py-2 text-xs text-mineral-600">
                {pick(requirement.expectedEvidence, requirement.expectedEvidenceEn)}
              </p>
            </details>
          )}
          {!isLatestCycle && (
            <p className="mt-3 rounded-lg border border-state-warn-line bg-state-warn-soft px-3 py-2 text-xs text-state-warn">
              Ciclo encerrado ({cycle.name}) — somente leitura.
            </p>
          )}
        </div>
      </div>

      <div className="content-shell grid grid-cols-1 gap-6 py-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Evidências e leitura de IA */}
          <Card>
            <CardHeader
              title="Sugestão da IA"
              subtitle={assessment.aiClassification ? "Sugestão para validar" : "Ainda sem sugestão"}
              action={
                isLatestCycle && (
                  <form action={runAiSimulation.bind(null, installation.id, requirement.id)}>
                    <button
                      type="submit"
                      className="flex items-center gap-2 rounded-lg bg-mineral-900 px-3 py-2 text-xs font-medium text-white hover:bg-mineral-700"
                    >
                      <Sparkles size={14} />
                      {assessment.aiClassification ? "Rodar de novo" : "Rodar análise"}
                    </button>
                  </form>
                )
              }
            />
            <div className="px-5 py-4">
              {assessment.aiClassification ? (
                <div className="mb-4 rounded-lg bg-mineral-50 p-4">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <ClassificationBadge value={assessment.aiClassification} />
                    <RobustnessBadge value={assessment.aiRobustness} />
                    <CritBars value={assessment.aiCriticality} />
                    {assessment.aiInfoSufficiency === "INSUFICIENTE" && (
                      <InfoSufficiencyBadge value={assessment.aiInfoSufficiency} />
                    )}
                  </div>
                  {isAutoNotApplicable(assessment.aiJustification) ? (
                    <p className="text-sm text-mineral-700">{assessment.aiJustification}</p>
                  ) : (
                    <OneLine text={assessment.aiJustification ?? ""} />
                  )}
                </div>
              ) : (
                <EmptyState>Sem sugestão ainda.</EmptyState>
              )}

              <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-mineral-500">
                Evidências ({evidences.length})
              </h4>
              {evidences.length === 0 ? (
                <p className="text-sm text-mineral-500">Nenhuma evidência vinculada ainda.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {evidences.map((ev) => (
                    <li key={ev.id} className="max-w-full">
                      <details className="group/ev rounded-xl border border-mineral-200 bg-white open:w-full open:bg-mineral-50">
                        <summary
                          className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-mineral-800 [&::-webkit-details-marker]:hidden"
                          title={ev.excerpt}
                        >
                          <FileText size={13} className="shrink-0 text-mineral-400" />
                          <span className="max-w-[16rem] truncate">{ev.document.title}</span>
                          {ev.aiGenerated && (
                            <span className="rounded-full border border-dashed border-brand-300 px-1.5 text-[10px] font-semibold text-brand-600">IA</span>
                          )}
                        </summary>
                        <div className="flex items-start justify-between gap-3 border-t border-mineral-100 px-3 py-2">
                          <p className="text-xs text-mineral-600">{ev.excerpt}</p>
                          {isLatestCycle && (
                            <form action={removeEvidence.bind(null, installation.id, requirement.id, ev.id)}>
                              <button type="submit" title="Remover evidência" className="rounded p-1 text-mineral-300 hover:bg-red-50 hover:text-red-600">
                                <Trash2 size={14} />
                              </button>
                            </form>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}

              {isLatestCycle && (
              <details className="mt-4 border-t border-mineral-100 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-brand-600 hover:underline">
                + Vincular evidência manualmente
              </summary>
              <form action={addManualEvidence} className="mt-3 space-y-2">
                <input type="hidden" name="installationId" value={installation.id} />
                <input type="hidden" name="requirementId" value={requirement.id} />
                <div className="flex gap-2">
                  <select name="documentId" className="input" required defaultValue="">
                    <option value="" disabled>
                      Selecione um documento
                    </option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  name="excerpt"
                  required
                  rows={2}
                  className="input"
                  placeholder="Trecho ou referência da evidência dentro do documento"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-mineral-300 px-3 py-1.5 text-xs font-medium text-mineral-700 hover:bg-mineral-50"
                >
                  Adicionar evidência
                </button>
              </form>
              </details>
              )}
            </div>
          </Card>

          {/* Revisão técnica humana */}
          <Card>
            {assessment.reviewFlag && isLatestCycle && (
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-state-warn-line bg-state-warn-soft px-5 py-3.5 text-sm text-state-warn">
                <div className="min-w-0">
                  <p className="font-semibold">Rever: documento novo</p>
                  <p className="mt-0.5 text-mineral-700">{assessment.reviewFlag}</p>
                </div>
                <form action={dismissReviewFlag.bind(null, installation.id, assessment.id, requirement.id)}>
                  <button type="submit" className="btn-secondary">
                    Manter decisão
                  </button>
                </form>
              </div>
            )}
            <CardHeader
              title="Validação"
              subtitle={
                assessment.status === "VALIDADO"
                  ? `Validado por ${assessment.reviewedBy} em ${format(
                      assessment.reviewedAt!,
                      "dd/MM/yyyy HH:mm"
                    )}`
                  : "Confirme ou corrija a sugestão"
              }
            />
            {!isLatestCycle ? (
              <div className="space-y-3 px-5 py-5 text-sm">
                <div className="flex flex-wrap gap-2">
                  <ClassificationBadge value={assessment.finalClassification} />
                  <RobustnessBadge value={assessment.finalRobustness} />
                  <CriticalityBadge value={assessment.finalCriticality} />
                  <InfoSufficiencyBadge value={assessment.finalInfoSufficiency} />
                </div>
                <p className="text-mineral-700">
                  {assessment.finalJustification ?? "Sem justificativa registrada neste ciclo."}
                </p>
              </div>
            ) : (
            <form
              action={validateAssessment}
              key={`${assessment.updatedAt.toISOString()}-${templateParam ?? ""}`}
              className="space-y-4 px-5 py-5"
            >
              <input type="hidden" name="installationId" value={installation.id} />
              <input type="hidden" name="assessmentId" value={assessment.id} />
              <input type="hidden" name="requirementId" value={requirement.id} />
              <input type="hidden" name="themeId" value={requirement.themeId} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Classificação final" info={<ClassificationInfo />}>
                  <select
                    name="finalClassification"
                    className="input"
                    defaultValue={
                      assessment.finalClassification ?? assessment.aiClassification ?? ""
                    }
                    required
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {FINAL_CLASSIFICATIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Robustez da evidência" info={<RobustnessInfo />}>
                  <select
                    name="finalRobustness"
                    className="input"
                    defaultValue={assessment.finalRobustness ?? assessment.aiRobustness ?? ""}
                    required
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {ROBUSTNESS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Criticidade do gap" info={<CriticalityInfo align="right" />}>
                  <select
                    name="finalCriticality"
                    className="input"
                    defaultValue={assessment.finalCriticality ?? assessment.aiCriticality ?? ""}
                    required
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {CRITICALITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Condição interna de análise">
                  <select
                    name="finalInfoSufficiency"
                    className="input"
                    defaultValue={
                      assessment.finalInfoSufficiency ?? assessment.aiInfoSufficiency ?? ""
                    }
                    required
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {INFO_SUFFICIENCY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {templates.length > 0 && (
                <div className="rounded-lg bg-mineral-50 px-3 py-2.5">
                  <p className="mb-1.5 text-xs font-medium text-mineral-600">
                    Modelos de justificativa aprovados para este princípio
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((t) => (
                      <Link
                        key={t.id}
                        href={`?${new URLSearchParams({
                          ...(cycleParam ? { cycle: cycleParam } : {}),
                          template: t.id,
                        }).toString()}`}
                        className={
                          "rounded-full border px-2.5 py-1 text-xs " +
                          (templateParam === t.id
                            ? "border-brand-500 bg-brand-50 text-brand-700"
                            : "border-mineral-300 text-mineral-600 hover:bg-white")
                        }
                        title={t.text}
                      >
                        {t.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <Field label="Justificativa técnica final">
                <textarea
                  name="finalJustification"
                  rows={4}
                  className="input"
                  defaultValue={
                    selectedTemplate?.text ??
                    assessment.finalJustification ??
                    assessment.aiJustification ??
                    ""
                  }
                  required
                />
              </Field>

              <Field label="Revisado por">
                <input
                  name="reviewedBy"
                  className="input max-w-xs"
                  defaultValue={assessment.reviewedBy ?? userName}
                  placeholder="Nome do revisor técnico"
                  required
                />
              </Field>

              <details>
                <summary className="cursor-pointer text-xs font-medium text-mineral-500 hover:text-brand-600">
                  Salvar como modelo de justificativa
                </summary>
                <div className="mt-2 space-y-2">
                  <label className="flex items-start gap-2 text-xs text-mineral-600">
                    <input type="checkbox" name="saveAsTemplate" className="mt-0.5" />
                    <span>Reutilizar este texto em outros requisitos deste princípio</span>
                  </label>
                  <input name="templateTitle" className="input" placeholder="Título curto do modelo" />
                </div>
              </details>

              <button
                type="submit"
                className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                {assessment.status === "VALIDADO" ? "Revalidar avaliação" : "Validar avaliação"}
              </button>
            </form>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* Plano de ação */}
          <Card>
            <CardHeader title={`Plano de ação (${assessment.actions.length})`} />
            <div className="px-5 py-4">
              {assessment.actions.length === 0 ? (
                <p className="text-sm text-mineral-500">Nenhuma ação registrada.</p>
              ) : (
                <ul className="space-y-3">
                  {assessment.actions.map((action) => (
                    <li key={action.id}>
                      <ActionItem
                        action={action}
                        installationId={installation.id}
                        requirementId={requirement.id}
                        documents={documents.map((d) => ({ id: d.id, title: d.title }))}
                        readOnly={!isLatestCycle}
                        defaultAuthor={userName}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {canCreateAction ? (
                <details className="mt-4 border-t border-mineral-100 pt-3" open={aiActionParam === "1"}>
                  <summary className="cursor-pointer list-none text-xs font-medium text-brand-600 hover:underline [&::-webkit-details-marker]:hidden">
                    + Nova ação
                  </summary>
                <form
                  action={createAction}
                  key={`action-${aiActionParam ?? "template"}`}
                  className="mt-3 space-y-2"
                >
                  <input type="hidden" name="installationId" value={installation.id} />
                  <input type="hidden" name="assessmentId" value={assessment.id} />
                  <input type="hidden" name="requirementId" value={requirement.id} />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-mineral-500">
                      {aiActionSuggested ? "Sugerida pela IA — revise" : "Revise antes de criar"}
                    </p>
                    <Link
                      href={`?${new URLSearchParams({
                        ...(cycleParam ? { cycle: cycleParam } : {}),
                        aiAction: "1",
                      }).toString()}`}
                      className="flex shrink-0 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
                    >
                      <Sparkles size={11} />
                      Sugerir ação com IA
                    </Link>
                  </div>
                  <textarea
                    name="description"
                    required
                    rows={3}
                    className="input"
                    defaultValue={suggestedDescription}
                  />
                  <input
                    name="responsible"
                    required
                    className="input"
                    placeholder="Responsável"
                    defaultValue={installation.rtfeName ?? ""}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input name="area" className="input" placeholder="Área (opcional)" defaultValue={suggestedArea} />
                    <input type="date" name="dueDate" className="input" defaultValue={suggestedDueDate} />
                  </div>
                  <select name="priority" className="input" defaultValue={suggestedPriority}>
                    {PRIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        Prioridade {o.label.toLowerCase()}
                      </option>
                    ))}
                  </select>
                  {assessment.actions.length > 0 && (
                    <select name="dependsOnId" className="input" defaultValue="">
                      <option value="">Sem dependência</option>
                      {assessment.actions.map((a) => (
                        <option key={a.id} value={a.id}>
                          Depende de: {a.description.slice(0, 60)}
                          {a.description.length > 60 ? "…" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    className="rounded-lg border border-mineral-300 px-3 py-1.5 text-xs font-medium text-mineral-700 hover:bg-mineral-50"
                  >
                    Criar ação
                  </button>
                </form>
                </details>
              ) : (
                <p className="mt-4 border-t border-mineral-100 pt-4 text-xs text-mineral-500">
                  Disponível para Parcial ou Não atende.
                </p>
              )}
            </div>
          </Card>

          {/* Comentários e discussão */}
          <Card>
            <CardHeader title={`Comentários (${assessment.comments.length})`} />
            <div className="px-5 py-4">
              {assessment.comments.length === 0 ? (
                <p className="text-sm text-mineral-500">Nenhum ainda.</p>
              ) : (
                <ul className="space-y-3">
                  {assessment.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-mineral-50 px-3 py-2.5 text-xs">
                      <p className="font-medium text-mineral-700">
                        {c.author} · {format(c.createdAt, "dd/MM/yyyy HH:mm")}
                      </p>
                      <p className="mt-1 text-mineral-600">{c.text}</p>
                    </li>
                  ))}
                </ul>
              )}
              {isLatestCycle && (
                <details className="mt-4 border-t border-mineral-100 pt-3">
                  <summary className="cursor-pointer list-none text-xs font-medium text-brand-600 hover:underline [&::-webkit-details-marker]:hidden">
                    + Comentar
                  </summary>
                <form action={addComment} className="mt-3 space-y-2">
                  <input type="hidden" name="installationId" value={installation.id} />
                  <input type="hidden" name="assessmentId" value={assessment.id} />
                  <input type="hidden" name="requirementId" value={requirement.id} />
                  <input name="author" required className="input" placeholder="Seu nome" defaultValue={userName} />
                  <textarea
                    name="text"
                    required
                    rows={2}
                    className="input"
                    placeholder="Deixe uma observação para a equipe..."
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-mineral-300 px-3 py-1.5 text-xs font-medium text-mineral-700 hover:bg-mineral-50"
                  >
                    Comentar
                  </button>
                </form>
                </details>
              )}
            </div>
          </Card>

          {/* Histórico estruturado de decisões */}
          {assessment.revisions.length > 0 && (
            <Card>
              <CardHeader
                title="Histórico de decisões"
                subtitle={`${assessment.revisions.length} revisão(ões) registrada(s)`}
              />
              <div className="px-5 py-4">
                <ul className="space-y-3">
                  {assessment.revisions.map((rev) => (
                    <li key={rev.id} className="rounded-lg border border-mineral-100 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium text-mineral-700">v{rev.version}</span>
                        <span className="text-mineral-500">
                          {format(rev.createdAt, "dd/MM/yyyy HH:mm")}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <ClassificationBadge value={rev.finalClassification} />
                        <CriticalityBadge value={rev.finalCriticality} />
                      </div>
                      <p className="mt-1.5 text-mineral-500">
                        {rev.reviewedBy}: {rev.finalJustification}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {/* Trilha de auditoria */}
          <Card>
            <details>
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-semibold text-mineral-900">Trilha de auditoria</span>
              <span className="text-xs text-mineral-500">{assessment.auditLogs.length} evento(s) · ver</span>
            </summary>
            <div className="border-t border-mineral-100 px-5 py-4">
              {assessment.auditLogs.length === 0 ? (
                <p className="text-sm text-mineral-500">Sem eventos registrados.</p>
              ) : (
                <ul className="space-y-3">
                  {assessment.auditLogs.map((log) => (
                    <li key={log.id} className="text-xs">
                      <p className="font-medium text-mineral-700">
                        {actionLabel(log.action)} · {log.actor}
                      </p>
                      {log.note && <p className="text-mineral-500">{log.note}</p>}
                      <p className="text-mineral-500">
                        {format(log.createdAt, "dd/MM/yyyy HH:mm")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  info,
  children,
}: {
  label: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  // <div> quando há ícone "i": um <details> não pode ficar dentro de <label>.
  if (info) {
    return (
      <div className="block">
        <span className="mb-1 flex items-center gap-1 text-xs font-medium text-mineral-600">
          {label}
          {info}
        </span>
        {children}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-mineral-600">{label}</span>
      {children}
    </label>
  );
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    SUGESTAO_IA_GERADA: "Sugestão de IA gerada",
    NAO_SE_APLICA_AUTOMATICO: "\"Não se aplica\" automático",
    REVISAO_SUGERIDA: "Documento novo sugere revisão",
    REVISAO_DISPENSADA: "Aviso de revisão dispensado",
    AVALIACAO_VALIDADA: "Avaliação validada",
    ACAO_CRIADA: "Ação corretiva criada",
  };
  return labels[action] ?? action;
}

/** Justificativa em uma linha: a conclusão visível, o resto em "ver mais". */
function OneLine({ text }: { text: string }) {
  const m = text.match(/^(.+?[.!?])(\s|$)/);
  const first = m ? m[1] : text;
  const rest = text.slice(first.length).trim();
  if (!rest) return <p className="text-sm text-mineral-700">{first}</p>;
  return (
    <details className="group/j">
      <summary className="cursor-pointer list-none text-sm text-mineral-700 [&::-webkit-details-marker]:hidden">
        {first}{" "}
        <span className="text-xs font-medium text-brand-600 group-open/j:hidden">ver mais</span>
      </summary>
      <p className="mt-1 text-sm text-mineral-600">{rest}</p>
    </details>
  );
}
