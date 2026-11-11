import Link from "next/link";
import clsx from "clsx";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { getInstallationContext } from "@/lib/context";
import { PageHeader, PageBody, Card } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { InfoTip } from "@/components/InfoTip";
import {
  LEGAL_STATUS_LABEL,
  LEGAL_STATUSES,
  NORMS,
  nextDue,
  obligationsFor,
  recurrenceLabel,
  type LegalStatus,
  type Sphere,
} from "@/lib/legal-catalog";
import { suggestLegalChecks, validateLegalCheck } from "./actions";

export const dynamic = "force-dynamic";

const SPHERE_LABEL: Record<Sphere, string> = {
  GISTM: "GISTM",
  FEDERAL: "Federal",
  ESTADUAL: "Estadual",
  ABNT: "ABNT",
};

const STATUS_STYLE: Record<LegalStatus, string> = {
  CONFORME: "bg-emerald-50 text-emerald-700 border-emerald-200",
  NAO_CONFORME: "bg-red-50 text-red-700 border-red-200",
  NAO_APLICAVEL: "bg-mineral-50 text-mineral-500 border-mineral-200",
  SEM_EVIDENCIA: "bg-amber-50 text-amber-700 border-amber-200",
};

const fmt = (d: Date) => format(d, "dd/MM/yyyy");

export default async function NormasPage({ params }: { params: Promise<{ installationId: string }> }) {
  const { installationId } = await params;
  const { installation } = await getInstallationContext(installationId);
  const [checks, documents] = await Promise.all([
    prisma.legalCheck.findMany({ where: { installationId } }),
    prisma.documentFile.findMany({ where: { installationId }, select: { id: true, title: true } }),
  ]);
  const byCode = new Map(checks.map((c) => [c.obligationCode, c]));
  const docTitle = new Map(documents.map((d) => [d.id, d.title]));
  const today = new Date();
  const soon = new Date(today.getTime() + 90 * 86_400_000);

  const rows = obligationsFor(installation).map((item) => {
    const check = byCode.get(item.obligation.code) ?? null;
    const status = (check?.finalStatus ?? null) as LegalStatus | null;
    const due =
      status === "NAO_APLICAVEL" || item.applies === false ? null : nextDue(item.recurrence, check?.lastDoneAt ?? null, today);
    return { ...item, check, status, due };
  });

  const relevant = rows.filter((r) => r.applies !== false || r.check?.finalStatus);
  const overdue = relevant.filter((r) => r.due && r.due < today);
  const upcoming = relevant.filter((r) => r.due && r.due >= today && r.due <= soon);
  const pending = relevant.filter((r) => r.status === "NAO_CONFORME");
  const toValidate = relevant.filter((r) => !r.status);
  const missingData = rows.some((r) => r.applies === null);
  const usedNorms = new Set(relevant.map((r) => r.norm.id));

  const outsideBrazil = (installation.country ?? "BR") !== "BR";

  return (
    <div>
      <PageHeader
        title="Normas e prazos"
        info={
          <InfoTip label="Como funciona">
            O checklist cruza o cadastro da estrutura (país, estado, PNSB, DPA, método construtivo e classe de
            consequência) com as normas aplicáveis. A IA sugere a situação de cada obrigação a partir dos
            documentos; uma pessoa valida e informa quando ela foi cumprida pela última vez, e a plataforma
            calcula o próximo prazo.
          </InfoTip>
        }
        action={
          <form action={suggestLegalChecks.bind(null, installation.id)}>
            <SubmitButton pendingLabel="Lendo documentos…" className="btn-primary">
              Sugerir com IA
            </SubmitButton>
          </form>
        }
      />
      <PageBody className="space-y-6">
        {(missingData || outsideBrazil) && (
          <Card className="px-5 py-4 text-sm text-mineral-700">
            {outsideBrazil && (
              <p>
                Estrutura fora do Brasil ({installation.country}): só as obrigações do GISTM entram no checklist.
              </p>
            )}
            {missingData && (
              <p>
                Faltam dados no cadastro para decidir se algumas obrigações se aplicam.{" "}
                <Link href={`/instalacoes/${installation.id}/estrutura`} className="font-medium text-brand-600 underline">
                  Completar enquadramento legal
                </Link>
              </p>
            )}
          </Card>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Counter label="Vencidas" value={overdue.length} tone={overdue.length ? "red" : "neutral"} />
          <Counter label="Vencem em 90 dias" value={upcoming.length} tone={upcoming.length ? "amber" : "neutral"} />
          <Counter label="Pendentes" value={pending.length} tone={pending.length ? "red" : "neutral"} />
          <Counter label="Para validar" value={toValidate.length} tone="neutral" />
        </div>

        {(overdue.length > 0 || upcoming.length > 0) && (
          <Card className="px-5 py-4">
            <p className="mb-2 text-sm font-semibold text-mineral-900">Próximos prazos</p>
            <ul className="space-y-1 text-sm">
              {[...overdue, ...upcoming]
                .sort((a, b) => a.due!.getTime() - b.due!.getTime())
                .map((r) => (
                  <li key={r.obligation.code} className="flex justify-between gap-4">
                    <a href={`#${r.obligation.code}`} className="text-mineral-800 hover:underline">
                      {r.obligation.title}
                    </a>
                    <span className={clsx("shrink-0 tabular-nums", r.due! < today ? "text-red-700" : "text-amber-700")}>
                      {r.due! < today ? "Venceu em " : ""}
                      {fmt(r.due!)}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        )}

        <section>
          <p className="mb-2 text-sm font-semibold text-mineral-900">Normas aplicáveis</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {NORMS.filter((n) => usedNorms.has(n.id) || n.sphere === "ABNT").map((n) => (
              <Card key={n.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-mineral-900">
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {n.name}
                      </a>
                    ) : (
                      n.name
                    )}
                  </p>
                  <span className="shrink-0 rounded-full border border-mineral-200 px-2 py-0.5 text-xs text-mineral-600">
                    {SPHERE_LABEL[n.sphere]}
                    {n.status === "FUTURA" && n.statusDate ? ` · vigora em ${n.statusDate.split("-").reverse().join("/")}` : ""}
                    {n.status === "VIGENTE_ATE" && n.statusDate ? ` · até ${n.statusDate.split("-").reverse().join("/")}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-mineral-600">{n.summary}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-sm font-semibold text-mineral-900">Checklist</p>
          {NORMS.filter((n) => rows.some((r) => r.norm.id === n.id)).map((n) => {
            const normRows = rows.filter((r) => r.norm.id === n.id);
            return (
              <Card key={n.id} className="overflow-hidden">
                <p className="border-b border-mineral-100 bg-mineral-50/60 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-mineral-600">
                  {n.name}
                </p>
                <ul className="divide-y divide-mineral-100">
                  {normRows.map((r) => {
                    const ai = (r.check?.aiStatus ?? null) as LegalStatus | null;
                    return (
                      <li key={r.obligation.code} id={r.obligation.code} className={clsx("px-5 py-3", r.applies === false && !r.status && "opacity-60")}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-mineral-900">{r.obligation.title}</p>
                            <p className="text-xs text-mineral-500">
                              {r.obligation.article} · {recurrenceLabel(r.recurrence)}
                              {r.applies === null && " · aplicabilidade a confirmar"}
                              {r.applies === false && " · não se aplica pelo cadastro"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-xs">
                            {r.due && (
                              <span className={clsx("tabular-nums", r.due < today ? "text-red-700" : "text-mineral-600")}>
                                Próximo prazo {fmt(r.due)}
                              </span>
                            )}
                            {r.status ? (
                              <StatusChip status={r.status} />
                            ) : ai ? (
                              <StatusChip status={ai} suggested />
                            ) : null}
                          </div>
                        </div>

                        <details className="mt-2 text-sm">
                          <summary className="cursor-pointer text-xs font-medium text-brand-600">
                            {r.status ? "Detalhes e revalidação" : "Ver sugestão e validar"}
                          </summary>
                          <p className="mt-2 text-mineral-700">{r.obligation.description}</p>
                          {r.check?.aiJustification && (
                            <div className="mt-2 rounded-lg bg-mineral-50 px-3 py-2 text-xs text-mineral-700">
                              <p>
                                <span className="font-semibold">Sugestão da IA:</span> {r.check.aiJustification}
                              </p>
                              {r.check.aiDocumentId && (
                                <p className="mt-1">
                                  Documento:{" "}
                                  <a className="underline" href={`/api/documentos/${r.check.aiDocumentId}/download`}>
                                    {docTitle.get(r.check.aiDocumentId) ?? "abrir"}
                                  </a>
                                </p>
                              )}
                              {r.check.aiExcerpt && <p className="mt-1 italic">{r.check.aiExcerpt}</p>}
                            </div>
                          )}
                          {r.check?.reviewedAt && (
                            <p className="mt-2 text-xs text-mineral-500">
                              Validado por {r.check.reviewedBy} em {fmt(r.check.reviewedAt)}
                              {r.check.lastDoneAt && ` · último cumprimento ${fmt(r.check.lastDoneAt)}`}
                              {r.check.finalNote && ` · ${r.check.finalNote}`}
                            </p>
                          )}
                          <form
                            action={validateLegalCheck.bind(null, installation.id, r.obligation.code)}
                            className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4"
                          >
                            <select
                              name="finalStatus"
                              required
                              defaultValue={r.status ?? (ai && ai !== "SEM_EVIDENCIA" ? ai : "")}
                              className="input"
                            >
                              <option value="" disabled>
                                Situação
                              </option>
                              {LEGAL_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {LEGAL_STATUS_LABEL[s]}
                                </option>
                              ))}
                            </select>
                            <input
                              type="date"
                              name="lastDoneAt"
                              defaultValue={r.check?.lastDoneAt ? format(r.check.lastDoneAt, "yyyy-MM-dd") : ""}
                              className="input"
                              title="Última vez que foi cumprida"
                            />
                            <input
                              name="finalNote"
                              defaultValue={r.check?.finalNote ?? ""}
                              className="input"
                              placeholder="Observação (obrigatória se pendente)"
                            />
                            <SubmitButton pendingLabel="Salvando…" className="btn-primary">
                              Validar
                            </SubmitButton>
                          </form>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </section>

        <p className="text-xs text-mineral-500">
          Normas levantadas em novembro de 2026. A plataforma não substitui parecer jurídico: confira a vigência e o
          texto consolidado de cada norma antes de usar o checklist como evidência.
        </p>
      </PageBody>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "neutral" }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-mineral-500">{label}</p>
      <p
        className={clsx(
          "text-2xl font-semibold tabular-nums",
          tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-mineral-900"
        )}
      >
        {value}
      </p>
    </Card>
  );
}

function StatusChip({ status, suggested }: { status: LegalStatus; suggested?: boolean }) {
  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-0.5 font-medium",
        STATUS_STYLE[status],
        suggested && "border-dashed"
      )}
      title={suggested ? "Sugestão da IA, ainda não validada" : "Validado"}
    >
      {LEGAL_STATUS_LABEL[status]}
      {suggested && " · IA"}
    </span>
  );
}
