import path from "node:path";
import { prisma } from "@/lib/prisma";
import { buildObjectKey, getStorage } from "@/lib/storage";
import { extractText } from "@/lib/text-extraction";
import { assertUploadAllowed, MAX_TEXT_EXTRACTION_BYTES } from "@/lib/upload-limits";

/**
 * Ponto único de gravação de documentos enviados (importação na
 * Documentação e evidência de encerramento de ações). Usa o storage
 * configurado (local ou S3) com a chave `org/instalação/uuid.ext`.
 */

/** Nome do arquivo sem pasta. Aceita caminhos do Windows (com "\\"), que o
 * path.basename do servidor (Linux) não separa. */
export function plainFileName(fileName: string): string {
  return fileName.split(/[\\/]/).filter(Boolean).pop() ?? fileName;
}

export function titleFromFileName(fileName: string): string {
  const name = plainFileName(fileName);
  const base = path.basename(name, path.extname(name));
  return base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() || fileName;
}

/** Valida, grava e registra um arquivo como documento da estrutura. */
export async function saveDocumentFile(
  organizationId: string,
  installationId: string,
  file: File,
  meta: { title?: string; type?: string } = {}
) {
  const ext = path.extname(file.name).toLowerCase();
  assertUploadAllowed(file, ext);

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const objectKey = buildObjectKey(organizationId, installationId, ext);
  await getStorage().put(objectKey, buffer, mimeType);
  const extractedText = await extractText(buffer, ext);

  return prisma.documentFile.create({
    data: {
      title: meta.title?.trim() || titleFromFileName(file.name),
      type: meta.type?.trim() || "Documento",
      fileName: plainFileName(file.name),
      filePath: objectKey,
      mimeType,
      extractedText,
      installationId,
    },
  });
}

/**
 * Registra um arquivo que o navegador já enviou direto ao bucket (URL
 * assinada). Lê o objeto do storage para extrair o texto e cria o documento.
 */
export async function registerStoredDocument(
  installationId: string,
  stored: { key: string; name: string; size: number; mimeType: string }
) {
  const ext = path.extname(stored.name).toLowerCase();
  let extractedText: string | null = null;
  // Acima do limite o documento entra sem leitura de texto (memória do servidor).
  if (stored.size <= MAX_TEXT_EXTRACTION_BYTES) {
    const buffer = await getStorage().get(stored.key);
    extractedText = await extractText(buffer, ext);
  }
  return prisma.documentFile.create({
    data: {
      title: titleFromFileName(stored.name),
      type: "Documento",
      fileName: plainFileName(stored.name),
      filePath: stored.key,
      mimeType: stored.mimeType || "application/octet-stream",
      extractedText,
      installationId,
    },
  });
}
