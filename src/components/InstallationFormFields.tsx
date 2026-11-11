import type { Installation } from "@prisma/client";
import { PHASE_LABELS } from "@/lib/applicability";
import { InfoTip } from "@/components/InfoTip";

/**
 * Campos do cadastro da estrutura (itens 10, 11 e 12), em três etapas
 * numeradas. Usado na criação (lista de estruturas) e na edição
 * (aba "Dados da estrutura").
 */
export function InstallationFormFields({ installation }: { installation?: Installation | null }) {
  const v = installation;
  return (
    <div className="space-y-6">
      <Step n={1} title="Estrutura">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nome da estrutura">
            <input name="name" required defaultValue={v?.name ?? ""} className="input" placeholder="Ex.: Barragem Norte" />
          </Field>
          <Field label="Local">
            <input name="location" defaultValue={v?.location ?? ""} className="input" placeholder="Ex.: Ouro Preto/MG" />
          </Field>
        </div>
      </Step>

      <Step n={2} title="Situação e classificação">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Fase da estrutura"
            info={
              <InfoTip label="Por que a fase importa">
                Estruturas novas ou em construção recebem &quot;Não se aplica&quot; automático nos
                requisitos que valem só para estruturas existentes. A marcação entra como
                sugestão e ainda precisa de validação.
              </InfoTip>
            }
          >
            <select name="phase" defaultValue={v?.phase ?? "OPERACAO"} className="input">
              {Object.entries(PHASE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Já tem classificação de DPA?">
            <select
              name="hasDpaClassification"
              defaultValue={v?.hasDpaClassification === true ? "SIM" : v?.hasDpaClassification === false ? "NAO" : ""}
              className="input"
            >
              <option value="">Não informado</option>
              <option value="SIM">Sim</option>
              <option value="NAO">Não</option>
            </select>
          </Field>
          <Field label="Classe de DPA">
            <select name="dpaClassification" defaultValue={v?.dpaClassification ?? ""} className="input">
              <option value="">—</option>
              <option value="ALTO">Alto</option>
              <option value="MEDIO">Médio</option>
              <option value="BAIXO">Baixo</option>
            </select>
          </Field>
        </div>
      </Step>

      <Step n={3} title="Responsáveis">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Engenheiro de Registro (EdR / EoR)">
            <input name="eorName" defaultValue={v?.eorName ?? ""} className="input" placeholder="Nome" />
          </Field>
          <Field label="Empresa do EoR">
            <input name="eorCompany" defaultValue={v?.eorCompany ?? ""} className="input" />
          </Field>
          <Field label="E-mail do EoR">
            <input type="email" name="eorEmail" defaultValue={v?.eorEmail ?? ""} className="input" />
          </Field>
          <Field label="Engenheiro Responsável (RTER / RTFE)">
            <input name="rtfeName" defaultValue={v?.rtfeName ?? ""} className="input" />
          </Field>
          <Field label="Executivo Responsável">
            <input name="accountableExecutive" defaultValue={v?.accountableExecutive ?? ""} className="input" />
          </Field>
          <Field label="Demais pessoas (uma por linha)" className="sm:col-span-3">
            <textarea
              name="otherResponsibles"
              rows={3}
              defaultValue={v?.otherResponsibles ?? ""}
              className="input"
              placeholder={"Ex.: Maria Silva — Geotecnia\nJoão Souza — Meio ambiente"}
            />
          </Field>
        </div>
      </Step>

      <Step n={4} title="Enquadramento legal">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field
            label="País"
            info={
              <InfoTip label="Por que o país importa">
                Define quais leis entram na aba &quot;Normas e prazos&quot;. Fora do Brasil, só o
                GISTM é aplicado.
              </InfoTip>
            }
          >
            <input name="country" maxLength={2} defaultValue={v?.country ?? "BR"} className="input uppercase" placeholder="BR" />
          </Field>
          <Field label="Estado (UF)">
            <input name="uf" maxLength={2} defaultValue={v?.uf ?? ""} className="input uppercase" placeholder="MG" />
          </Field>
          <Field label="Inserida na PNSB?">
            <YesNo name="inPnsb" value={v?.inPnsb} />
          </Field>
          <Field label="Categoria de Risco (CRI)">
            <select name="criClassification" defaultValue={v?.criClassification ?? ""} className="input">
              <option value="">—</option>
              <option value="ALTO">Alto</option>
              <option value="MEDIO">Médio</option>
              <option value="BAIXO">Baixo</option>
            </select>
          </Field>
          <Field label="Método construtivo">
            <select name="constructionMethod" defaultValue={v?.constructionMethod ?? ""} className="input">
              <option value="">—</option>
              <option value="MONTANTE">Alteamento a montante</option>
              <option value="JUSANTE">Alteamento a jusante</option>
              <option value="LINHA_DE_CENTRO">Linha de centro</option>
              <option value="ETAPA_UNICA">Etapa única</option>
              <option value="OUTRO">Outro</option>
            </select>
          </Field>
          <Field label="Classe de consequência (GISTM)">
            <select name="gistmConsequence" defaultValue={v?.gistmConsequence ?? ""} className="input">
              <option value="">—</option>
              <option value="BAIXA">Baixa</option>
              <option value="SIGNIFICATIVA">Significativa</option>
              <option value="ALTA">Alta</option>
              <option value="MUITO_ALTA">Muito alta</option>
              <option value="EXTREMA">Extrema</option>
            </select>
          </Field>
          <Field label="Comunidade na ZAS?">
            <YesNo name="zasCommunity" value={v?.zasCommunity} />
          </Field>
        </div>
      </Step>
    </div>
  );
}

function YesNo({ name, value }: { name: string; value: boolean | null | undefined }) {
  return (
    <select name={name} defaultValue={value === true ? "SIM" : value === false ? "NAO" : ""} className="input">
      <option value="">Não informado</option>
      <option value="SIM">Sim</option>
      <option value="NAO">Não</option>
    </select>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-mineral-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600">
          {n}
        </span>
        {title}
      </p>
      {children}
    </section>
  );
}

function Field({
  label,
  info,
  children,
  className,
}: {
  label: string;
  info?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  // <div> e não <label>: o InfoTip é interativo e não pode ficar dentro de um <label>.
  return (
    <div className={className}>
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-mineral-600">
        {label}
        {info}
      </span>
      {children}
    </div>
  );
}
