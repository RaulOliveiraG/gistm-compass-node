import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { computeInstallationStats } from "@/lib/installation-stats";
import { complianceColor } from "@/lib/compliance-color";
import { ReadinessGauge } from "@/components/ReadinessGauge";
import { Card, CardHeader } from "@/components/ui";
import { auth } from "@/auth";
import { withOrgContext } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";

export default async function CompararInstalacoesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const installations = await withOrgContext(session.user.organizationId, async (tx) =>
    tx.installation.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { name: "asc" },
    })
  );

  const rows = await Promise.all(
    installations.map(async (installation) => ({
      installation,
      stats: await computeInstallationStats(installation.id),
    }))
  );

  rows.sort((a, b) => a.stats.readinessScore - b.stats.readinessScore);

  const principleNames = rows[0]?.stats.principleBreakdown.map((p) => `${p.number}`) ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl px-8 py-8">
      <Link
        href="/instalacoes"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-mineral-500 hover:text-mineral-700"
      >
        <ArrowLeft size={14} />
        Todas as estruturas
      </Link>
      <h1 className="text-xl font-semibold text-mineral-900">Comparação entre estruturas</h1>
      <p className="mt-1 max-w-2xl text-sm text-mineral-500">
        Todas as estruturas lado a lado, ordenadas da mais crítica para a mais pronta. Cada célula
        colorida é o % de atendimento daquele tópico do GISTM (T1 a T6), contando só o que já foi
        validado por uma pessoa. Passe o mouse para ver o valor exato.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-mineral-500">Nenhuma instalação cadastrada ainda.</p>
      ) : (
        <Card className="mt-6">
          <CardHeader
            title="Mapa de conformidade"
            subtitle={`${rows.length} estrutura(s) · tópicos 1-${principleNames.length} do GISTM`}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mineral-100 text-left text-xs text-mineral-500">
                  <th className="px-5 py-3 font-medium">Instalação</th>
                  <th className="px-3 py-3 text-center font-medium">Prontidão</th>
                  {rows[0]?.stats.principleBreakdown.map((p) => (
                    <th key={p.number} className="w-16 px-1 py-3 text-center font-medium" title={p.name}>
                      T{p.number}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center font-medium">Atend. geral</th>
                  <th className="px-3 py-3 text-center font-medium">Gaps altos</th>
                  <th className="px-3 py-3 text-center font-medium">Ações vencidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mineral-100">
                {rows.map(({ installation, stats }) => (
                  <tr key={installation.id} className="hover:bg-mineral-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/instalacoes/${installation.id}/dashboard`}
                        className="font-medium text-mineral-800 hover:text-brand-700"
                      >
                        {installation.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-center">
                        <ReadinessGauge score={stats.readinessScore} size={56} showLabel={false} />
                      </div>
                    </td>
                    {stats.principleBreakdown.map((p) => (
                      <td key={p.number} className="px-1 py-3 text-center">
                        <span
                          className="inline-flex h-8 w-12 items-center justify-center rounded text-xs font-medium text-white"
                          style={{
                            backgroundColor: p.pct !== null ? complianceColor(p.pct) : "#e3e4e1",
                            color: p.pct !== null ? "#fff" : "#8b91a1",
                          }}
                          title={`${p.name}: ${p.pct !== null ? `${p.pct}%` : "sem avaliação"} (${p.validatedCount} validado(s))`}
                        >
                          {p.pct !== null ? `${p.pct}%` : "—"}
                        </span>
                      </td>
                    ))}
                    <td className="px-3 py-3 text-center font-medium tabular-nums text-mineral-800">
                      {stats.compliancePct !== null ? `${stats.compliancePct}%` : "—"}
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums">
                      {stats.criticalGaps > 0 ? (
                        <span className="font-medium text-state-bad">{stats.criticalGaps}</span>
                      ) : (
                        <span className="text-mineral-500">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums">
                      {stats.overdueActions > 0 ? (
                        <span className="font-medium text-state-bad">{stats.overdueActions}</span>
                      ) : (
                        <span className="text-mineral-500">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
