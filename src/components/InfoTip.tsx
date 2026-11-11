import type { ReactNode } from "react";
import clsx from "clsx";
import { Info } from "lucide-react";
import { CRITICALITY_CRITERIA, ROBUSTNESS_CRITERIA, CLASSIFICATION_CRITERIA } from "@/lib/criteria";

/**
 * Ícone "i" que esconde explicações longas (itens 8, 15 e 27). Abre ao passar
 * o mouse, ao focar com o teclado ou ao tocar (foco), sem JavaScript.
 *
 * Só usa <span>: pode ficar dentro de títulos e parágrafos sem gerar HTML
 * inválido (um <details> dentro de <p> quebra a hidratação do React).
 */
export function InfoTip({
  children,
  label = "Mais informações",
  align = "left",
  width = "w-72",
}: {
  children: ReactNode;
  label?: string;
  align?: "left" | "right";
  width?: string;
}) {
  return (
    <span className="group/tip relative inline-flex align-middle">
      <span
        tabIndex={0}
        role="button"
        aria-label={label}
        title={label}
        className="flex h-5 w-5 cursor-help items-center justify-center rounded-full text-mineral-400 outline-none hover:bg-brand-50 hover:text-brand-600 focus:bg-brand-50 focus:text-brand-600"
      >
        <Info size={14} />
      </span>
      <span
        role="tooltip"
        className={clsx(
          // hidden (e não invisible): escondido, o balão não ocupa largura e não
          // faz a página rolar para o lado no celular.
          "absolute top-6 z-50 hidden max-w-[calc(100vw-2rem)] rounded-lg border border-mineral-200 bg-white p-3 text-left font-sans text-xs font-normal normal-case leading-relaxed tracking-normal text-mineral-700 shadow-[var(--shadow-float)]",
          "group-hover/tip:block group-focus-within/tip:block",
          width,
          align === "left" ? "left-0" : "right-0"
        )}
        style={{ letterSpacing: "normal" }}
      >
        {children}
      </span>
    </span>
  );
}

const DOT: Record<string, string> = {
  bad: "bg-state-bad",
  warn: "bg-[#c2870f]",
  ok: "bg-state-ok",
  none: "bg-mineral-300",
};

export function CriticalityInfo({ align }: { align?: "left" | "right" }) {
  return (
    <InfoTip label="Critérios de criticidade" align={align}>
      <span className="mb-2 block font-semibold text-mineral-900">Critérios de criticidade</span>
      <span className="block space-y-2">
        {CRITICALITY_CRITERIA.map((c) => (
          <span key={c.level} className="flex gap-2">
            <span className={clsx("mt-1 h-2 w-2 shrink-0 rounded-full", DOT[c.tone])} />
            <span>
              <strong className="text-mineral-900">{c.level}:</strong> {c.text}
            </span>
          </span>
        ))}
      </span>
    </InfoTip>
  );
}

export function RobustnessInfo({ align }: { align?: "left" | "right" }) {
  return (
    <InfoTip label="Critérios de robustez" align={align}>
      <span className="mb-2 block font-semibold text-mineral-900">Robustez da evidência</span>
      <span className="block space-y-1.5">
        {ROBUSTNESS_CRITERIA.map((c) => (
          <span key={c.level} className="block">
            <strong className="text-mineral-900">{c.level}:</strong> {c.text}
          </span>
        ))}
      </span>
    </InfoTip>
  );
}

export function ClassificationInfo({ align }: { align?: "left" | "right" }) {
  return (
    <InfoTip label="Critérios de classificação" align={align}>
      <span className="mb-2 block font-semibold text-mineral-900">Classificação</span>
      <span className="block space-y-1.5">
        {CLASSIFICATION_CRITERIA.map((c) => (
          <span key={c.level} className="block">
            <strong className="text-mineral-900">{c.level}:</strong> {c.text}
          </span>
        ))}
      </span>
    </InfoTip>
  );
}
