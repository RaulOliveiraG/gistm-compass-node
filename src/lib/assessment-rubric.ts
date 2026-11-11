import type { FinalClassification } from "@prisma/client";

// Régua de avaliação usada pela IA, pela heurística e pelo ícone "i".
// Calibrada contra uma Gap Analysis real feita por especialistas (218 itens).

export const CLASSIFICATION_RULES: Record<FinalClassification, string> = {
  ATENDE_TOTALMENTE:
    "Há evidência de que o critério está implantado: documento da estrutura, ou política/código do " +
    "grupo que se aplica expressamente à operação; nomeação formal registrada em qualquer documento " +
    "oficial (carta, contrato, relatório); estudo ou revisão feito por profissional qualificado e " +
    "emitido (inclusive revisões \"para aprovação\" ou \"para informação\"); e registro de que é aplicado.",
  ATENDE_PARCIALMENTE:
    "Existe algo, mas não fecha o critério: cobre só parte dele; está desatualizado; não é específico " +
    "da estrutura quando o critério pede isso; os critérios técnicos não são cumpridos (ex.: fator de " +
    "segurança abaixo do mínimo); há recomendações abertas de um revisor; o documento de base não foi " +
    "fornecido e só aparece citado em relatórios do grupo; ou está planejado/em andamento.",
  NAO_ATENDE:
    "O elemento específico que o critério exige não existe, mesmo que haja documentos sobre o tema. " +
    "Ex.: ITRB ou revisor sênior independente não nomeado; aprovação ou decisão do Executivo " +
    "Responsável sem registro; avaliação nunca feita (ex.: mudanças climáticas); registro inexistente.",
  NAO_SE_APLICA:
    "O critério depende de uma condição que não ocorre na estrutura (ex.: \"se for adotada a opção " +
    "B.2\", recuperação pós-falha sem falha, povos indígenas não identificados).",
};

export const APPLICABILITY_RULES = [
  "Avalie a aplicabilidade item a item: um item condicional cuja condição não ocorre é \"Não se aplica\" " +
    "e não entra na consolidação do requisito.",
  "Requisitos de recuperação pós-falha (14.2 a 14.5) só se aplicam depois de uma falha catastrófica; " +
    "se não houve falha, são \"Não se aplica\".",
  "Requisitos sobre povos indígenas (1.2) são \"Não se aplica\" quando os estudos da estrutura não " +
    "identificam povos indígenas ou tribais afetados.",
  "Requisitos escritos \"para estruturas novas\" também valem para alteamentos, expansões e novas " +
    "etapas em projeto ou em execução numa estrutura existente; só são \"Não se aplica\" se não houver " +
    "nova etapa prevista.",
  "Requisitos escritos \"para estruturas existentes\" não se aplicam a estrutura nova ainda não construída.",
];

export const EVIDENCE_RULES = [
  "Documento que apenas repete ou explica o texto do GISTM, ou uma autoavaliação de conformidade, não é " +
    "evidência de atendimento.",
  "Relatórios de revisão técnica (EoR, DSR, inspeções, auditorias) valem como evidência do que existe e, " +
    "quando apontam lacunas ou recomendações abertas, indicam atendimento parcial daquele ponto.",
  "Política, código de conduta, canal de denúncia ou processo de RH do grupo que se aplica expressamente " +
    "à operação conta como atendimento em critérios de governança e ética. Em critérios técnicos " +
    "(projeto, monitoramento, plano de emergência) é preciso documento da estrutura.",
  "Função descrita em manual (ex.: OMS) sem carta de nomeação, contrato ou registro de atuação é " +
    "atendimento parcial.",
  "Uma revisão independente pontual (ex.: revisão de projeto por terceiro) não equivale a ITRB nem a " +
    "revisor sênior independente contínuo.",
  "Quando o critério exige aprovação, decisão ou confirmação do Executivo Responsável e ela não está " +
    "registrada, aquele item é \"Não atende\".",
  "Na dúvida entre \"Parcial\" e \"Não atende\", prefira \"Parcial\" se houver qualquer elemento do " +
    "critério implantado; \"Não atende\" é para ausência do elemento exigido.",
];

export const CRITICALITY_RULES = {
  ALTA:
    "A lacuna afeta controles de segurança física da estrutura (modos de falha, projeto, construção, " +
    "operação, monitoramento, resposta a emergência) ou é falta de revisão independente/EoR numa " +
    "estrutura de consequência Muito Alta ou Extrema. Prazo sugerido: 30 dias.",
  MEDIA:
    "Lacuna de governança, documentação ou engajamento com impacto indireto na segurança. Prazo sugerido: 90 dias.",
  BAIXA: "Lacuna formal ou administrativa, sem efeito direto na segurança. Prazo sugerido: 180 dias.",
} as const;

/**
 * Princípios cujo assunto é o controle físico da estrutura (base de
 * conhecimento de ruptura, projeto, construção/operação, monitoramento,
 * emergência). Lacunas neles tendem a ser de criticidade alta.
 */
export const SAFETY_PRINCIPLES = new Set([4, 5, 6, 7, 13]);

/** Criticidade padrão de uma lacuna quando não há leitura detalhada. */
export function defaultCriticality(
  code: string,
  classification: FinalClassification
): "ALTA" | "MEDIA" | "BAIXA" | "NAO_SE_APLICA" {
  if (classification === "ATENDE_TOTALMENTE" || classification === "NAO_SE_APLICA") return "NAO_SE_APLICA";
  const principle = Number(code.split(".")[0]);
  if (SAFETY_PRINCIPLES.has(principle) || code === "2.3") return classification === "NAO_ATENDE" ? "ALTA" : "MEDIA";
  return classification === "NAO_ATENDE" ? "MEDIA" : "BAIXA";
}

/** Requisitos que só se aplicam depois de uma falha catastrófica. */
export const POST_FAILURE_ONLY = ["14.2", "14.3", "14.4", "14.5"];

/**
 * Consolida a avaliação item a item (a, b, c…) no resultado do requisito:
 * todos "Não se aplica" → Não se aplica; todos os aplicáveis "Atende" →
 * Atende; todos os aplicáveis "Não atende" → Não atende; qualquer mistura → Parcial.
 */
export function aggregateItems(items: FinalClassification[]): FinalClassification | null {
  if (items.length === 0) return null;
  const applicable = items.filter((c) => c !== "NAO_SE_APLICA");
  if (applicable.length === 0) return "NAO_SE_APLICA";
  if (applicable.every((c) => c === "ATENDE_TOTALMENTE")) return "ATENDE_TOTALMENTE";
  if (applicable.every((c) => c === "NAO_ATENDE")) return "NAO_ATENDE";
  return "ATENDE_PARCIALMENTE";
}

/** Texto da régua para a instrução da IA. */
export function rubricPrompt(): string {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return (
    `CRITÉRIOS DE ATENDIMENTO (aplique a cada item a, b, c…):\n` +
    `- ATENDE_TOTALMENTE: ${CLASSIFICATION_RULES.ATENDE_TOTALMENTE}\n` +
    `- ATENDE_PARCIALMENTE: ${CLASSIFICATION_RULES.ATENDE_PARCIALMENTE}\n` +
    `- NAO_ATENDE: ${CLASSIFICATION_RULES.NAO_ATENDE}\n` +
    `- NAO_SE_APLICA: ${CLASSIFICATION_RULES.NAO_SE_APLICA}\n\n` +
    `REGRAS DE APLICABILIDADE:\n${list(APPLICABILITY_RULES)}\n\n` +
    `COMO PESAR A EVIDÊNCIA:\n${list(EVIDENCE_RULES)}\n\n` +
    `CRITICIDADE DA LACUNA:\n` +
    `- ALTA: ${CRITICALITY_RULES.ALTA}\n` +
    `- MEDIA: ${CRITICALITY_RULES.MEDIA}\n` +
    `- BAIXA: ${CRITICALITY_RULES.BAIXA}\n` +
    `- NAO_SE_APLICA: só quando a classificação for ATENDE_TOTALMENTE ou NAO_SE_APLICA.`
  );
}
