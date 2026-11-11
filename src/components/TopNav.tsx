"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  LayoutDashboard,
  ListChecks,
  FileStack,
  ClipboardList,
  FileBarChart,
  Megaphone,
  LogOut,
  ArrowLeft,
  Building2,
  Scale,
} from "lucide-react";
import { CompassMark } from "@/components/CompassMark";
import { InstallationSwitcher } from "@/components/InstallationSwitcher";
import { LangSwitcher } from "@/components/LangSwitcher";
import { logoutAction } from "@/lib/auth-actions";

/**
 * Menu horizontal no topo da tela (item 4), substituindo o menu lateral.
 *
 * Linha 1 (escura): marca, troca de estrutura, idioma do conteúdo GISTM e conta.
 * Linha 2 (clara): as abas da estrutura, com os nomes novos (item 5).
 * O Assistente não aparece aqui: ele vive só no botão flutuante (item 6).
 */
export function TopNav({
  installationId,
  installationName,
  userName,
  installations,
  lang,
}: {
  installationId: string;
  installationName: string;
  userName: string;
  installations: { id: string; name: string }[];
  lang: "pt" | "en";
}) {
  const pathname = usePathname();
  const base = `/instalacoes/${installationId}`;

  const TABS: { href: string; label: string; icon: typeof ListChecks }[] = [
    { href: `${base}/dashboard`, label: "Sumário executivo", icon: LayoutDashboard },
    { href: `${base}/requisitos`, label: "Análise", icon: ListChecks },
    { href: `${base}/planos-de-acao`, label: "Planos de ação", icon: ClipboardList },
    { href: `${base}/documentos`, label: "Documentação", icon: FileStack },
    { href: `${base}/relatorio`, label: "Relatório", icon: FileBarChart },
    { href: `${base}/documentos/divulgacao`, label: "Divulgação", icon: Megaphone },
    { href: `${base}/normas`, label: "Normas e prazos", icon: Scale },
    { href: `${base}/estrutura`, label: "Dados da estrutura", icon: Building2 },
  ];

  function ativo(href: string) {
    if (href.endsWith("/dashboard")) {
      return pathname === href || pathname.startsWith(`${base}/dashboard-tecnico`);
    }
    if (href.endsWith("/documentos")) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <header className="sticky top-0 z-40 w-full print:hidden">
      <div className="bg-brand-800 text-mineral-100">
        <div className="content-shell flex h-14 items-center gap-4">
          <Link href="/instalacoes" className="flex shrink-0 items-center gap-2" title="Todas as estruturas">
            <CompassMark className="text-brand-300" size={24} />
            <span className="hidden font-display text-[1rem] font-semibold tracking-tight sm:inline">
              GISTM Compass
            </span>
          </Link>

          <span className="hidden h-6 w-px bg-brand-700 sm:block" aria-hidden />

          <div className="min-w-0 max-w-xs flex-1">
            {installations.length >= 2 ? (
              <InstallationSwitcher installations={installations} currentId={installationId} />
            ) : (
              <p className="truncate text-sm font-medium text-white" title={installationName}>
                {installationName}
              </p>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <LangSwitcher lang={lang} />
            <Link
              href="/instalacoes"
              className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-mineral-300 hover:bg-brand-700 hover:text-white md:flex"
            >
              <ArrowLeft size={13} />
              Todas as estruturas
            </Link>
            <Link
              href="/conta"
              className="max-w-[10rem] truncate rounded-md px-2.5 py-1.5 text-xs text-mineral-300 hover:bg-brand-700 hover:text-white"
              title={`${userName} — Minha conta`}
            >
              {userName}
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-mineral-400 hover:bg-brand-700 hover:text-white"
                title="Sair"
              >
                <LogOut size={13} />
                <span className="hidden lg:inline">Sair</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      <nav className="border-b border-mineral-200 bg-white" aria-label="Seções da estrutura">
        <div className="content-shell flex gap-1 overflow-x-auto">
          {TABS.map(({ href, label, icon: Icon }) => {
            const on = ativo(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className={clsx(
                  "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                  on
                    ? "border-brand-500 text-brand-700"
                    : "border-transparent text-mineral-600 hover:border-mineral-300 hover:text-mineral-900"
                )}
              >
                <Icon size={16} className="shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
