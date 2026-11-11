import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getInstallationContext } from "@/lib/context";
import { PageHeader, PageBody, Card, EmptyState } from "@/components/ui";
import { importDocumentsBatch, finishImport, prepareDirectUploads, registerDirectUpload, deleteDocument, approveDisclosure, updateDocumentDetails } from "./actions";
import { Trash2, ShieldCheck, AlertTriangle, Download, Search, SlidersHorizontal, Link2, EyeOff } from "lucide-react";
import { format, isBefore } from "date-fns";
import { ImportButton } from "@/components/ImportButton";
import { FileTypeIcon, fileExtension } from "@/components/FileTypeIcon";
import { FilterGroup, ClearFilters, paramValues, type SearchParamsRecord } from "@/components/FilterChips";
import { InfoTip } from "@/components/InfoTip";
import { SubmitButton } from "@/components/SubmitButton";
import { runAiForNewDocuments } from "../requisitos/actions";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

const DOCUMENT_TYPES = [
  "Documento",
  "Manual operacional",
  "Procedimento",
  "Relatório técnico",
  "Plano de ação",
  "Matriz de risco",
  "Registro de monitoramento",
  "Política corporativa",
  "Evidência fotográfica",
  "Evidência de encerramento",
  "Registro de auditoria",
  "Outro",
];

export default async function DocumentosPage({
  params,
  searchParams,
}: {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const userName = (await auth())?.user?.name ?? "";
  const { installationId } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const { installation } = await getInstallationContext(installationId);

  const allDocuments = await prisma.documentFile.findMany({
    where: { installationId: installation.id },
    orderBy: { uploadedAt: "desc" },
    include: {
      _count: { select: { evidences: true } },
      previousVersion: { select: { id: true, title: true } },
      nextVersions: { select: { id: true, title: true } },
    },
  });

  // Opções de filtro derivadas do que existe na base (item 24).
  const yearCounts = new Map<string, number>();
  const extCounts = new Map<string, number>();
  for (const d of allDocuments) {
    const y = String(d.uploadedAt.getFullYear());
    yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
    const e = fileExtension(d.fileName) || "sem extensão";
    extCounts.set(e, (extCounts.get(e) ?? 0) + 1);
  }
  const years = [...yearCounts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const exts = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);

  const selYears = paramValues(sp, "ano");
  const selExts = paramValues(sp, "ext");
  const query = q.trim().toLowerCase();

  const documents = allDocuments.filter((doc) => {
    const matchesQuery =
      !query ||
      doc.title.toLowerCase().includes(query) ||
      doc.fileName.toLowerCase().includes(query) ||
      (doc.extractedText ?? "").toLowerCase().includes(query);
    const matchesYear = selYears.length === 0 || selYears.includes(String(doc.uploadedAt.getFullYear()));
    const matchesExt = selExts.length === 0 || selExts.includes(fileExtension(doc.fileName) || "sem extensão");
    return matchesQuery && matchesYear && matchesExt;
  });

  const newDocs = allDocuments.filter((d) => d.analyzedAt === null);
  const alreadyAnalyzed = allDocuments.some((d) => d.analyzedAt !== null);

  const now = new Date();
  const expiredCount = allDocuments.filter((d) => d.validUntil && isBefore(d.validUntil, now)).length;

  return (
    <div>
      <PageHeader
        title="Documentação"
        description={`${allDocuments.length} documento(s)${expiredCount > 0 ? ` · ${expiredCount} vencido(s)` : ""}`}
        info={
          <InfoTip label="Sobre a Documentação">
            A Documentação é a base que a IA lê para sugerir a classificação de cada requisito.
            PDF, Word (.docx), Excel (.xlsx), .txt e .md têm o texto lido; imagens e outros formatos
            entram só pelo nome. Limite de 50 MB por arquivo.
          </InfoTip>
        }
        action={<ImportButton
            batchAction={importDocumentsBatch.bind(null, installation.id)}
            finishAction={finishImport.bind(null, installation.id)}
            prepareDirect={prepareDirectUploads.bind(null, installation.id)}
            registerDirect={registerDirectUpload.bind(null, installation.id)}
          />}
      />

      <PageBody className="space-y-4">
        {/* Documentos novos depois da análise: incluir sem refazer o que já foi revisado. */}
        {newDocs.length > 0 && alreadyAnalyzed && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-sm text-brand-800">
              <strong>{newDocs.length}</strong> {newDocs.length === 1 ? "novo" : "novos"} para a IA analisar
              <span className="text-brand-700/80"> · validações mantidas</span>
            </p>
            <form action={runAiForNewDocuments.bind(null, installation.id)}>
              <SubmitButton pendingLabel="Analisando…" className="btn-primary rounded-full">
                <Sparkles size={14} />
                Analisar
              </SubmitButton>
            </form>
          </div>
        )}

        {allDocuments.length > 0 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-mineral-200/80 bg-white px-4 py-3 shadow-[var(--shadow-card)]">
            <form method="get" className="flex items-center gap-2">
              {selYears.map((y) => (
                <input key={`ano-${y}`} type="hidden" name="ano" value={y} />
              ))}
              {selExts.map((e) => (
                <input key={`ext-${e}`} type="hidden" name="ext" value={e} />
              ))}
              <div className="relative flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mineral-400" />
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Buscar"
                  className="input rounded-full pl-9"
                />
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <FilterGroup
                label="Ano"
                paramKey="ano"
                params={sp}
                options={years.map(([y, n]) => ({ value: y, label: y, count: n }))}
              />
              <FilterGroup
                label="Extensão"
                paramKey="ext"
                params={sp}
                options={exts.map(([e, n]) => ({ value: e, label: e.toUpperCase(), count: n }))}
              />
              <ClearFilters params={sp} keys={["ano", "ext", "q"]} />
            </div>
          </div>
        )}

        <Card>
          {documents.length === 0 ? (
            <EmptyState>
              {allDocuments.length === 0 ? (
                <span className="text-base font-medium text-mineral-700">Nenhum documento ainda</span>
              ) : (
                "Nada encontrado."
              )}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-mineral-100">
              {documents.map((doc) => {
                const expired = doc.validUntil ? isBefore(doc.validUntil, now) : false;
                const needsDisclosureApproval =
                  doc.confidentiality === "PUBLICO" && !doc.disclosureApproved;
                return (
                  <li key={doc.id} className="px-5 py-3">
                    {/* Dados opcionais ficam escondidos atrás do ícone de ajustes (item 21). */}
                    <input type="checkbox" id={`det-${doc.id}`} className="peer sr-only" />
                    <div className="flex items-center gap-4">
                      <FileTypeIcon fileName={doc.fileName} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm font-medium text-mineral-900">
                          <span className="truncate">{doc.title}</span>
                          {expired && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-state-bad-soft px-2 py-0.5 text-[10px] font-medium text-state-bad">
                              <AlertTriangle size={10} /> vencido
                            </span>
                          )}
                          {doc.analyzedAt === null && alreadyAnalyzed && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
                              novo
                            </span>
                          )}
                          {doc.confidentiality === "PUBLICO" && doc.disclosureApproved && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-state-ok-soft px-2 py-0.5 text-[10px] font-medium text-state-ok">
                              <ShieldCheck size={10} /> público
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 flex items-center gap-2 truncate text-xs text-mineral-500">
                          <span>{format(doc.uploadedAt, "dd/MM/yyyy")}</span>
                          {doc.type && doc.type !== "Documento" && <span className="truncate">{doc.type}</span>}
                          {doc._count.evidences > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 text-brand-600"
                              title={`Evidência em ${doc._count.evidences} requisito(s)`}
                            >
                              <Link2 size={11} />
                              {doc._count.evidences}
                            </span>
                          )}
                          {!doc.extractedText && (
                            <span className="inline-flex text-mineral-400" title="Sem texto lido (a IA usa só o nome)">
                              <EyeOff size={11} />
                            </span>
                          )}
                        </p>
                      </div>
                      <label
                        htmlFor={`det-${doc.id}`}
                        className="cursor-pointer rounded-full p-2 text-mineral-500 hover:bg-mineral-100 hover:text-mineral-800"
                        title="Detalhes"
                      >
                        <SlidersHorizontal size={16} />
                      </label>
                      <a
                        href={`/api/documentos/${doc.id}/download`}
                        className="rounded-full p-2 text-mineral-500 hover:bg-mineral-100 hover:text-mineral-800"
                        title="Baixar"
                      >
                        <Download size={16} />
                      </a>
                      <form action={deleteDocument.bind(null, installation.id, doc.id)}>
                        <button
                          type="submit"
                          className="rounded-full p-2 text-mineral-500 hover:bg-state-bad-soft hover:text-state-bad"
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      </form>
                    </div>

                    <div className="ml-[calc(28.8px+1rem)] hidden peer-checked:block">
                      <form
                        action={updateDocumentDetails.bind(null, installation.id, doc.id)}
                        className="mt-3 grid grid-cols-1 gap-3 rounded-xl bg-mineral-50 p-4 sm:grid-cols-2 lg:grid-cols-4"
                      >
                        <Field label="Título" className="sm:col-span-2">
                          <input name="title" defaultValue={doc.title} required className="input" />
                        </Field>
                        <Field label="Tipo">
                          <select name="type" defaultValue={doc.type} className="input">
                            {[...new Set([doc.type, ...DOCUMENT_TYPES])].map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Versão">
                          <input name="version" defaultValue={doc.version ?? ""} className="input" placeholder="Rev. 3" />
                        </Field>
                        <Field label="Área responsável">
                          <input name="areaResponsible" defaultValue={doc.areaResponsible ?? ""} className="input" />
                        </Field>
                        <Field label="Válido até">
                          <input
                            type="date"
                            name="validUntil"
                            defaultValue={doc.validUntil ? format(doc.validUntil, "yyyy-MM-dd") : ""}
                            className="input"
                          />
                        </Field>
                        <Field label="Confidencialidade">
                          <select name="confidentiality" defaultValue={doc.confidentiality} className="input">
                            <option value="INTERNO">Uso interno</option>
                            <option value="PUBLICO">Divulgação pública</option>
                          </select>
                        </Field>
                        <Field label="Público de destino">
                          <input name="targetAudience" defaultValue={doc.targetAudience ?? ""} className="input" />
                        </Field>
                        <Field label="Nova versão de" className="sm:col-span-2">
                          <select name="previousVersionId" defaultValue={doc.previousVersion?.id ?? ""} className="input">
                            <option value="">Não substitui outro documento</option>
                            {allDocuments
                              .filter((d) => d.id !== doc.id)
                              .map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.title}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <div className="flex items-end sm:col-span-2 lg:col-span-2">
                          <button type="submit" className="btn-primary">
                            Salvar
                          </button>
                        </div>
                        {(doc.previousVersion || doc.nextVersions.length > 0) && (
                          <p className="text-xs text-mineral-500 sm:col-span-2 lg:col-span-4">
                            {doc.previousVersion && `Nova versão de "${doc.previousVersion.title}". `}
                            {doc.nextVersions.length > 0 && `Substituído por "${doc.nextVersions[0].title}".`}
                          </p>
                        )}
                      </form>
                      {needsDisclosureApproval && (
                        <form
                          action={approveDisclosure.bind(null, installation.id, doc.id)}
                          className="mt-2 flex flex-wrap items-center gap-2"
                        >
                          <input
                            name="approvedBy"
                            defaultValue={userName}
                            required
                            placeholder="Aprovado por"
                            className="input max-w-[200px] text-xs"
                          />
                          <button type="submit" className="btn-secondary">
                            Aprovar para divulgação
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageBody>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className ? `block ${className}` : "block"}>
      <span className="mb-1 block text-xs font-medium text-mineral-600">{label}</span>
      {children}
    </label>
  );
}
