"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertInstallationOwnership } from "@/lib/context";
import { flash } from "@/lib/flash";
import { OBLIGATION_BY_CODE, LEGAL_STATUSES, obligationsFor } from "@/lib/legal-catalog";
import { suggestByKeywords, suggestWithAi } from "@/lib/legal-ai";

// Mesma chave da análise em lote: com AI_BATCH_REAL_AI=true e a chave da API,
// a sugestão vem da IA real; sem isso, da leitura por palavras-chave.
const REAL_AI = process.env.AI_BATCH_REAL_AI === "true";

/** Sugere o status de todas as obrigações do checklist (não mexe no que foi validado). */
export async function suggestLegalChecks(installationId: string) {
  const installation = await assertInstallationOwnership(installationId);
  const documents = await prisma.documentFile.findMany({
    where: { installationId },
    select: { id: true, title: true, extractedText: true },
  });
  const docIds = new Set(documents.map((d) => d.id));
  const items = obligationsFor(installation);

  let n = 0;
  for (const item of items) {
    let s = suggestByKeywords(item, documents);
    if (REAL_AI && item.applies !== false) {
      const real = await suggestWithAi(installationId, item);
      if (real) s = real;
    }
    const documentId = s.documentId && docIds.has(s.documentId) ? s.documentId : null;
    await prisma.legalCheck.upsert({
      where: { installationId_obligationCode: { installationId, obligationCode: item.obligation.code } },
      create: {
        installationId,
        obligationCode: item.obligation.code,
        aiStatus: s.status,
        aiJustification: s.justification,
        aiDocumentId: documentId,
        aiExcerpt: s.excerpt,
        aiAt: new Date(),
      },
      update: {
        aiStatus: s.status,
        aiJustification: s.justification,
        aiDocumentId: documentId,
        aiExcerpt: s.excerpt,
        aiAt: new Date(),
      },
    });
    n++;
  }

  revalidatePath(`/instalacoes/${installationId}/normas`);
  await flash(`Checklist legal atualizado: ${n} obrigações com sugestão para validar.`);
}

/** Validação humana de uma obrigação. */
export async function validateLegalCheck(installationId: string, obligationCode: string, formData: FormData) {
  await assertInstallationOwnership(installationId);
  if (!OBLIGATION_BY_CODE.has(obligationCode)) throw new Error("Obrigação desconhecida.");
  const session = await auth();
  const text = (k: string) => String(formData.get(k) ?? "").trim();

  const status = text("finalStatus");
  if (!(LEGAL_STATUSES as readonly string[]).includes(status)) throw new Error("Escolha a situação da obrigação.");
  const note = text("finalNote");
  if (status === "NAO_CONFORME" && !note) throw new Error("Explique o que está pendente.");
  const lastDone = text("lastDoneAt");
  const lastDoneAt = /^\d{4}-\d{2}-\d{2}$/.test(lastDone) ? new Date(`${lastDone}T12:00:00`) : null;
  const reviewedBy = session?.user?.name ?? session?.user?.email ?? "Usuário";

  await prisma.legalCheck.upsert({
    where: { installationId_obligationCode: { installationId, obligationCode } },
    create: { installationId, obligationCode, finalStatus: status, finalNote: note || null, lastDoneAt, reviewedBy, reviewedAt: new Date() },
    update: { finalStatus: status, finalNote: note || null, lastDoneAt, reviewedBy, reviewedAt: new Date() },
  });

  revalidatePath(`/instalacoes/${installationId}/normas`);
  revalidatePath(`/instalacoes/${installationId}/dashboard`);
  await flash("Obrigação validada.");
}
