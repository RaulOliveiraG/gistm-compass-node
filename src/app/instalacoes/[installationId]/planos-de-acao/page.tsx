import { isBefore } from "date-fns";
import clsx from "clsx";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getInstallationContext } from "@/lib/context";
import { PageHeader, PageBody, Card, EmptyState } from "@/components/ui";
import { ActionItem, ACTION_STATUS_META } from "@/components/ActionItem";
import { CycleSwitcher } from "@/components/CycleSwitcher";
import { CriticalityInfo, InfoTip } from "@/components/InfoTip";
import { FilterGroup, ClearFilters, paramValues, type SearchParamsRecord } from "@/components/FilterChips";
import type { GapCriticality } from "@prisma/client";

export const dynamic = "force-dynamic";

const COLUMNS: ("ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA")[] = ["ABERTA", "EM_ANDAMENTO", "CONCLUIDA"];

const CRITICALITY_OPTIONS = [
  { value: "ALTA", label: "Alta", dot: "bg-state-bad" },
  { value: "MEDIA", label: "Média", dot: "bg-[#c2870f]" },
  { value: "BAIXA", label: "Baixa", dot: "bg-state-ok" },
];

const FILTER_KEYS = ["crit", "status", "prio", "resp", "prazo"];

export default async function PlanosDeAcaoPage({
  params,
  searchParams,
}: {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const userName = (await auth())?.user?.name ?? "";
  const { installationId } = await params;
  const sp = await searchParams;
  const cycleParam = typeof sp.cycle === "string" ? sp.cycle : undefined;
  const { installation, cycle, allCycles, isLatestCycle } = await getInstallationContext(
    installationId,
    cycleParam
  );

  const [actions, allInstallationActions, documents] = await Promise.all([
    prisma.action.findMany({
      where: { assessment: { installationId: installation.id, cycleId: cycle.id } },
      include: {
        assessment: { include: { requirement: true } },
        dependsOn: { select: { id: true, description: true, status: true } },
        closureDocument: { select: { id: true, title: true } },
        comments: { orderBy: { createdAt: "desc" } },
        logs: { orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    }),
    // Para calcular o código de ações antigas, criadas antes do campo `code`.
    prisma.action.findMany({
      where: { assessment: { installationId: installation.id } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.documentFile.findMany({
      where: { installationId: installation.id },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);
  const fallbackCode = new Map<string, string>(
    allInstallationActions.map((a, i): [string, string] => [a.id, `PA-${String(i + 1).padStart(3, "0")}`])
  );

  const now = new Date();
  const criticalityOf = (a: (typeof actions)[number]): GapCriticality | null =>
    (a.assessment.status === "VALIDADO" ? a.assessment.finalCriticality : a.assessment.aiCriticality) ??
    a.assessment.finalCriticality ??
    null;
  const isOverdue = (a: (typeof actions)[number]) =>
    a.status !== "CONCLUIDA" && !!a.dueDate && isBefore(a.dueDate, now);

  // Filtros acumulados (item 17)
  const selCrit = paramValues(sp, "crit");
  const selStatus = paramValues(sp, "status");
  const selPrio = paramValues(sp, "prio");
  const selResp = paramValues(sp, "resp");
  const selPrazo = paramValues(sp, "prazo");

  const matches = (a: (typeof actions)[number], skip?: string) =>
    (skip === "crit" || selCrit.length === 0 || selCrit.includes(criticalityOf(a) ?? "")) &&
    (skip === "status" || selStatus.length === 0 || selStatus.includes(a.status)) &&
    (skip === "prio" || selPrio.length === 0 || selPrio.includes(a.priority)) &&
    (skip === "resp" || selResp.length === 0 || selResp.includes(a.responsible)) &&
    (skip === "prazo" || selPrazo.length === 0 || (selPrazo.includes("vencidas") && isOverdue(a)));

  const filtered = actions.filter((a) => matches(a));
  const count = (skip: string, pred: (a: (typeof actions)[number]) => boolean) =>
    actions.filter((a) => matches(a, skip) && pred(a)).length;
  const responsibles = [...new Set<string>(actions.map((a) => a.responsible))].sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <PageHeader
        title="Planos de ação"
        description={`${actions.length} ação(ões) · ${actions.filter(isOverdue).length} vencida(s)`}
        info={
          <InfoTip label="Como criar ações">
            As ações nascem dos gaps: abra um requisito validado como &quot;Atende parcialmente&quot; ou
            &quot;Não atende&quot; na Análise e use &quot;Nova ação corretiva&quot;. Para concluir uma
            ação é preciso anexar um documento e informar um link como evidência.
          </InfoTip>
        }
        action={<CycleSwitcher cycles={allCycles} currentCycleId={cycle.id} />}
      />

      <PageBody className="space-y-4">
        {!isLatestCycle && (
          <div className="rounded-xl border border-state-warn-line bg-state-warn-soft px-4 py-2.5 text-sm text-state-warn">
            Ciclo encerrado ({cycle.name}) — somente leitura.
          </div>
        )}

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-2xl border border-mineral-200/80 bg-white px-4 py-4 shadow-[var(--shadow-card)]">
            <FilterGroup
              label="Status"
              paramKey="status"
              params={sp}
              options={COLUMNS.map((s) => ({
                value: s,
                label: ACTION_STATUS_META[s].label,
                dot: ACTION_STATUS_META[s].dot,
                count: count("status", (a) => a.status === s),
              }))}
            />
            <FilterGroup
              label="Criticidade"
              paramKey="crit"
              params={sp}
              info={<CriticalityInfo />}
              options={CRITICALITY_OPTIONS.map((o) => ({
                ...o,
                count: count("crit", (a) => criticalityOf(a) === o.value),
              }))}
            />
            <FilterGroup
              label="Prioridade"
              paramKey="prio"
              params={sp}
              options={[
                { value: "ALTA", label: "Alta", count: count("prio", (a) => a.priority === "ALTA") },
                { value: "MEDIA", label: "Média", count: count("prio", (a) => a.priority === "MEDIA") },
                { value: "BAIXA", label: "Baixa", count: count("prio", (a) => a.priority === "BAIXA") },
              ]}
            />
            <FilterGroup
              label="Prazo"
              paramKey="prazo"
              params={sp}
              options={[{ value: "vencidas", label: "Vencidas", dot: "bg-state-bad", count: count("prazo", isOverdue) }]}
            />
            {responsibles.length > 1 && (
              <FilterGroup
                label="Responsável"
                paramKey="resp"
                params={sp}
                options={responsibles.map((r) => ({
                  value: r,
                  label: r,
                  count: count("resp", (a) => a.responsible === r),
                }))}
              />
            )}
            <ClearFilters params={sp} keys={FILTER_KEYS} />
          </div>
        )}

        {actions.length === 0 ? (
          <Card>
            <EmptyState>
              <span className="flex flex-col items-center gap-1">
                <span className="text-base font-medium text-mineral-700">Nenhuma ação neste ciclo</span>
                <span>Crie ações a partir dos gaps, dentro de cada requisito na Análise.</span>
              </span>
            </EmptyState>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {COLUMNS.filter((c) => selStatus.length === 0 || selStatus.includes(c)).map((status) => {
              const items = filtered.filter((a) => a.status === status);
              const meta = ACTION_STATUS_META[status];
              return (
                <section key={status} className="flex flex-col rounded-2xl bg-mineral-100/60 p-3">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <h2 className="flex items-center gap-2 font-sans text-sm font-semibold text-mineral-900">
                      <span className={clsx("h-2.5 w-2.5 rounded-full", meta.dot)} />
                      {meta.label}
                    </h2>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-mineral-600">
                      {items.length}
                    </span>
                  </div>
                  <div className="flex-1 space-y-3">
                    {items.length === 0 ? (
                      <p className="px-1 py-6 text-center text-xs text-mineral-500">Nenhuma ação.</p>
                    ) : (
                      items.map((action) => (
                        <ActionItem
                          key={action.id}
                          action={action}
                          code={fallbackCode.get(action.id)}
                          criticality={criticalityOf(action)}
                          requirementCode={action.assessment.requirement.code}
                          requirementHref={`/instalacoes/${installation.id}/requisitos/${action.assessment.requirementId}`}
                          installationId={installation.id}
                          requirementId={action.assessment.requirementId}
                          documents={documents}
                          overdue={isOverdue(action)}
                          defaultAuthor={userName}
                          readOnly={!isLatestCycle}
                          hideStatus
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </PageBody>
    </div>
  );
}
