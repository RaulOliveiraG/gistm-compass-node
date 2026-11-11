"use server";

import { revalidatePath } from "next/cache";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { assertInstallationOwnership } from "@/lib/context";
import { buildObjectKey, getStorage } from "@/lib/storage";
import { saveDocumentFile, registerStoredDocument } from "@/lib/document-upload";
import { isAllowedExtension, MAX_DIRECT_FILE_SIZE_BYTES } from "@/lib/upload-limits";
import { flash } from "@/lib/flash";

function revalidateInstallation(installationId: string) {
  revalidatePath(`/instalacoes/${installationId}/documentos`);
  revalidatePath(`/instalacoes/${installationId}/requisitos`);
  revalidatePath(`/instalacoes/${installationId}/dashboard`);
  revalidatePath("/instalacoes");
}

/**
 * Importação única (item 22): recebe um ou vários arquivos, escolhidos
 * avulsos ou uma pasta inteira, pelo mesmo campo `files`. Título vem do nome
 * do arquivo; os demais dados do documento são opcionais e podem ser
 * preenchidos depois em "Detalhes" (item 21).
 *
 * Arquivos com formato ou tamanho não aceito são pulados (e informados na
 * confirmação) em vez de cancelar a importação inteira.
 */
export async function importDocuments(installationId: string, formData: FormData) {
  const installation = await assertInstallationOwnership(installationId);

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    throw new Error("Selecione ao menos um arquivo ou uma pasta com arquivos.");
  }

  let imported = 0;
  const skipped: string[] = [];
  for (const file of files) {
    // Arquivos ocultos de sistema que vêm junto ao importar uma pasta.
    const name = path.basename(file.name);
    if (name.startsWith(".") || name.toLowerCase() === "thumbs.db" || name.toLowerCase() === "desktop.ini") continue;
    try {
      await saveDocumentFile(installation.organizationId, installationId, file);
      imported++;
    } catch {
      skipped.push(name);
    }
  }

  revalidateInstallation(installationId);

  if (imported === 0) {
    await flash(`Nenhum arquivo importado. Formato ou tamanho não aceito: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}`, "warn");
  } else if (skipped.length > 0) {
    await flash(`${imported} arquivo(s) importado(s). ${skipped.length} ignorado(s) por formato ou tamanho.`, "warn");
  } else {
    await flash(imported === 1 ? "Documento importado." : `${imported} documentos importados.`);
  }
}

/**
 * Um lote da importação em partes: o botão Importar divide a seleção em
 * lotes pequenos e chama esta ação para cada um, porque o servidor recusa
 * envios muito grandes de uma vez. Não mostra aviso; quem chama soma os
 * resultados e chama `finishImport` no fim.
 */
export async function importDocumentsBatch(installationId: string, formData: FormData) {
  const installation = await assertInstallationOwnership(installationId);
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  let imported = 0;
  const skipped: string[] = [];
  for (const file of files) {
    const name = path.basename(file.name);
    if (name.startsWith(".") || name.toLowerCase() === "thumbs.db" || name.toLowerCase() === "desktop.ini") continue;
    try {
      await saveDocumentFile(installation.organizationId, installationId, file);
      imported++;
    } catch {
      skipped.push(name);
    }
  }
  return { imported, skipped };
}

/**
 * Envio direto ao bucket: devolve uma URL assinada (PUT) para cada arquivo
 * aceito. Com storage local, devolve `direct: false` e o botão usa o envio
 * em lotes pelo servidor.
 */
export async function prepareDirectUploads(
  installationId: string,
  files: { name: string; size: number }[]
): Promise<{ direct: boolean; uploads: { index: number; key: string; url: string }[]; rejected: string[] }> {
  const installation = await assertInstallationOwnership(installationId);
  const storage = getStorage();
  const uploads: { index: number; key: string; url: string }[] = [];
  const rejected: string[] = [];
  for (let index = 0; index < files.length; index++) {
    const f = files[index];
    const name = path.basename(f.name);
    const ext = path.extname(name).toLowerCase();
    if (name.startsWith(".") || !isAllowedExtension(ext) || f.size <= 0 || f.size > MAX_DIRECT_FILE_SIZE_BYTES) {
      rejected.push(name);
      continue;
    }
    const key = buildObjectKey(installation.organizationId, installationId, ext);
    const url = storage.presignPut(key, 6 * 3600);
    if (!url) return { direct: false, uploads: [], rejected: [] };
    uploads.push({ index, key, url });
  }
  return { direct: true, uploads, rejected };
}

/** Registra um arquivo já enviado direto ao bucket por `prepareDirectUploads`. */
export async function registerDirectUpload(
  installationId: string,
  stored: { key: string; name: string; size: number; mimeType: string }
): Promise<boolean> {
  const installation = await assertInstallationOwnership(installationId);
  // A chave tem de ser desta organização e desta estrutura, no formato gerado por buildObjectKey.
  const prefix = `${installation.organizationId}/${installationId}/`;
  const ext = path.extname(stored.name).toLowerCase();
  if (
    !stored.key.startsWith(prefix) ||
    !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(stored.key.slice(prefix.length)) ||
    !isAllowedExtension(ext) ||
    stored.size > MAX_DIRECT_FILE_SIZE_BYTES
  ) {
    return false;
  }
  try {
    await registerStoredDocument(installationId, { ...stored, name: path.basename(stored.name) });
    return true;
  } catch {
    return false;
  }
}

/** Fecha a importação em partes: atualiza as telas e mostra o resumo. */
export async function finishImport(installationId: string, imported: number, skipped: string[]) {
  await assertInstallationOwnership(installationId);
  revalidateInstallation(installationId);
  if (imported === 0) {
    await flash(`Nenhum arquivo importado. Formato ou tamanho não aceito: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}`, "warn");
  } else if (skipped.length > 0) {
    await flash(`${imported} arquivo(s) importado(s). ${skipped.length} ignorado(s) (formato ou mais de 50 MB): ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? "…" : ""}`, "warn");
  } else {
    await flash(imported === 1 ? "Documento importado." : `${imported} documentos importados.`);
  }
}

/** Edição dos dados opcionais do documento (antes exigidos no envio). */
export async function updateDocumentDetails(installationId: string, documentId: string, formData: FormData) {
  await assertInstallationOwnership(installationId);
  await assertDocumentBelongsToInstallation(installationId, documentId);

  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const title = text("title");
  if (!title) throw new Error("Informe um título para o documento.");
  const validUntilRaw = text("validUntil");
  const previousVersionId = text("previousVersionId");

  await prisma.documentFile.update({
    where: { id: documentId },
    data: {
      title,
      type: text("type") || "Documento",
      version: text("version") || null,
      areaResponsible: text("areaResponsible") || null,
      confidentiality: text("confidentiality") === "PUBLICO" ? "PUBLICO" : "INTERNO",
      targetAudience: text("targetAudience") || null,
      validUntil: validUntilRaw ? new Date(validUntilRaw) : null,
      previousVersionId: previousVersionId && previousVersionId !== documentId ? previousVersionId : null,
    },
  });

  revalidateInstallation(installationId);
  await flash("Dados do documento salvos.");
}

async function assertDocumentBelongsToInstallation(installationId: string, documentId: string) {
  const document = await prisma.documentFile.findUnique({ where: { id: documentId } });
  if (!document || document.installationId !== installationId) {
    throw new Error("Documento não encontrado nesta instalação.");
  }
  return document;
}

export async function deleteDocument(installationId: string, documentId: string) {
  await assertInstallationOwnership(installationId);
  const document = await assertDocumentBelongsToInstallation(installationId, documentId);

  // Ações encerradas com este documento como evidência perdem só o vínculo
  // ao arquivo; o link e a observação de encerramento continuam.
  await prisma.action.updateMany({ where: { closureDocumentId: documentId }, data: { closureDocumentId: null } });
  await prisma.evidence.deleteMany({ where: { documentId } });
  await prisma.documentFile.delete({ where: { id: documentId } });
  await getStorage().delete(document.filePath);

  revalidateInstallation(installationId);
  await flash("Documento excluído.");
}

export async function approveDisclosure(
  installationId: string,
  documentId: string,
  formData: FormData
) {
  await assertInstallationOwnership(installationId);
  await assertDocumentBelongsToInstallation(installationId, documentId);

  const approvedBy = String(formData.get("approvedBy") ?? "").trim();
  if (!approvedBy) throw new Error("Informe quem está aprovando a divulgação.");

  await prisma.documentFile.update({
    where: { id: documentId },
    data: {
      disclosureApproved: true,
      disclosureApprovedBy: approvedBy,
      disclosureApprovedAt: new Date(),
    },
  });

  revalidateInstallation(installationId);
  await flash("Documento aprovado para divulgação.");
}
