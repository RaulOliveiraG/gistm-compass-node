import type { Installation } from "@prisma/client";

/**
 * Catálogo de normas e obrigações legais (aba "Normas e prazos").
 *
 * Cada obrigação tem: a norma de origem, o artigo, a periodicidade (para
 * calcular o próximo prazo), uma regra de aplicabilidade baseada no cadastro
 * da estrutura e termos para a IA localizar evidência nos documentos.
 *
 * Conteúdo levantado em novembro/2026. Normas mudam: confira a vigência antes
 * de usar o checklist como parecer, e atualize este arquivo quando sair norma
 * nova (a skill "normas-vigentes-barragens" ajuda a fazer essa revisão).
 */

export type Sphere = "GISTM" | "FEDERAL" | "ESTADUAL" | "ABNT";

export interface Norm {
  id: string;
  sphere: Sphere;
  name: string;
  summary: string;
  /** Situação na data do levantamento. */
  status: "VIGENTE" | "VIGENTE_ATE" | "FUTURA";
  /** Data relevante da situação (fim da vigência ou entrada em vigor), AAAA-MM-DD. */
  statusDate?: string;
  url?: string;
}

export type Recurrence =
  /** A cada N meses, contados da última vez que foi cumprida. */
  | { kind: "every"; months: number }
  /** Janela fixa no ano: entrega entre o dia 1 e o último dia dos meses listados (1–12). */
  | { kind: "window"; months: number[] }
  /** Prazo único. */
  | { kind: "deadline"; date: string }
  /** Exigência contínua, sem data. */
  | { kind: "continuous" };

/** true = aplica; false = não aplica; null = faltam dados no cadastro para decidir. */
export type Applicability = boolean | null;

export interface Obligation {
  code: string;
  normId: string;
  article: string;
  title: string;
  description: string;
  recurrence: Recurrence;
  /** Periodicidade que depende da estrutura (ex.: RPSB por DPA). Sobrepõe `recurrence`. */
  recurrenceFor?: (i: InstallationFacts) => Recurrence | null;
  applies: (i: InstallationFacts) => Applicability;
  /** Termos (PT e EN) que indicam evidência nos documentos. */
  evidenceTerms: string[];
}

export type InstallationFacts = Pick<
  Installation,
  | "country"
  | "uf"
  | "inPnsb"
  | "dpaClassification"
  | "criClassification"
  | "constructionMethod"
  | "gistmConsequence"
  | "zasCommunity"
  | "phase"
>;

// ---------------------------------------------------------------------------
// Normas
// ---------------------------------------------------------------------------

export const NORMS: Norm[] = [
  {
    id: "GISTM",
    sphere: "GISTM",
    name: "GISTM (2020)",
    summary:
      "Padrão Global da Indústria para a Gestão de Rejeitos. Conformidade exigida até 05/08/2023 para " +
      "estruturas de consequência Extrema ou Muito Alta e até 05/08/2025 para as demais (membros do ICMM).",
    status: "VIGENTE",
    url: "https://globaltailingsreview.org/global-industry-standard/",
  },
  {
    id: "LEI-12334",
    sphere: "FEDERAL",
    name: "Lei 12.334/2010 (PNSB), alterada pela Lei 14.066/2020",
    summary:
      "Política Nacional de Segurança de Barragens: obrigações do empreendedor (PSB, PAE, inspeções, " +
      "revisões periódicas, DCE), vedação do alteamento a montante e infrações e sanções.",
    status: "VIGENTE",
    url: "https://www.planalto.gov.br/ccivil_03/_Ato2007-2010/2010/Lei/L12334.htm",
  },
  {
    id: "ANM-95",
    sphere: "FEDERAL",
    name: "Resolução ANM 95/2022 (e alterações, ex.: 130/2023 e 175/2024)",
    summary:
      "Regulamento de segurança de barragens de mineração em vigor: inspeções e EIR, RISR/DCE, RPSB, " +
      "PAEBM, ACO/DCO, monitoramento. Revogada pela Resolução ANM 220/2025 a partir de 02/08/2027.",
    status: "VIGENTE_ATE",
    statusDate: "2027-08-01",
    url: "https://www.gov.br/anm/pt-br/itens/arquivos/resolucao_anm_no95.pdf",
  },
  {
    id: "ANM-220",
    sphere: "FEDERAL",
    name: "Resolução ANM 220/2025",
    summary:
      "Novo regulamento de barragens de mineração, alinhado à Resolução CNRH 241/2024 (DPA em quatro " +
      "componentes). Entra em vigor em 02/08/2027; níveis de segurança substituem os níveis de emergência; " +
      "estudo de ruptura pela ABNT NBR 17188:2024. Retirada de trabalhadores da ZAS até 31/12/2029.",
    status: "FUTURA",
    statusDate: "2027-08-02",
  },
  {
    id: "MG-23291",
    sphere: "ESTADUAL",
    name: "Lei MG 23.291/2019 (PESB) e Decreto 48.140/2021",
    summary:
      "Política Estadual de Segurança de Barragens de Minas Gerais: cadastro e classificação no Sigibar " +
      "(Feam), auditoria técnica de segurança com RTSB e DCE, proibição de barragens a montante.",
    status: "VIGENTE",
  },
  {
    id: "MG-48747",
    sphere: "ESTADUAL",
    name: "Decreto MG 48.747/2023 (caução ambiental)",
    summary: "Caução ambiental para barragens abrangidas pela PESB (dinheiro, CDB do BDMG, fiança ou seguro-garantia).",
    status: "VIGENTE",
  },
  {
    id: "NBR-13028",
    sphere: "ABNT",
    name: "ABNT NBR 13028:2024",
    summary: "Mineração: elaboração e apresentação de projeto de barragens, incluindo descaracterização.",
    status: "VIGENTE",
  },
  {
    id: "NBR-17188",
    sphere: "ABNT",
    name: "ABNT NBR 17188:2024",
    summary: "Estudo de ruptura hipotética e mapas de inundação; obrigatória pela Resolução ANM 220/2025.",
    status: "VIGENTE",
  },
];

// ---------------------------------------------------------------------------
// Regras de aplicabilidade
// ---------------------------------------------------------------------------

const inBrazil = (i: InstallationFacts) => (i.country ?? "BR").toUpperCase() === "BR";
const inMG = (i: InstallationFacts) => inBrazil(i) && (i.uf ?? "").toUpperCase() === "MG";
const inPnsb = (i: InstallationFacts): Applicability => (!inBrazil(i) ? false : i.inPnsb ?? null);
const highConsequence = (i: InstallationFacts): Applicability =>
  i.gistmConsequence ? ["ALTA", "MUITO_ALTA", "EXTREMA"].includes(i.gistmConsequence) : null;
const dpaHigh = (i: InstallationFacts): Applicability => {
  const p = inPnsb(i);
  if (p !== true) return p;
  return i.dpaClassification ? i.dpaClassification === "ALTO" : null;
};

// ---------------------------------------------------------------------------
// Obrigações
// ---------------------------------------------------------------------------

export const OBLIGATIONS: Obligation[] = [
  // GISTM: periodicidades do próprio texto do Padrão.
  {
    code: "GISTM-2.1",
    normId: "GISTM",
    article: "Requisito 2.1",
    title: "Atualizar a base de conhecimento",
    description: "Atualizar a base de conhecimento ao menos a cada cinco anos e sempre que houver mudança relevante.",
    recurrence: { kind: "every", months: 60 },
    applies: () => true,
    evidenceTerms: ["knowledge base", "base de conhecimento", "baseline", "site characterisation", "caracterização"],
  },
  {
    code: "GISTM-6.4",
    normId: "GISTM",
    article: "Requisito 6.4",
    title: "Revisar o Manual OMS",
    description: "Revisar anualmente e atualizar quando necessário o Manual de Operação, Manutenção e Monitoramento (OMS).",
    recurrence: { kind: "every", months: 12 },
    applies: () => true,
    evidenceTerms: ["OMS Manual", "Operations, Maintenance and Surveillance", "Manual OMS", "Manual de Operação"],
  },
  {
    code: "GISTM-7.5",
    normId: "GISTM",
    article: "Requisito 7.5",
    title: "Reportar os resultados do monitoramento",
    description: "Reportar os resultados de cada programa de monitoramento ao menos uma vez por ano.",
    recurrence: { kind: "every", months: 12 },
    applies: () => true,
    evidenceTerms: ["monitoring report", "relatório de monitoramento", "instrumentation", "piezometer", "instrumentação"],
  },
  {
    code: "GISTM-10.1",
    normId: "GISTM",
    article: "Requisito 10.1",
    title: "Atualizar a avaliação de risco",
    description:
      "Fazer e atualizar a avaliação de risco com equipe multidisciplinar ao menos a cada três anos e quando houver mudança relevante.",
    recurrence: { kind: "every", months: 36 },
    applies: () => true,
    evidenceTerms: ["FMEA", "risk assessment", "avaliação de risco", "análise de risco", "SQRA", "bow-tie"],
  },
  {
    code: "GISTM-10.2",
    normId: "GISTM",
    article: "Requisito 10.2",
    title: "Revisar o sistema de gestão de rejeitos",
    description:
      "Revisar o TMS e o ESMS por revisor técnico sênior ao menos a cada três anos (consequência Alta, Muito Alta ou Extrema).",
    recurrence: { kind: "every", months: 36 },
    applies: highConsequence,
    evidenceTerms: ["Tailings Management System", "TMS review", "ESMS", "sistema de gestão de rejeitos"],
  },
  {
    code: "GISTM-10.4",
    normId: "GISTM",
    article: "Requisito 10.4",
    title: "Revisão anual de construção e desempenho",
    description: "O EoR ou revisor sênior independente faz a revisão de construção e desempenho ao menos uma vez por ano.",
    recurrence: { kind: "every", months: 12 },
    applies: () => true,
    evidenceTerms: ["annual performance review", "construction and performance review", "inspection report", "relatório de inspeção", "EoR"],
  },
  {
    code: "GISTM-10.5",
    normId: "GISTM",
    article: "Requisito 10.5",
    title: "Revisão de Segurança da Barragem (DSR) independente",
    description:
      "DSR independente ao menos a cada 5 anos (consequência Muito Alta ou Extrema) ou a cada 10 anos (demais).",
    recurrence: { kind: "every", months: 60 },
    recurrenceFor: (i) =>
      i.gistmConsequence
        ? { kind: "every", months: ["MUITO_ALTA", "EXTREMA"].includes(i.gistmConsequence) ? 60 : 120 }
        : null,
    applies: () => true,
    evidenceTerms: ["Dam Safety Review", "DSR", "Revisão de Segurança", "Revisão Periódica de Segurança"],
  },
  {
    code: "GISTM-5.8",
    normId: "GISTM",
    article: "Requisitos 4.2 e 5.8",
    title: "Confirmação de ALARP pelo Executivo Responsável",
    description:
      "Em estrutura existente de consequência Alta, Muito Alta ou Extrema, o Executivo Responsável confirma a cada DSR, ou ao menos a cada 5 anos, que o projeto atende ao ALARP.",
    recurrence: { kind: "every", months: 60 },
    applies: (i) => (i.phase === "NOVA" || i.phase === "EM_CONSTRUCAO" ? false : highConsequence(i)),
    evidenceTerms: ["ALARP", "Accountable Executive", "Executivo Responsável"],
  },
  {
    code: "GISTM-13.3",
    normId: "GISTM",
    article: "Requisito 13.3",
    title: "Treinamento anual e simulados de emergência",
    description:
      "Treinamentos e exercícios anuais com a comunidade e o poder público; simulações de resposta ao menos a cada 3 anos quando há potencial de perda de vidas.",
    recurrence: { kind: "every", months: 12 },
    applies: () => true,
    evidenceTerms: ["emergency simulation", "drill", "simulado", "EPRP", "PAEBM", "training", "treinamento"],
  },
  {
    code: "GISTM-15.1",
    normId: "GISTM",
    article: "Requisito 15.1",
    title: "Divulgação pública anual",
    description:
      "Publicar e atualizar ao menos uma vez por ano as informações da estrutura (descrição, classificação de consequência, resultados de revisões, capacidade financeira etc.).",
    recurrence: { kind: "every", months: 12 },
    applies: () => true,
    evidenceTerms: ["public disclosure", "divulgação", "sustainability report", "relatório de sustentabilidade", "GISTM disclosure"],
  },

  // Lei 12.334/2010 (PNSB)
  {
    code: "PNSB-PSB",
    normId: "LEI-12334",
    article: "Art. 17, VII",
    title: "Plano de Segurança da Barragem (PSB) atualizado",
    description:
      "Elaborar e manter atualizado o PSB, observando as recomendações das inspeções e das revisões periódicas de segurança.",
    recurrence: { kind: "continuous" },
    applies: inPnsb,
    evidenceTerms: ["Plano de Segurança da Barragem", "PSB", "Dam Safety Plan"],
  },
  {
    code: "PNSB-PAE",
    normId: "LEI-12334",
    article: "Art. 11",
    title: "Plano de Ação de Emergência (PAE/PAEBM)",
    description:
      "PAE obrigatório para barragens de rejeitos de mineração, para DPA médio ou alto e para risco alto; disponível no empreendimento, nas prefeituras e na defesa civil.",
    recurrence: { kind: "continuous" },
    applies: (i) => (inBrazil(i) ? true : false),
    evidenceTerms: ["PAEBM", "Plano de Ação de Emergência", "Emergency Action Plan", "EPRP"],
  },
  {
    code: "PNSB-MONTANTE",
    normId: "LEI-12334",
    article: "Art. 2º-A",
    title: "Vedação e descaracterização de barragem a montante",
    description:
      "É vedado o alteamento a montante; barragens a montante devem ser descaracterizadas (prazo legal original 25/02/2022, com prorrogações caso a caso pela ANM).",
    recurrence: { kind: "deadline", date: "2022-02-25" },
    applies: (i) => (!inBrazil(i) ? false : i.constructionMethod ? i.constructionMethod === "MONTANTE" : null),
    evidenceTerms: ["descaracterização", "decharacterization", "alteamento a montante", "upstream"],
  },
  {
    code: "PNSB-GARANTIA",
    normId: "LEI-12334",
    article: "Art. 17, § 2º",
    title: "Garantia financeira (caução, seguro, fiança)",
    description:
      "O órgão fiscalizador pode exigir caução, seguro, fiança ou outra garantia para barragens de rejeitos de risco ou DPA médio ou alto. Verifique se já há exigência regulamentada para a estrutura.",
    recurrence: { kind: "continuous" },
    applies: inPnsb,
    evidenceTerms: ["caução", "seguro-garantia", "fiança", "financial assurance", "insurance"],
  },

  // Resolução ANM 95/2022 (vigente até 01/08/2027)
  {
    code: "ANM95-EIR",
    normId: "ANM-95",
    article: "Arts. 19 e 21",
    title: "Inspeção regular quinzenal e EIR no SIGBM",
    description:
      "Inspeção e Ficha de Inspeção Regular quinzenal; Extrato de Inspeção Regular no SIGBM até o fim da quinzena seguinte. Quatro quinzenas sem EIR levam a embargo ou suspensão.",
    recurrence: { kind: "every", months: 0.5 },
    applies: inPnsb,
    evidenceTerms: ["Extrato de Inspeção Regular", "EIR", "Ficha de Inspeção", "SIGBM", "inspeção quinzenal"],
  },
  {
    code: "ANM95-RISR",
    normId: "ANM-95",
    article: "Art. 19, III",
    title: "RISR e Declaração de Condição de Estabilidade (DCE)",
    description:
      "RISR e DCE semestrais, enviados no SIGBM de 1º a 31 de março e de 1º a 30 de setembro. Os de setembro devem ser feitos por consultoria externa.",
    recurrence: { kind: "window", months: [3, 9] },
    applies: inPnsb,
    evidenceTerms: ["RISR", "Relatório de Inspeção de Segurança Regular", "Declaração de Condição de Estabilidade", "DCE"],
  },
  {
    code: "ANM95-RPSB",
    normId: "ANM-95",
    article: "Art. 18",
    title: "Revisão Periódica de Segurança de Barragem (RPSB)",
    description:
      "RPSB a cada 3 anos (DPA alto), 5 anos (médio) ou 7 anos (baixo); barragem alteada continuamente a cada 2 anos ou 10 m alteados. Nova RPSB em até 6 meses após modificação estrutural.",
    recurrence: { kind: "every", months: 36 },
    recurrenceFor: (i) =>
      i.dpaClassification === "ALTO"
        ? { kind: "every", months: 36 }
        : i.dpaClassification === "MEDIO"
          ? { kind: "every", months: 60 }
          : i.dpaClassification === "BAIXO"
            ? { kind: "every", months: 84 }
            : null,
    applies: inPnsb,
    evidenceTerms: ["Revisão Periódica de Segurança", "RPSB", "Dam Safety Review", "DSR"],
  },
  {
    code: "ANM95-DCO",
    normId: "ANM-95",
    article: "Arts. 44 e 45",
    title: "ACO/RCO do PAEBM e DCO no SIGBM",
    description:
      "Avaliação de Conformidade e Operacionalidade do PAEBM anual, com RCO e envio da DCO no SIGBM de 1º a 30 de junho.",
    recurrence: { kind: "window", months: [6] },
    applies: inPnsb,
    evidenceTerms: ["Declaração de Conformidade e Operacionalidade", "DCO", "RCO", "ACO", "PAEBM"],
  },
  {
    code: "ANM95-SEMINARIO",
    normId: "ANM-95",
    article: "Art. 48",
    title: "Seminário orientativo anual",
    description: "Seminário anual com prefeituras, defesa civil, equipe de segurança e população da ZAS.",
    recurrence: { kind: "every", months: 12 },
    applies: inPnsb,
    evidenceTerms: ["Seminário Orientativo", "seminário", "defesa civil", "community meeting"],
  },
  {
    code: "ANM95-TREINAMENTO",
    normId: "ANM-95",
    article: "Arts. 38, III e 47",
    title: "Treinamentos internos e simulado do PAEBM",
    description: "Treinamentos internos no máximo a cada 6 meses e ao menos um simulado prático por ano.",
    recurrence: { kind: "every", months: 6 },
    applies: inPnsb,
    evidenceTerms: ["treinamento", "simulado", "training", "drill", "exercício simulado"],
  },
  {
    code: "ANM95-MONITORAMENTO",
    normId: "ANM-95",
    article: "Art. 7º",
    title: "Monitoramento automatizado e videomonitoramento 24 h",
    description:
      "DPA alto: monitoramento automatizado em tempo real e videomonitoramento 24 horas, com imagens guardadas por no mínimo 90 dias.",
    recurrence: { kind: "continuous" },
    applies: dpaHigh,
    evidenceTerms: ["videomonitoramento", "monitoramento automatizado", "real-time monitoring", "CCTV", "Centro de Monitoramento"],
  },
  {
    code: "ANM95-PGRBM",
    normId: "ANM-95",
    article: "Art. 53",
    title: "Atualizar o PGRBM",
    description:
      "Atualizar o Plano de Gestão de Riscos da Barragem antes de modificações estruturais, após incidentes e no máximo a cada 2 anos.",
    recurrence: { kind: "every", months: 24 },
    applies: inPnsb,
    evidenceTerms: ["PGRBM", "Plano de Gestão de Risco", "gestão de riscos", "risk management plan"],
  },
  {
    code: "ANM95-QUALIFICACAO",
    normId: "ANM-95",
    article: "Arts. 60 e 74",
    title: "Qualificação técnica dos profissionais",
    description:
      "Desde 01/01/2024, coordenadores de RISR, RPSB, DCE, projeto de descaracterização e outros devem ter a qualificação mínima exigida.",
    recurrence: { kind: "continuous" },
    applies: inPnsb,
    evidenceTerms: ["ART", "CAT", "qualificação", "responsável técnico", "CREA"],
  },

  // Transição para a Resolução ANM 220/2025
  {
    code: "ANM220-INUNDACAO",
    normId: "ANM-220",
    article: "Art. 76, § 1º",
    title: "Novos estudos de áreas de inundação e áreas afetadas",
    description:
      "Concluir os estudos que delimitam as novas áreas de inundação e áreas afetadas, considerando a ruptura de cada estrutura e a NBR 17188:2024.",
    recurrence: { kind: "deadline", date: "2027-07-30" },
    applies: inPnsb,
    evidenceTerms: ["dam break", "ruptura hipotética", "mapa de inundação", "inundation map", "NBR 17188"],
  },
  {
    code: "ANM220-ZAS",
    normId: "ANM-220",
    article: "Art. 7º, § 1º (prazo do art. 87)",
    title: "Retirar trabalhadores de lavra, beneficiamento e disposição da ZAS",
    description: "Prazo prorrogado para 31/12/2029 pela ANM em agosto de 2026.",
    recurrence: { kind: "deadline", date: "2029-12-31" },
    applies: inPnsb,
    evidenceTerms: ["Zona de Autossalvamento", "ZAS", "self-rescue zone", "realocação"],
  },

  // Minas Gerais
  {
    code: "MG-SIGIBAR",
    normId: "MG-23291",
    article: "Lei 23.291/2019; Decreto 48.140/2021",
    title: "Cadastro e classificação no Sigibar",
    description: "Manter a barragem cadastrada e classificada pela Feam (Sigibar), com informações atualizadas.",
    recurrence: { kind: "continuous" },
    applies: (i) => (inMG(i) ? true : false),
    evidenceTerms: ["Sigibar", "Feam", "PESB", "cadastro estadual"],
  },
  {
    code: "MG-AUDITORIA",
    normId: "MG-23291",
    article: "Decreto 48.140/2021; Portaria Feam 699/2023",
    title: "Auditoria técnica de segurança (RTSB e DCE estadual)",
    description:
      "Auditoria técnica de segurança por auditor independente, com Relatório Técnico de Segurança de Barragem e DCE no Sigibar, na periodicidade da Feam.",
    recurrence: { kind: "every", months: 12 },
    applies: (i) => (inMG(i) ? true : false),
    evidenceTerms: ["RTSB", "Relatório Técnico de Segurança", "auditoria técnica", "Feam"],
  },
  {
    code: "MG-CAUCAO",
    normId: "MG-48747",
    article: "Lei 23.291/2019, art. 7º; Decreto 48.747/2023",
    title: "Caução ambiental",
    description: "Apresentar e manter a caução ambiental exigida pela PESB no licenciamento e na operação.",
    recurrence: { kind: "continuous" },
    applies: (i) => (inMG(i) ? true : false),
    evidenceTerms: ["caução ambiental", "seguro-garantia", "fiança bancária", "BDMG"],
  },
];

export const OBLIGATION_BY_CODE = new Map(OBLIGATIONS.map((o) => [o.code, o]));
export const NORM_BY_ID = new Map(NORMS.map((n) => [n.id, n]));

export const LEGAL_STATUSES = ["CONFORME", "NAO_CONFORME", "NAO_APLICAVEL", "SEM_EVIDENCIA"] as const;
export type LegalStatus = (typeof LEGAL_STATUSES)[number];

export const LEGAL_STATUS_LABEL: Record<LegalStatus, string> = {
  CONFORME: "Em dia",
  NAO_CONFORME: "Pendente",
  NAO_APLICAVEL: "Não se aplica",
  SEM_EVIDENCIA: "Sem evidência",
};

export function effectiveRecurrence(o: Obligation, i: InstallationFacts): Recurrence {
  return o.recurrenceFor?.(i) ?? o.recurrence;
}

export function recurrenceLabel(r: Recurrence): string {
  switch (r.kind) {
    case "every":
      if (r.months < 1) return "Quinzenal";
      if (r.months % 12 === 0) return r.months === 12 ? "Anual" : `A cada ${r.months / 12} anos`;
      return `A cada ${r.months} meses`;
    case "window": {
      const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
      return `Entrega em ${r.months.map((m) => names[m - 1]).join(" e ")}`;
    }
    case "deadline":
      return `Prazo ${r.date.split("-").reverse().join("/")}`;
    case "continuous":
      return "Contínua";
  }
}

function addMonths(d: Date, months: number): Date {
  if (months < 1) return new Date(d.getTime() + Math.round(months * 30) * 86_400_000);
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

/**
 * Próximo prazo da obrigação. `lastDoneAt` é quando ela foi cumprida pela
 * última vez (informado na validação). Sem essa data, periodicidades "a cada
 * N meses" ficam sem prazo calculado.
 */
export function nextDue(r: Recurrence, lastDoneAt: Date | null, today = new Date()): Date | null {
  switch (r.kind) {
    case "every":
      return lastDoneAt ? addMonths(lastDoneAt, r.months) : null;
    case "window": {
      const ends: { start: Date; end: Date }[] = [];
      for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++) {
        for (const m of r.months) ends.push({ start: new Date(y, m - 1, 1), end: new Date(y, m, 0, 23, 59) });
      }
      ends.sort((a, b) => a.end.getTime() - b.end.getTime());
      // Janela mais recente já encerrada: se a última entrega é anterior a ela, está vencida.
      const lastClosed = [...ends].reverse().find((w) => w.end < today);
      if (lastDoneAt && lastClosed && lastDoneAt < lastClosed.start) return lastClosed.end;
      // Senão, o prazo é o fim da próxima janela ainda não cumprida.
      const next = ends.find((w) => w.end >= today && !(lastDoneAt && lastDoneAt >= w.start));
      return next?.end ?? null;
    }
    case "deadline":
      return new Date(`${r.date}T23:59:00`);
    case "continuous":
      return null;
  }
}

export interface ApplicableObligation {
  obligation: Obligation;
  norm: Norm;
  applies: Applicability;
  recurrence: Recurrence;
}

/** Obrigações do catálogo com a aplicabilidade calculada para a estrutura. */
export function obligationsFor(i: InstallationFacts): ApplicableObligation[] {
  return OBLIGATIONS.map((o) => ({
    obligation: o,
    norm: NORM_BY_ID.get(o.normId)!,
    applies: o.applies(i),
    recurrence: effectiveRecurrence(o, i),
  }));
}
