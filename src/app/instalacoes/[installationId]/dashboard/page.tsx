import Link from "next/link";
import clsx from "clsx";
import { format } from "date-fns";
import {
  ArrowRight,
  AlertTriangle,
  Clock,
  FileWarning,
  HelpCircle,
  RefreshCw,
  UploadCloud,
  Sparkles,
  ListChecks,
  ClipboardList,
  Printer,
  ChevronRight,
} from "lucide-react";
import { computeInstallationReport } from "@/lib/report";
import { readinessLabel } from "@/lib/readiness-score";
import { resolveLang } from "@/lib/lang";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageBody, Card, CardHeader, StatTile, EmptyState } from "@/components/ui";
import { ClassificationIcon, CriticalityBars as CritBars, StatusLegend } from "@/components/StatusIcons";
import { RequirementHeatmap, type HeatmapRow } from "@/components/RequirementHeatmap";
import { shortTitle, shortPrinciple } from "@/lib/short-titles";
import type { FinalClassification } from "@prisma/client";
import { StatusDistributionBar, RankedBarList, CriticalityBars } from "@/components/charts";
import { CycleSwitcher } from "@/components/CycleSwitcher";
import { CompassWheel } from "@/components/CompassWheel";
import { ReadinessGauge } from "@/components/ReadinessGauge";
import { PainelTabs } from "@/components/PainelTabs";
import { InfoTip, CriticalityInfo } from "@/components/InfoTip";
import { startNewCycle } from "../actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ cycle?: string; lang?: string }>;
}) {
  const { installationId } = await params;
  const { cycle: cycleParam, lang: langParam } = await searchParams;
  const lang = await resolveLang(langParam);
  const report = await computeInstallationReport(installationId, cycleParam, lang);
  const { installation, cycle } = report;
  const base = `/instalacoes/${installation.id}`;

  const [aiSuggestionsCount, newDocCount, reviewCount, heatThemes, heatAssessments] = await Promise.all([
    prisma.assessment.count({
      where: { installationId: installation.id, cycleId: cycle.id, aiClassification: { not: null } },
    }),
    prisma.documentFile.count({ where: { installationId: installation.id, analyzedAt: null } }),
    prisma.assessment.count({
      where: { installationId: installation.id, cycleId: cycle.id, reviewFlag: { not: null } },
    }),
    prisma.theme.findMany({ orderBy: { number: "asc" }, include: { requirements: { orderBy: { code: "asc" } } } }),
    prisma.assessment.findMany({ where: { installationId: installation.id, cycleId: cycle.id } }),
  ]);

  // Mapa de calor (menos texto): status efetivo de cada requisito.
  const byReq = new Map(heatAssessments.map((a) => [a.requirementId, a]));
  const codeKey = (c: string) => c.split(".").map((n) => n.padStart(3, "0")).join(".");
  const heatRows: HeatmapRow[] = heatThemes.map((t) => ({
    number: t.number,
    name: shortPrinciple(t.number, lang === "en" ? t.nameEn ?? t.name : t.name, lang),
    href: `${base}/requisitos?p=${t.number}`,
    items: [...t.requirements]
      .sort((a, b) => codeKey(a.code).localeCompare(codeKey(b.code)))
      .map((r) => {
        const a = byReq.get(r.id);
        const validated = a?.status === "VALIDADO";
        return {
          code: r.code,
          title: shortTitle(r.code, r.title, lang),
          href: `${base}/requisitos/${r.id}`,
          cls: ((validated ? a?.finalClassification : a?.aiClassification) ?? null) as FinalClassification | null,
          validated,
        };
      }),
  }));

  const attention = [
    reviewCount > 0 && {
      icon: <RefreshCw size={15} className="text-state-warn" />,
      text: `${reviewCount} validado(s) para rever (documento novo)`,
      href: `${base}/requisitos?st=rever`,
    },
    newDocCount > 0 && aiSuggestionsCount > 0 && {
      icon: <Sparkles size={15} className="text-brand-600" />,
      text: `${newDocCount} documento(s) novo(s) para analisar`,
      href: `${base}/documentos`,
    },
    report.overdueActions.length > 0 && {
      icon: <AlertTriangle size={15} className="text-state-bad" />,
      text: `${report.overdueActions.length} ação(ões) vencida(s)`,
      href: `${base}/planos-de-acao?prazo=vencidas`,
    },
    report.criticalityCounts.alta > 0 && {
      icon: <AlertTriangle size={15} className="text-state-bad" />,
      text: `${report.criticalityCounts.alta} gap(s) de criticidade alta`,
      href: `${base}/requisitos?crit=ALTA`,
    },
    report.upcomingActions.length > 0 && {
      icon: <Clock size={15} className="text-state-warn" />,
      text: `${report.upcomingActions.length} ação(ões) vencendo em 7 dias`,
      href: `${base}/planos-de-acao`,
    },
    report.expiredDocuments.length > 0 && {
      icon: <FileWarning size={15} className="text-state-bad" />,
      text: `${report.expiredDocuments.length} documento(s) vencido(s)`,
      href: `${base}/documentos`,
    },
    report.expiringDocuments.length > 0 && {
      icon: <FileWarning size={15} className="text-state-warn" />,
      text: `${report.expiringDocuments.length} documento(s) vencendo em 30 dias`,
      href: `${base}/documentos`,
    },
    report.insufficientInfo.length > 0 && {
      icon: <HelpCircle size={15} className="text-state-warn" />,
      text: `${report.insufficientInfo.length} requisito(s) com informação insuficiente`,
      href: `${base}/requisitos`,
    },
    report.pendingRevalidation.length > 0 && {
      icon: <RefreshCw size={15} className="text-state-warn" />,
      text: `${report.pendingRevalidation.length} requisito(s) para revalidar (documento substituído)`,
      href: `${base}/documentos`,
    },
  ].filter(Boolean) as { icon: React.ReactNode; text: string; href: string }[];

  // "O que você precisa fazer?" (item 27): atalhos grandes para as tarefas.
  const tasks = [
    {
      href: `${base}/documentos`,
      icon: UploadCloud,
      title: "Importar documentação",
      text: report.documentsCount > 0 ? `${report.documentsCount} documento(s) na base` : "Arquivos ou uma pasta",
      tint: "bg-brand-50 text-brand-600",
    },
    {
      href: `${base}/requisitos`,
      icon: Sparkles,
      title: "Rodar análise",
      text:
        newDocCount > 0 && aiSuggestionsCount > 0
          ? `${newDocCount} documento(s) novo(s)`
          : aiSuggestionsCount > 0
            ? `${aiSuggestionsCount} requisitos com sugestão`
            : "A IA lê a documentação",
      tint: "bg-[#efeafb] text-[#5b3fb0]",
    },
    {
      href: `${base}/requisitos?st=pendente`,
      icon: ListChecks,
      title: "Validar sugestões",
      text: report.pendingAiReview.length > 0 ? `${report.pendingAiReview.length} aguardando` : `${report.validatedCount}/${report.totalRequirements} validados`,
      tint: "bg-state-warn-soft text-state-warn",
    },
    {
      href: `${base}/planos-de-acao`,
      icon: ClipboardList,
      title: "Planos de ação",
      text: `${report.openActions.length} em aberto`,
      tint: "bg-state-ok-soft text-state-ok",
    },
  ];

  return (
    <div>
      <PageHeader
        toolbar={<PainelTabs installationId={installation.id} search={cycleParam ? `cycle=${cycleParam}` : undefined} />}
        title="Sumário executivo"
        description={`${installation.name} · ${cycle.name}`}
        action={
          <div className="flex items-center gap-2">
            <CycleSwitcher cycles={report.allCycles} currentCycleId={cycle.id} />
            <Link
              href={`${base}/relatorio?print=1${cycleParam ? `&cycle=${cycleParam}` : ""}`}
              className="btn-secondary rounded-full"
            >
              <Printer size={15} />
              Gerar PDF
            </Link>
          </div>
        }
      />

      <PageBody className="space-y-6">
        {!report.isLatestCycle && (
          <div className="rounded-xl border border-state-warn-line bg-state-warn-soft px-4 py-2.5 text-sm text-state-warn">
            Ciclo encerrado ({cycle.name}) — somente leitura.
          </div>
        )}

        {/* O que você precisa fazer? */}
        <section>
          <h2 className="mb-3 text-mineral-900" style={{ fontSize: "var(--text-title)" }}>
            O que você precisa fazer?
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {tasks.map(({ href, icon: Icon, title, text, tint }) => (
              <Link
                key={title}
                href={href}
                className="group flex items-center gap-4 rounded-2xl border border-mineral-200/80 bg-white px-5 py-4 shadow-[var(--shadow-card)] transition-colors hover:border-brand-300"
              >
                <span className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tint)}>
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-mineral-900">{title}</span>
                  <span className="block truncate text-xs text-mineral-500">{text}</span>
                </span>
                <ArrowRight size={16} className="shrink-0 text-mineral-300 transition-colors group-hover:text-brand-500" />
              </Link>
            ))}
          </div>
        </section>


        {/* Indicadores principais em destaque */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card className="flex items-center gap-4 px-5 py-4">
            <ReadinessGauge score={report.readinessScore} size={72} showLabel={false} />
            <div>
              <div className="flex items-center gap-1 text-xs font-medium text-mineral-500">
                Prontidão
                <InfoTip label="Como o índice é calculado">
                  0 a 100, só com o que foi validado. Pronta ≥ 70 · Atenção ≥ 40 · Crítica &lt; 40.
                </InfoTip>
              </div>
              <p className="font-display text-xl font-semibold text-mineral-900">{readinessLabel(report.readinessScore)}</p>
            </div>
          </Card>
          <StatTile
            label="Atendimento"
            value={report.overallCompliance !== null ? `${report.overallCompliance}%` : "—"}
            hint={`${report.totalmente} de ${report.applicable} aplicáveis`}
            tone="good"
          />
          <StatTile
            label="Validados"
            value={`${report.validatedCount}/${report.totalRequirements}`}
            hint={report.aiOnlyCount > 0 ? `+${report.aiOnlyCount} sugeridos pela IA` : undefined}
          />
          <StatTile
            label="Gaps altos"
            value={String(report.criticalityCounts.alta)}
            tone={report.criticalityCounts.alta > 0 ? "critical" : "default"}
            info={<CriticalityInfo />}
          />
          <StatTile
            label="Ações vencidas"
            value={String(report.overdueActions.length)}
            hint={`${report.openActions.length} em aberto`}
            tone={report.overdueActions.length > 0 ? "critical" : "good"}
          />
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader
              title="Bússola GISTM"
              action={
                <div className="hidden flex-wrap gap-3 text-xs text-mineral-500 sm:flex">
                  <Legend color="#3f6212" label="Boa" />
                  <Legend color="#c2870f" label="Atenção" />
                  <Legend color="#a52a2a" label="Crítico" />
                  <Legend color="#b3bfc1" label="Sem análise" />
                </div>
              }
            />
            <div className="flex items-center justify-center p-6">
              <CompassWheel
                themes={report.wheelThemes}
                installationId={installation.id}
                center={<ReadinessGauge score={report.readinessScore} />}
                lang={lang}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Precisa de atenção"
              subtitle={attention.length === 0 ? "Tudo em dia" : `${attention.length} ponto(s)`}
            />
            {attention.length === 0 ? (
              <EmptyState>Nenhum alerta no momento.</EmptyState>
            ) : (
              <ul className="divide-y divide-mineral-100">
                {attention.map((item) => (
                  <li key={item.text}>
                    <Link href={item.href} className="flex items-center gap-2.5 px-5 py-3 text-sm hover:bg-mineral-50">
                      {item.icon}
                      <span className="flex-1 text-mineral-700">{item.text}</span>
                      <ChevronRight size={14} className="text-mineral-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Classificação" subtitle={`${report.analyzedCount} requisito(s) analisado(s)`} />
            <div className="px-5 py-5">
              {report.analyzedCount === 0 ? (
                <EmptyState>Rode a análise da IA para ver a distribuição.</EmptyState>
              ) : (
                <StatusDistributionBar segments={report.distributionSegments} total={report.analyzedCount} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Criticidade dos gaps" />
            <div className="px-5 py-5">
              {report.criticalityCounts.alta + report.criticalityCounts.media + report.criticalityCounts.baixa === 0 ? (
                <EmptyState>Nenhum gap registrado.</EmptyState>
              ) : (
                <CriticalityBars
                  alta={report.criticalityCounts.alta}
                  media={report.criticalityCounts.media}
                  baixa={report.criticalityCounts.baixa}
                />
              )}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Mapa dos 77 requisitos"
            action={<span className="hidden sm:block"><StatusLegend /></span>}
          />
          <div className="overflow-x-auto px-5 py-5">
            <RequirementHeatmap rows={heatRows} />
          </div>
        </Card>

        {/* Detalhes recolhidos: texto e listas longas só para quem quiser. */}
        <details className="group rounded-2xl border border-mineral-200/80 bg-white shadow-[var(--shadow-card)]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-semibold text-mineral-900">Mais detalhes</span>
            <span className="flex items-center gap-1 text-xs text-mineral-500">
              <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            </span>
          </summary>
          <div className="space-y-6 border-t border-mineral-100 px-5 py-5">
            <section>
              <p className="label-caps mb-2">Síntese executiva</p>
              <p className="max-w-4xl text-sm leading-relaxed text-mineral-700">{report.executiveSummary}</p>
              {report.previousCycleComparison && report.previousCycleComparison.delta !== null && (
                <p className="mt-2 text-sm text-mineral-600">
                  Em relação a {report.previousCycleComparison.previousCycleName}:{" "}
                  <span
                    className={clsx(
                      "font-semibold",
                      report.previousCycleComparison.delta > 0 ? "text-state-ok" : report.previousCycleComparison.delta < 0 ? "text-state-bad" : "text-mineral-700"
                    )}
                  >
                    {report.previousCycleComparison.delta > 0 ? "+" : ""}
                    {report.previousCycleComparison.delta} p.p.
                  </span>
                </p>
              )}
            </section>

            <section>
              <p className="label-caps mb-2">Atendimento por princípio (%)</p>
              <RankedBarList items={report.themeBars} maxValue={100} />
            </section>

            <section>
              <p className="label-caps mb-2">Atendimento por tópico</p>
              <RankedBarList items={report.principleBars} maxValue={100} />
            </section>

            <section>
              <p className="label-caps mb-2">Lacunas ({report.gapsList.length})</p>
              {report.gapsList.length === 0 ? (
                <p className="text-sm text-mineral-500">Nenhuma lacuna registrada.</p>
              ) : (
                <ul className="max-h-96 divide-y divide-mineral-100 overflow-y-auto rounded-xl border border-mineral-100">
                  {report.gapsList.map((g) => (
                    <li key={g.id}>
                      <Link href={`${base}/requisitos/${g.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-mineral-50">
                        <span className="w-10 shrink-0 font-mono text-xs text-mineral-500">{g.code}</span>
                        <span className="min-w-0 flex-1 truncate text-mineral-700">{shortTitle(g.code, g.title, lang)}</span>
                        <ClassificationIcon value={g.classification} validated={!g.preliminary} size={20} />
                        <CritBars value={g.criticality} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {report.overdueActions.length > 0 && (
              <section>
                <p className="label-caps mb-2">Ações vencidas</p>
                <ul className="divide-y divide-mineral-100 rounded-xl border border-mineral-100">
                  {report.overdueActions.slice(0, 8).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="truncate text-mineral-700">{a.description}</span>
                      <span className="shrink-0 text-xs font-medium text-state-bad">
                        venceu em {format(a.dueDate!, "dd/MM/yyyy")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {report.isLatestCycle && (
              <section>
                <p className="label-caps mb-2">Ciclos</p>
                {/* Ação que não se desfaz: confirmação antes de encerrar (item 7). */}
                <details className="relative inline-block">
                  <summary className="btn-secondary cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    Encerrar ciclo atual e iniciar novo
                  </summary>
                  <form
                    action={startNewCycle.bind(null, installation.id, cycle.id)}
                    className="mt-2 w-80 space-y-3 rounded-xl border border-mineral-200 bg-white p-4 shadow-[var(--shadow-float)]"
                  >
                    <p className="text-sm font-semibold text-mineral-900">Encerrar {cycle.name}?</p>
                    <p className="text-xs text-mineral-600">
                      O ciclo atual fica só para consulta. O novo começa sem avaliações; os documentos
                      continuam disponíveis. Não dá para reabrir o ciclo encerrado.
                    </p>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-mineral-600">Nome do novo ciclo</span>
                      <input name="name" required className="input w-full" defaultValue={nextCycleName(cycle.name)} />
                    </label>
                    <button type="submit" className="btn-primary w-full">
                      Encerrar e iniciar
                    </button>
                  </form>
                </details>
              </section>
            )}
          </div>
        </details>
      </PageBody>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** "Ciclo 2026.1" → "Ciclo 2026.2"; sem número no fim, sugere o ano atual. */
function nextCycleName(current: string): string {
  const m = current.match(/^(.*?)(\d+)$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  return `Ciclo ${new Date().getFullYear()}.1`;
}
