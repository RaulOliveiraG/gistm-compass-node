// Extensões aceitas como evidência/documento de conformidade: os formatos
// que `text-extraction.ts` sabe ler (.txt/.md/.docx/.xlsx/.pdf) mais os
// formatos de escritório e imagem comuns em evidência (foto de campo,
// planilha antiga .xls, apresentação, CSV) que não têm extração de texto
// mas são conteúdo legítimo de upload.
const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".md",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  // Desenhos de CAD: entram como documento, sem leitura de texto.
  ".dxf",
  ".dwg",
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB (envio pelo servidor)

/**
 * Envio direto ao bucket (S3): o arquivo não passa pelo servidor, então o
 * limite é bem maior. Acima de MAX_TEXT_EXTRACTION_BYTES o documento entra,
 * mas sem leitura de texto, para não estourar a memória do servidor.
 */
export const MAX_DIRECT_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB
export const MAX_TEXT_EXTRACTION_BYTES = 200 * 1024 * 1024; // 200MB

export function isAllowedExtension(ext: string) {
  return ALLOWED_EXTENSIONS.has(ext.toLowerCase());
}

export function assertUploadAllowed(file: File, ext: string) {
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Tipo de arquivo "${ext || "sem extensão"}" não é aceito. Formatos aceitos: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}.`
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `"${file.name}" tem ${(file.size / (1024 * 1024)).toFixed(1)}MB, acima do limite de ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB por arquivo.`
    );
  }
}
