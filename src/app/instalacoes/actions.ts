"use server";

import { redirect, notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { withOrgContext } from "@/lib/tenant-db";
import { flash } from "@/lib/flash";
import { applyAutomaticNotApplicable } from "@/lib/applicability";
import type { InstallationPhase } from "@prisma/client";

const PHASES = ["NOVA", "EM_CONSTRUCAO", "OPERACAO", "INATIVA", "FECHAMENTO"] as const;

const CONSTRUCTION_METHODS = ["MONTANTE", "JUSANTE", "LINHA_DE_CENTRO", "ETAPA_UNICA", "OUTRO"];
const GISTM_CLASSES = ["BAIXA", "SIGNIFICATIVA", "ALTA", "MUITO_ALTA", "EXTREMA"];
const yesNo = (v: string) => (v === "SIM" ? true : v === "NAO" ? false : null);

function readInstallationForm(formData: FormData) {
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const phaseRaw = text("phase");
  const phase: InstallationPhase = (PHASES as readonly string[]).includes(phaseRaw)
    ? (phaseRaw as InstallationPhase)
    : "OPERACAO";
  const dpa = text("hasDpaClassification");
  const dpaClass = text("dpaClassification");
  return {
    name: text("name"),
    location: text("location") || null,
    phase,
    hasDpaClassification: dpa === "SIM" ? true : dpa === "NAO" ? false : null,
    dpaClassification: ["ALTO", "MEDIO", "BAIXO"].includes(dpaClass) ? dpaClass : null,
    eorName: text("eorName") || null,
    eorCompany: text("eorCompany") || null,
    eorEmail: text("eorEmail") || null,
    rtfeName: text("rtfeName") || null,
    accountableExecutive: text("accountableExecutive") || null,
    otherResponsibles: text("otherResponsibles") || null,
    country: /^[A-Z]{2}$/.test(text("country").toUpperCase()) ? text("country").toUpperCase() : "BR",
    uf: text("uf").toUpperCase().slice(0, 2) || null,
    inPnsb: yesNo(text("inPnsb")),
    criClassification: ["ALTO", "MEDIO", "BAIXO"].includes(text("criClassification")) ? text("criClassification") : null,
    constructionMethod: CONSTRUCTION_METHODS.includes(text("constructionMethod")) ? text("constructionMethod") : null,
    gistmConsequence: GISTM_CLASSES.includes(text("gistmConsequence")) ? text("gistmConsequence") : null,
    zasCommunity: yesNo(text("zasCommunity")),
  };
}

export async function createInstallation(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = readInstallationForm(formData);
  if (!data.name) throw new Error("Informe o nome da estrutura.");

  const installation = await withOrgContext(session.user.organizationId, async (tx) => {
    const created = await tx.installation.create({
      data: { ...data, organizationId: session.user.organizationId },
    });

    const year = new Date().getFullYear();
    await tx.cycle.create({
      data: { name: `Ciclo ${year}.1`, installationId: created.id },
    });

    return created;
  });

  const autoNsa = await applyAutomaticNotApplicable(installation.id, data.phase);

  revalidatePath("/instalacoes");
  await flash(
    autoNsa > 0
      ? `Estrutura cadastrada. ${autoNsa} requisito(s) marcados como "Não se aplica" para revisão.`
      : "Estrutura cadastrada."
  );
  redirect(`/instalacoes/${installation.id}/dashboard`);
}

export async function updateInstallation(installationId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = readInstallationForm(formData);
  if (!data.name) throw new Error("Informe o nome da estrutura.");

  const current = await withOrgContext(session.user.organizationId, async (tx) => {
    const found = await tx.installation.findUnique({ where: { id: installationId } });
    if (!found || found.organizationId !== session.user.organizationId) notFound();
    await tx.installation.update({ where: { id: installationId }, data });
    return found;
  });

  let note = "";
  if (data.phase !== current.phase) {
    const n = await applyAutomaticNotApplicable(installationId, data.phase);
    if (n > 0) note = ` ${n} requisito(s) atualizados pela regra de "Não se aplica".`;
  }

  revalidatePath(`/instalacoes/${installationId}`, "layout");
  revalidatePath("/instalacoes");
  await flash(`Dados da estrutura salvos.${note}`);
}

export async function deleteInstallation(installationId: string) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") {
    throw new Error("Apenas administradores da organização podem remover instalações.");
  }

  await withOrgContext(session.user.organizationId, async (tx) => {
    const installation = await tx.installation.findUnique({ where: { id: installationId } });
    if (!installation || installation.organizationId !== session.user.organizationId) {
      notFound();
    }

    const assessmentIds = (
      await tx.assessment.findMany({
        where: { installationId },
        select: { id: true },
      })
    ).map((a) => a.id);

    const actionIds = (
      await tx.action.findMany({
        where: { assessmentId: { in: assessmentIds } },
        select: { id: true },
      })
    ).map((a) => a.id);

    await tx.actionComment.deleteMany({ where: { actionId: { in: actionIds } } });
    await tx.actionLog.deleteMany({ where: { actionId: { in: actionIds } } });
    await tx.comment.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
    await tx.assessmentRevision.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
    await tx.auditLog.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
    await tx.action.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
    await tx.evidence.deleteMany({ where: { document: { installationId } } });
    await tx.assessment.deleteMany({ where: { installationId } });
    await tx.externalAnalysis.deleteMany({ where: { installationId } });
    await tx.analysisRun.deleteMany({ where: { installationId } });
    await tx.legalCheck.deleteMany({ where: { installationId } });
    await tx.documentFile.deleteMany({ where: { installationId } });
    await tx.cycle.deleteMany({ where: { installationId } });
    await tx.installation.delete({ where: { id: installationId } });
  });

  revalidatePath("/instalacoes");
}
