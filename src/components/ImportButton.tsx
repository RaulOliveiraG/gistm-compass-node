"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, FileText, FolderInput, ChevronDown, Loader2 } from "lucide-react";

/** Tamanho máximo de cada envio. O servidor recusa requisições grandes. */
const BATCH_BYTES = 8 * 1024 * 1024;
/** Limite por arquivo da plataforma (ver upload-limits.ts). */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Botão único "Importar" (item 22). Ao clicar, o usuário escolhe entre
 * arquivo(s) avulso(s) ou uma pasta inteira; a seleção é enviada na hora,
 * sem formulário de metadados. Seleções grandes são enviadas em lotes, um
 * depois do outro, com o progresso no botão.
 */
type DirectPlan = { direct: boolean; uploads: { index: number; key: string; url: string }[]; rejected: string[] };

export function ImportButton({
  batchAction,
  finishAction,
  prepareDirect,
  registerDirect,
}: {
  batchAction: (formData: FormData) => Promise<{ imported: number; skipped: string[] }>;
  finishAction: (imported: number, skipped: string[]) => Promise<void>;
  prepareDirect: (files: { name: string; size: number }[]) => Promise<DirectPlan>;
  registerDirect: (stored: { key: string; name: string; size: number; mimeType: string }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const router = useRouter();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  async function submitWith(input: HTMLInputElement | null) {
    if (!input || !input.files || input.files.length === 0 || progress) return;
    const all = Array.from(input.files);
    input.value = "";

    // 1) Envio direto ao bucket (S3), sem passar pelo servidor: aceita
    //    arquivos grandes. Cada arquivo sobe e depois é registrado.
    let plan: DirectPlan | null = null;
    try {
      plan = await prepareDirect(all.map((f) => ({ name: f.name, size: f.size })));
    } catch {
      plan = null;
    }
    if (plan?.direct) {
      const skippedDirect = [...plan.rejected];
      let importedDirect = 0;
      setProgress({ done: 0, total: plan.uploads.length });
      let done = 0;
      let networkErrors = 0;
      // Até 3 envios ao mesmo tempo.
      const queue = [...plan.uploads];
      const worker = async () => {
        for (let u = queue.shift(); u; u = queue.shift()) {
          const f = all[u.index];
          try {
            let put: Response;
            try {
              put = await fetch(u.url, { method: "PUT", body: f });
            } catch (e) {
              // Erro de rede sem resposta: em geral o bucket sem CORS liberado.
              networkErrors++;
              throw e;
            }
            if (!put.ok) throw new Error(String(put.status));
            const ok = await registerDirect({ key: u.key, name: f.name, size: f.size, mimeType: f.type });
            if (ok) importedDirect++;
            else skippedDirect.push(f.name);
          } catch {
            skippedDirect.push(f.name);
          }
          done++;
          setProgress({ done, total: plan!.uploads.length });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const directBlocked = importedDirect === 0 && networkErrors > 0 && networkErrors === plan.uploads.length;
      if (!directBlocked) {
        await finishAction(importedDirect, skippedDirect);
        setProgress(null);
        router.refresh();
        return;
      }
      // Bucket recusou o envio direto (CORS): segue pelo servidor, em lotes.
    }

    // 2) Sem bucket (storage local): envio pelo servidor, em lotes.
    const skipped: string[] = all.filter((f) => f.size > MAX_FILE_BYTES).map((f) => f.name);
    // Lotes de até BATCH_BYTES; arquivo maior que o lote vai sozinho.
    const batches: File[][] = [];
    let current: File[] = [];
    let size = 0;
    for (const f of all.filter((f) => f.size > 0 && f.size <= MAX_FILE_BYTES)) {
      if (current.length > 0 && size + f.size > BATCH_BYTES) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push(f);
      size += f.size;
    }
    if (current.length > 0) batches.push(current);

    let imported = 0;
    setProgress({ done: 0, total: batches.length });
    for (let i = 0; i < batches.length; i++) {
      const fd = new FormData();
      for (const f of batches[i]) fd.append("files", f);
      try {
        const r = await batchAction(fd);
        imported += r.imported;
        skipped.push(...r.skipped);
      } catch {
        skipped.push(...batches[i].map((f) => f.name));
      }
      setProgress({ done: i + 1, total: batches.length });
    }
    await finishAction(imported, skipped);
    setProgress(null);
    router.refresh();
  }

  return (
    <div ref={wrapRef} className="relative">
      <div>
        <input
          ref={filesRef}
          type="file"
          name="files"
          multiple
          className="hidden"
          onChange={() => submitWith(filesRef.current)}
        />
        <input
          ref={folderRef}
          type="file"
          name="files"
          multiple
          className="hidden"
          onChange={() => submitWith(folderRef.current)}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        <TriggerButton progress={progress} onClick={() => setOpen((v) => !v)} />
      </div>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-mineral-200 bg-white shadow-[var(--shadow-float)]">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              filesRef.current?.click();
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-mineral-50"
          >
            <FileText size={18} className="text-brand-500" />
            <span>
              <span className="block text-sm font-medium text-mineral-900">Arquivo(s)</span>
              <span className="block text-xs text-mineral-500">Um ou vários arquivos</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              folderRef.current?.click();
            }}
            className="flex w-full items-center gap-3 border-t border-mineral-100 px-4 py-3 text-left hover:bg-mineral-50"
          >
            <FolderInput size={18} className="text-brand-500" />
            <span>
              <span className="block text-sm font-medium text-mineral-900">Pasta</span>
              <span className="block text-xs text-mineral-500">Todos os arquivos da pasta</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function TriggerButton({
  onClick,
  progress,
}: {
  onClick: () => void;
  progress: { done: number; total: number } | null;
}) {
  const pending = progress !== null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="flex items-center gap-2 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-card)] hover:bg-brand-700 disabled:opacity-70"
    >
      {pending ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
      {progress
        ? progress.total > 1
          ? `Importando ${progress.done}/${progress.total}…`
          : "Importando…"
        : "Importar"}
      {!pending && <ChevronDown size={14} className="opacity-80" />}
    </button>
  );
}
