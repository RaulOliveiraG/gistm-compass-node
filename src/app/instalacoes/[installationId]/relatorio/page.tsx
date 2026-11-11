import { format } from "date-fns";
import { computeInstallationReport } from "@/lib/report";
import { classificationLabel, robustnessLabel, criticalityLabel } from "@/lib/ai-simulator";
import { readinessLabel } from "@/lib/readiness-score";
import { CycleSwitcher } from "@/components/CycleSwitcher";
import { PrintButton } from "@/components/PrintButton";
import { CompassWheel } from "@/components/CompassWheel";
import { ReadinessGauge } from "@/components/ReadinessGauge";
import { resolveLang } from "@/lib/lang";
import { shortTitle } from "@/lib/short-titles";
import { InfoTip } from "@/components/InfoTip";

export const dynamic = "force-dynamic";

export default async function RelatorioPage({
  params,
  searchParams,
}: {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ cycle?: string; nivel?: string; lang?: string; print?: string }>;
}) {
  const { installationId } = await params;
  const { cycle: cycleParam, nivel, lang: langParam, print } = await searchParams;
  const completo = nivel !== "resumido";
  const lang = await resolveLang(langParam);
  const report = await computeInstallationReport(installationId, cycleParam, lang);
  const { installation, cycle } = report;

  const levelHref = (level: "resumido" | "completo") => {
    const qs = new URLSearchParams();
    if (cycleParam) qs.set("cycle", cycleParam);
    if (level === "resumido") qs.set("nivel", "resumido");
    if (lang === "en") qs.set("lang", "en");
    // Sempre prefixado com "?": href="" manteria a query atual (recarrega a
    // mesma URL) em vez de voltar para o estado padrão sem nenhum parâmetro.
    return `?${qs.toString()}`;
  };

  let sectionN = 0;
  const next = () => ++sectionN;

  return (
    <div className="print:bg-white">
      {/* Barra de geração do PDF (item 26): uma ação principal, bem visível. */}
      <div className="mx-auto max-w-4xl px-8 pt-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-mineral-200/80 bg-white px-6 py-5 shadow-[var(--shadow-card)]">
          <div>
            <p className="flex items-center gap-1.5 text-lg font-semibold text-mineral-900">
              Relatório de conformidade
              <InfoTip label="Como salvar o PDF">
                Ao clicar em &quot;Baixar PDF&quot;, a janela de impressão do navegador abre. Em
                &quot;Destino&quot;, escolha &quot;Salvar como PDF&quot;. O relatório usa as mesmas
                classificações do Sumário executivo.
              </InfoTip>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="flex rounded-full border border-mineral-200 p-0.5 text-xs">
                <a
                  href={levelHref("resumido")}
                  className={`rounded-full px-3 py-1 font-medium ${!completo ? "bg-brand-500 text-white" : "text-mineral-600"}`}
                >
                  Resumido
                </a>
                <a
                  href={levelHref("completo")}
                  className={`rounded-full px-3 py-1 font-medium ${completo ? "bg-brand-500 text-white" : "text-mineral-600"}`}
                >
                  Completo
                </a>
              </div>
              <CycleSwitcher cycles={report.allCycles} currentCycleId={cycle.id} />
            </div>
          </div>
          <PrintButton autoPrint={print === "1"} />
        </div>
      </div>

      {/* Capa */}
      <header className="mt-6 bg-brand-800 px-8 py-10 text-white print:mt-0 print:break-after-page">
        <div className="mx-auto max-w-4xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-brand-300">
            GISTM Compass · Relatório consolidado de conformidade
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold leading-tight text-balance">
            {installation.name}
          </h1>
          <p className="mt-2 text-sm text-mineral-300">
            {cycle.name} · gerado em {format(new Date(), "dd/MM/yyyy 'às' HH:mm")}
          </p>

          <div className="mt-8 grid grid-cols-1 items-center gap-8 sm:grid-cols-[auto_1fr]">
            <div className="flex justify-center sm:justify-start">
              <ReadinessGauge score={report.readinessScore} size={132} />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <CoverStat
                label="Atendimento geral"
                value={report.overallCompliance !== null ? `${report.overallCompliance}%` : "—"}
              />
              <CoverStat label="Requisitos validados" value={`${report.validatedCount}/${report.totalRequirements}`} />
              <CoverStat label="Gaps de criticidade alta" value={String(report.criticalityCounts.alta)} />
              <CoverStat label="Ações vencidas" value={String(report.overdueActions.length)} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-8 py-10 print:px-0 print:py-8">
        <Section index={next()} title="Síntese executiva">
          <p className="text-sm leading-relaxed text-mineral-700 print:text-black">
            {report.executiveSummary}
          </p>
        </Section>

        <Section index={next()} title="Panorama visual — Bússola GISTM">
          <div className="flex justify-center">
            <CompassWheel
              themes={report.wheelThemes}
              installationId={installation.id}
              size={320}
              center={<ReadinessGauge score={report.readinessScore} size={90} />}
              lang={lang}
            />
          </div>
          <p className="mt-2 text-center text-xs text-mineral-500 print:hidden">
            Cada fatia é um princípio do GISTM, colorido pelo nível de atendimento — {readinessLabel(report.readinessScore).toLowerCase()}.
          </p>
        </Section>

        <Section index={next()} title="Percentuais de atendimento">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-mineral-100 print:divide-mineral-300">
              <Row label="Atendimento geral" value={report.overallCompliance !== null ? `${report.overallCompliance}%` : "—"} />
              <Row label="Requisitos analisados" value={`${report.analyzedCount} de ${report.totalRequirements}`} />
              <Row label="Validados por um revisor" value={`${report.validatedCount} de ${report.totalRequirements}`} />
              <Row
                label="Atende totalmente"
                value={`${report.totalmente} (${pct(report.totalmente, report.analyzedCount)}%)`}
              />
              <Row
                label="Atende parcialmente"
                value={`${report.parcialmente} (${pct(report.parcialmente, report.analyzedCount)}%)`}
              />
              <Row
                label="Não atende"
                value={`${report.naoAtende} (${pct(report.naoAtende, report.analyzedCount)}%)`}
              />
              <Row
                label="Não se aplica"
                value={`${report.naoSeAplica} (${pct(report.naoSeAplica, report.analyzedCount)}%)`}
              />
            </tbody>
          </table>
        </Section>

        {report.previousCycleComparison && (
          <Section index={next()} title="Comparação com o ciclo anterior">
            <p className="text-sm text-mineral-700 print:text-black">
              {report.previousCycleComparison.previousCycleName}:{" "}
              {report.previousCycleComparison.previousCompliance !== null
                ? `${report.previousCycleComparison.previousCompliance}%`
                : "sem dados"}{" "}
              de atendimento geral
              {report.previousCycleComparison.delta !== null &&
                ` (${report.previousCycleComparison.delta >= 0 ? "+" : ""}${report.previousCycleComparison.delta} p.p. em relação ao ciclo atual)`}
              .
            </p>
          </Section>
        )}

        <Section index={next()} title="Atendimento por área temática (tópico GISTM)">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-mineral-100 print:divide-mineral-300">
              {report.principleBars.map((p) => (
                <Row key={p.key} label={p.label} value={`${Math.round(p.value)}%`} />
              ))}
            </tbody>
          </table>
        </Section>

        {completo && (
        <Section index={next()} title="Atendimento por princípio">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-mineral-100 print:divide-mineral-300">
              {report.themeBars.map((t) => (
                <Row key={t.key} label={t.label} value={`${Math.round(t.value)}%`} />
              ))}
            </tbody>
          </table>
        </Section>
        )}

        <Section index={next()} title="Requisitos com maior gap">
          {report.topGaps.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mineral-200 text-left text-xs text-mineral-500 print:border-black print:text-black">
                  <th className="py-1.5 pr-3 font-medium">Código</th>
                  <th className="py-1.5 pr-3 font-medium">Requisito</th>
                  <th className="py-1.5 pr-3 font-medium">Classificação</th>
                  <th className="py-1.5 font-medium">Criticidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mineral-100 print:divide-mineral-300">
                {report.topGaps.map((g) => (
                  <tr key={g.id}>
                    <td className="py-1.5 pr-3 font-mono text-xs text-mineral-500 print:text-black">{g.code}</td>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">{shortTitle(g.code, g.title, lang)}</td>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">
                      {classificationLabel(g.classification)}
                    </td>
                    <td className="py-1.5 text-mineral-700 print:text-black">
                      {criticalityLabel(g.criticality)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {completo && (
        <Section index={next()} title="Lista consolidada de lacunas">
          {report.gapsList.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mineral-200 text-left text-xs text-mineral-500 print:border-black print:text-black">
                  <th className="py-1.5 pr-3 font-medium">Código</th>
                  <th className="py-1.5 pr-3 font-medium">Requisito</th>
                  <th className="py-1.5 pr-3 font-medium">Classificação</th>
                  <th className="py-1.5 pr-3 font-medium">Robustez</th>
                  <th className="py-1.5 font-medium">Criticidade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mineral-100 print:divide-mineral-300">
                {report.gapsList.map((g) => (
                  <tr key={g.id}>
                    <td className="py-1.5 pr-3 font-mono text-xs text-mineral-500 print:text-black">{g.code}</td>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">{shortTitle(g.code, g.title, lang)}</td>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">
                      {classificationLabel(g.classification)}
                    </td>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">
                      {robustnessLabel(g.robustness)}
                    </td>
                    <td className="py-1.5 text-mineral-700 print:text-black">
                      {criticalityLabel(g.criticality)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        )}

        {completo && (
        <Section index={next()} title="Plano de ação">
          {report.openActions.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mineral-200 text-left text-xs text-mineral-500 print:border-black print:text-black">
                  <th className="py-1.5 pr-3 font-medium">Descrição</th>
                  <th className="py-1.5 pr-3 font-medium">Responsável</th>
                  <th className="py-1.5 pr-3 font-medium">Prazo</th>
                  <th className="py-1.5 font-medium">Prioridade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mineral-100 print:divide-mineral-300">
                {report.openActions.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">{a.description}</td>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">{a.responsible}</td>
                    <td className="py-1.5 pr-3 text-mineral-700 print:text-black">
                      {a.dueDate ? format(a.dueDate, "dd/MM/yyyy") : "—"}
                    </td>
                    <td className="py-1.5 text-mineral-700 print:text-black">{a.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        )}

        <Section index={next()} title="Base documental">
          <p className="text-sm text-mineral-700 print:text-black">
            {report.documentsCount} documento(s) associado(s) a esta instalação, usados como base
            de evidências para as conclusões deste relatório.
          </p>
        </Section>

        <footer className="mt-12 border-t border-mineral-200 pt-4 text-xs text-mineral-500 print:text-black">
          GISTM Compass — relatório gerado automaticamente a partir dos dados registrados na
          plataforma. Classificações sugeridas por IA (simulada) sempre passam por validação
          técnica humana antes de constar como decisão final.
        </footer>
      </div>
    </div>
  );
}

function CoverStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-3 py-2.5 backdrop-blur-sm">
      <p className="text-[11px] uppercase tracking-wide text-mineral-300">{label}</p>
      <p className="mt-0.5 font-display text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Section({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-9 break-inside-avoid">
      <div className="mb-3 flex items-center gap-2.5 border-b border-mineral-200 pb-2 print:border-black">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-800 font-mono text-[10px] font-medium text-white print:bg-black">
          {index}
        </span>
        <h2 className="font-display text-base font-semibold text-mineral-900 print:text-black">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-1.5 pr-3 text-mineral-600 print:text-black">{label}</td>
      <td className="py-1.5 text-right font-medium tabular-nums text-mineral-900 print:text-black">
        {value}
      </td>
    </tr>
  );
}

function Empty() {
  return <p className="text-sm text-mineral-500 print:text-black">Nada a relatar nesta seção.</p>;
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}
