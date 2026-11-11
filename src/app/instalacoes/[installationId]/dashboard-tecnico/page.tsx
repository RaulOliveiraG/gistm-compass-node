import Link from "next/link";
import { shortTitle } from "@/lib/short-titles";
import { format } from "date-fns";
import { computeTechnicalDashboard } from "@/lib/technical-dashboard";
import { classificationLabel } from "@/lib/ai-simulator";
import { PainelTabs } from "@/components/PainelTabs";
import { PageHeader, PageBody, Card, CardHeader, EmptyState, ClassificationBadge } from "@/components/ui";
import { CycleSwitcher } from "@/components/CycleSwitcher";

export const dynamic = "force-dynamic";

const ROBUSTNESS_LABELS: Record<string, string> = {
  ROBUSTA: "Robusta",
  PARCIAL: "Parcial",
  FRACA: "Fraca",
  AUSENTE: "Ausente",
};

const ROBUSTNESS_COLOR: Record<string, string> = {
  ROBUSTA: "#3f6212",
  PARCIAL: "#c2870f",
  FRACA: "#a52a2a",
  AUSENTE: "#c3c2b7",
};

const ACTION_LABELS: Record<string, string> = {
  SUGESTAO_IA_GERADA: "Sugestão de IA gerada",
  AVALIACAO_VALIDADA: "Avaliação validada",
  ACAO_CRIADA: "Ação corretiva criada",
};

export default async function TechnicalDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { installationId } = await params;
  const { cycle: cycleParam } = await searchParams;
  const data = await computeTechnicalDashboard(installationId, cycleParam);
  const { installation, cycle } = data;

  const maxRobustness = Math.max(1, ...Object.values(data.robustnessBreakdown));

  return (
    <div>
      <PageHeader
        toolbar={<PainelTabs installationId={installation.id} />}
        title="Sumário técnico"
        description={`${installation.name} · ${cycle.name} — indicadores para quem está revisando as avaliações, não para a diretoria.`}
        action={<CycleSwitcher cycles={data.allCycles} currentCycleId={cycle.id} />}
      />

      <PageBody className="space-y-6">
        {!data.isLatestCycle && (
          <div className="rounded-lg border border-state-warn-line bg-state-warn-soft px-4 py-3 text-sm text-state-warn">
            Você está visualizando um ciclo encerrado ({cycle.name}), somente leitura.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-mineral-500">Divergência IA × humano</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-mineral-900">
              {data.divergenceRate}%
            </p>
            <p className="mt-1 text-xs text-mineral-500">
              {data.divergences.length} de {data.validatedCount} validado(s)
            </p>
          </Card>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-mineral-500">Sem nenhuma evidência</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-mineral-900">
              {data.noEvidence.length}
            </p>
            <p className="mt-1 text-xs text-mineral-500">de {data.totalRequirements} requisitos</p>
          </Card>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-mineral-500">Aguardando revisão humana</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-mineral-900">
              {data.pendingHumanReview}
            </p>
            <p className="mt-1 text-xs text-mineral-500">sugestão da IA ainda não validada</p>
          </Card>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-mineral-500">Nunca lidos pela IA</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-mineral-900">
              {data.neverRead}
            </p>
            <p className="mt-1 text-xs text-mineral-500">requisitos sem leitura alguma</p>
          </Card>
          <Card className="px-5 py-4">
            <p className="text-xs font-medium text-mineral-500">Documentos possivelmente faltando</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-mineral-900">
              {data.missingDocumentHints.length}
            </p>
            <p className="mt-1 text-xs text-mineral-500">sem correspondência na base documental</p>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Robustez das evidências validadas"
            subtitle="Distribuição entre os requisitos já validados neste ciclo"
          />
          <div className="space-y-3 px-5 py-5">
            {Object.entries(data.robustnessBreakdown).map(([key, value]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs font-medium text-mineral-600">
                  {ROBUSTNESS_LABELS[key]}
                </span>
                <div className="h-2.5 flex-1 rounded-full bg-mineral-100">
                  <div
                    className="h-2.5 rounded-full"
                    style={{
                      width: `${(value / maxRobustness) * 100}%`,
                      backgroundColor: ROBUSTNESS_COLOR[key],
                    }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-mineral-500">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Divergência entre sugestão da IA e decisão humana"
            subtitle="Onde o revisor técnico discordou da última leitura automática — sinaliza pontos em que a IA erra mais"
          />
          {data.divergences.length === 0 ? (
            <EmptyState>Nenhuma divergência registrada — a decisão final acompanhou a sugestão da IA em todos os requisitos validados.</EmptyState>
          ) : (
            <div className="px-5 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mineral-200 text-left text-xs text-mineral-500">
                    <th className="py-1.5 pr-3 font-medium">Requisito</th>
                    <th className="py-1.5 pr-3 font-medium">Sugestão da IA</th>
                    <th className="py-1.5 pr-3 font-medium">Decisão final</th>
                    <th className="py-1.5 font-medium">Revisor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mineral-100">
                  {data.divergences.map((d) => (
                    <tr key={d.id}>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/instalacoes/${installation.id}/requisitos/${d.id}${
                            cycleParam ? `?cycle=${cycleParam}` : ""
                          }`}
                          className="text-mineral-700 hover:text-brand-700"
                        >
                          <span className="font-mono text-xs text-mineral-500">{d.code}</span> {shortTitle(d.code, d.title)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="text-xs text-mineral-500">
                          {classificationLabel(d.aiClassification)}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <ClassificationBadge value={d.finalClassification} />
                      </td>
                      <td className="py-2 text-xs text-mineral-500">{d.reviewedBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Requisitos sem nenhuma evidência vinculada"
            subtitle="Nem a IA nem um revisor anexaram evidência ainda — a classificação, se existir, não tem base documental"
          />
          {data.noEvidence.length === 0 ? (
            <EmptyState>Todos os requisitos têm ao menos uma evidência vinculada.</EmptyState>
          ) : (
            <div className="px-5 py-4">
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {data.noEvidence.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/instalacoes/${installation.id}/requisitos/${r.id}${
                        cycleParam ? `?cycle=${cycleParam}` : ""
                      }`}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-mineral-700 hover:bg-mineral-50 hover:text-brand-700"
                    >
                      <span className="font-mono text-xs text-mineral-500">{r.code}</span>
                      <span className="truncate">{shortTitle(r.code, r.title)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Possíveis documentos faltantes"
            subtitle="Requisitos cuja evidência esperada não parece corresponder a nenhum documento da base — independente de já ter evidência formalmente vinculada"
          />
          {data.missingDocumentHints.length === 0 ? (
            <EmptyState>
              Todos os requisitos com evidência esperada cadastrada têm ao menos um documento
              compatível na base.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-mineral-100 px-5">
              {data.missingDocumentHints.map((hint) => (
                <li key={hint.requirementId} className="py-2.5 text-sm">
                  <Link
                    href={`/instalacoes/${installation.id}/requisitos/${hint.requirementId}${
                      cycleParam ? `?cycle=${cycleParam}` : ""
                    }`}
                    className="text-mineral-700 hover:text-brand-700"
                  >
                    <span className="font-mono text-xs text-mineral-500">{hint.code}</span> {shortTitle(hint.code, hint.title)}
                  </Link>
                  <p className="mt-0.5 text-xs text-mineral-500">
                    Esperado: {hint.expectedEvidence}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Atividade recente" subtitle="Últimos 20 eventos da trilha de auditoria, de todos os requisitos" />
          {data.recentActivity.length === 0 ? (
            <EmptyState>Sem eventos registrados neste ciclo.</EmptyState>
          ) : (
            <ul className="divide-y divide-mineral-100 px-5">
              {data.recentActivity.map((log) => (
                <li key={log.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-mineral-700">
                      <span className="font-mono text-xs text-mineral-500">{log.requirementCode}</span>{" "}
                      {ACTION_LABELS[log.action] ?? log.action} · {log.actor}
                    </p>
                    <span className="shrink-0 text-xs text-mineral-500">
                      {format(log.createdAt, "dd/MM/yyyy HH:mm")}
                    </span>
                  </div>
                  {log.note && <p className="mt-0.5 text-xs text-mineral-500">{log.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </div>
  );
}
