"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertInstallationOwnership } from "@/lib/context";
import { auth } from "@/auth";
import type { ActionPriority, ActionStatus } from "@prisma/client";
import { flash } from "@/lib/flash";
import { saveDocumentFile } from "@/lib/document-upload";

/** Próximo código sequencial da estrutura: PA-001, PA-002… (item 16). */
async function nextActionCode(installationId: string): Promise<string> {
  const existing = await prisma.action.findMany({
    where: { assessment: { installationId }, code: { not: null } },
    select: { code: true },
  });
  const max = existing.reduce((m, a) => {
    const n = Number(String(a.code).replace(/\D/g, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  const total = await prisma.action.count({ where: { assessment: { installationId } } });
  // Ações antigas (sem código) também contam, para os números não colidirem
  // com o código calculado que a tela mostra para elas.
  return `PA-${String(Math.max(max, total) + 1).padStart(3, "0")}`;
}

function revalidateAction(installationId: string, requirementId?: string) {
  revalidatePath(`/instalacoes/${installationId}/planos-de-acao`);
  revalidatePath(`/instalacoes/${installationId}/dashboard`);
  revalidatePath("/instalacoes");
  if (requirementId) {
    revalidatePath(`/instalacoes/${installationId}/requisitos/${requirementId}`);
  }
}

const STATUS_LABELS: Record<ActionStatus, string> = {
  ABERTA: "Aberta",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDA: "Concluída",
};

async function requireSessionName(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error("Sessão expirada. Faça login novamente.");
  return session.user.name ?? session.user.email ?? "Usuário";
}

export async function createAction(formData: FormData) {
  const installationId = String(formData.get("installationId"));
  const assessmentId = String(formData.get("assessmentId"));
  const requirementId = String(formData.get("requirementId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const responsible = String(formData.get("responsible") ?? "").trim();
  const area = String(formData.get("area") ?? "").trim();
  const dueDateRaw = String(formData.get("dueDate") ?? "");
  const priority = String(formData.get("priority") ?? "MEDIA") as ActionPriority;
  const dependsOnId = String(formData.get("dependsOnId") ?? "").trim();

  if (!description) throw new Error("Descreva a ação corretiva.");
  if (!responsible) throw new Error("Informe o responsável pela ação.");

  const actorName = await requireSessionName();
  await assertInstallationOwnership(installationId);
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment || assessment.installationId !== installationId) {
    throw new Error("Avaliação não encontrada nesta instalação.");
  }

  const action = await prisma.action.create({
    data: {
      code: await nextActionCode(installationId),
      assessmentId,
      description,
      responsible,
      area: area || null,
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
      priority,
      dependsOnId: dependsOnId || null,
    },
  });

  await prisma.auditLog.create({
    data: {
      assessmentId,
      actor: responsible,
      action: "ACAO_CRIADA",
      note: description,
    },
  });

  await prisma.actionLog.create({
    data: {
      actionId: action.id,
      actor: actorName,
      event: "ACAO_CRIADA",
      note: `Responsável: ${responsible}.`,
    },
  });

  revalidateAction(installationId, requirementId || undefined);
  await flash(`Ação ${action.code} criada.`);
}

export async function updateActionStatus(
  actionId: string,
  status: ActionStatus,
  formData: FormData
) {
  const session = await auth();
  if (!session?.user) throw new Error("Sessão expirada. Faça login novamente.");

  const closureEvidence = String(formData.get("closureEvidence") ?? "").trim();
  const closureLink = String(formData.get("closureLink") ?? "").trim();
  const closureDocumentIdRaw = String(formData.get("closureDocumentId") ?? "").trim();
  const closureFile = formData.get("closureFile");

  const current = await prisma.action.findUniqueOrThrow({
    where: { id: actionId },
    include: {
      dependsOn: { select: { status: true, description: true } },
      assessment: { select: { installationId: true, installation: { select: { organizationId: true } } } },
    },
  });
  if (current.assessment.installation.organizationId !== session.user.organizationId) {
    throw new Error("Ação não encontrada.");
  }

  if (
    (status === "EM_ANDAMENTO" || status === "CONCLUIDA") &&
    current.dependsOn &&
    current.dependsOn.status !== "CONCLUIDA"
  ) {
    throw new Error(
      `Esta ação depende de "${current.dependsOn.description}", que ainda não foi concluída.`
    );
  }
  // Evidência de encerramento (item 19): documento (anexado agora ou já na
  // Documentação) + link. A observação em texto passa a ser opcional.
  let closureDocumentId: string | null = null;
  if (status === "CONCLUIDA") {
    if (!closureLink) {
      throw new Error("Informe o link da evidência de encerramento para concluir a ação.");
    }
    if (!/^https?:\/\//i.test(closureLink)) {
      throw new Error("O link da evidência deve começar com http:// ou https://.");
    }
    const installationId = current.assessment.installationId;
    if (closureFile instanceof File && closureFile.size > 0) {
      const doc = await saveDocumentFile(session.user.organizationId, installationId, closureFile, {
        type: "Evidência de encerramento",
      });
      closureDocumentId = doc.id;
    } else if (closureDocumentIdRaw) {
      const doc = await prisma.documentFile.findUnique({ where: { id: closureDocumentIdRaw } });
      if (!doc || doc.installationId !== installationId) {
        throw new Error("Documento de evidência não encontrado nesta estrutura.");
      }
      closureDocumentId = doc.id;
    } else {
      throw new Error("Anexe um documento (ou escolha um da Documentação) como evidência de encerramento.");
    }
  }

  const action = await prisma.action.update({
    where: { id: actionId },
    data: {
      status,
      closureEvidence: status === "CONCLUIDA" ? closureEvidence || null : undefined,
      closureDocumentId: status === "CONCLUIDA" ? closureDocumentId : undefined,
      closureLink: status === "CONCLUIDA" ? closureLink : undefined,
    },
    include: { assessment: { select: { id: true, status: true, installationId: true, requirementId: true } } },
  });

  // Ação concluída num requisito já validado: a classificação pode ter
  // mudado. Marca "Rever" para o revisor confirmar (não altera a decisão).
  if (status === "CONCLUIDA" && action.assessment.status === "VALIDADO") {
    await prisma.assessment.update({
      where: { id: action.assessment.id },
      data: {
        reviewFlag: `Ação ${action.code ?? ""} concluída: confira se a classificação mudou.`.replace("  ", " "),
        reviewFlagAt: new Date(),
      },
    });
  }

  await prisma.actionLog.create({
    data: {
      actionId: action.id,
      actor: session.user.name ?? session.user.email ?? "Usuário",
      event: "STATUS_ALTERADO",
      note:
        `Status alterado de "${STATUS_LABELS[current.status]}" para "${STATUS_LABELS[status]}".` +
        (status === "CONCLUIDA" ? ` Evidência: ${closureLink}${closureEvidence ? ` — ${closureEvidence}` : ""}` : ""),
    },
  });

  revalidateAction(action.assessment.installationId, action.assessment.requirementId);
  if (status === "CONCLUIDA") revalidatePath(`/instalacoes/${action.assessment.installationId}/documentos`);
  await flash(status === "CONCLUIDA" ? "Ação concluída." : status === "EM_ANDAMENTO" ? "Ação iniciada." : "Status atualizado.");
}

export async function addActionComment(formData: FormData) {
  const installationId = String(formData.get("installationId"));
  const actionId = String(formData.get("actionId"));
  const requirementId = String(formData.get("requirementId") ?? "");
  const author = String(formData.get("author") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();

  if (!author) throw new Error("Informe seu nome para comentar.");
  if (!text) throw new Error("Escreva um comentário.");

  const session = await auth();
  if (!session?.user) throw new Error("Sessão expirada. Faça login novamente.");

  const action = await prisma.action.findUniqueOrThrow({
    where: { id: actionId },
    include: {
      assessment: { select: { installation: { select: { organizationId: true } } } },
    },
  });
  if (action.assessment.installation.organizationId !== session.user.organizationId) {
    throw new Error("Ação não encontrada.");
  }

  await prisma.actionComment.create({ data: { actionId, author, text } });

  revalidatePath(`/instalacoes/${installationId}/planos-de-acao`);
  if (requirementId) {
    revalidatePath(`/instalacoes/${installationId}/requisitos/${requirementId}`);
  }
  await flash("Comentário publicado.");
}

export async function deleteAction(actionId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Sessão expirada. Faça login novamente.");

  const existing = await prisma.action.findUniqueOrThrow({
    where: { id: actionId },
    include: {
      assessment: { select: { installation: { select: { organizationId: true } } } },
    },
  });
  if (existing.assessment.installation.organizationId !== session.user.organizationId) {
    throw new Error("Ação não encontrada.");
  }

  const action = await prisma.action.delete({
    where: { id: actionId },
    include: { assessment: { select: { installationId: true, requirementId: true } } },
  });

  revalidateAction(action.assessment.installationId, action.assessment.requirementId);
  await flash("Ação excluída.");
}
