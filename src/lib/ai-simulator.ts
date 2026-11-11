import type {
  DocumentFile,
  EvidenceRobustness,
  FinalClassification,
  GapCriticality,
  InfoSufficiency,
  Requirement,
} from "@prisma/client";
import { POST_FAILURE_ONLY, defaultCriticality } from "@/lib/assessment-rubric";

/**
 * Simulador da camada de "leitura inteligente de evidências" descrita na
 * proposta GISTM Compass. Não chama nenhum modelo de IA real — produz uma
 * sugestão de classificação determinística e explicável a partir de uma
 * heurística de sobreposição de palavras-chave entre o requisito e os
 * documentos com texto lido. É determinística e conservadora (régua em
 * `assessment-rubric.ts`): nunca sugere "Atende" sozinha.
 *
 * A interface de saída (classificação, robustez, criticidade, justificativa,
 * confiança, trechos de evidência) é a mesma que uma integração real com a
 * API da Anthropic deveria produzir, para que a troca por IA real no futuro
 * não exija mudanças na camada de revisão humana.
 */

const STOPWORDS = new Set([
  "de","da","do","das","dos","e","a","o","as","os","em","para","com","por",
  "que","um","uma","no","nas","nos","na","ao","aos","é","ser","como","seu",
  "sua","seus","suas","ou","se","não","mais","item",
  // inglês: a maior parte dos documentos técnicos chega em inglês
  "the","and","for","with","that","this","from","shall","will","have","been",
  "their","which","into","such","other","where","when","should","must","also",
  "than","each","over","under","them","they","these","those","within",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

// Limiares da leitura por palavras-chave (fração dos termos do requisito
// encontrados no melhor documento). Calibrados com uma base real de 178
// documentos auditada por especialistas: a contagem de palavras não separa
// bem "parcial" de "não atende" (o texto do requisito está em português e os
// documentos costumam estar em inglês), então a heurística segue a régua —
// havendo documento relacionado, sugere "Parcial"; "Não atende" só quando
// quase nada do requisito aparece na base.
const HEURISTIC_PARTIAL = 0.15;
const HEURISTIC_WEAK = 0.04;

/** Trecho de ~240 caracteres onde mais termos do requisito aparecem. */
function bestExcerpt(text: string, tokens: Set<string>): string {
  const flat = text.replace(/\s+/g, " ");
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.max(1, flat.length - 240); i += 120) {
    let sc = 0;
    for (const w of tokenize(flat.slice(i, i + 240))) if (tokens.has(w)) sc++;
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  const piece = flat.slice(best, best + 240).trim();
  return (best > 0 ? "…" : "") + piece + (best + 240 < flat.length ? "…" : "");
}

export function overlapScore(requirementTokens: Set<string>, documentText: string): number {
  if (requirementTokens.size === 0) return 0;
  const docTokens = tokenize(documentText);
  if (docTokens.size === 0) return 0;
  let matches = 0;
  for (const token of requirementTokens) {
    if (docTokens.has(token)) matches++;
  }
  return matches / requirementTokens.size;
}

export interface AiEvidenceSuggestion {
  documentId: string;
  excerpt: string;
}

export interface AiSuggestion {
  classification: FinalClassification;
  robustness: EvidenceRobustness;
  criticality: GapCriticality;
  infoSufficiency: InfoSufficiency;
  justification: string;
  confidence: number;
  evidences: AiEvidenceSuggestion[];
}

// Povos indígenas não identificados (requisito 1.2): frases típicas de
// estudos socioambientais em inglês e português.
const NO_INDIGENOUS =
  /\bno\s+(?:IPs|indigenous\s+(?:peoples?|communities))\s+(?:have\s+been|were|was|has\s+been)\s+identified|n[ãa]o\s+(?:foram|h[áa])\s+(?:identificad[oa]s\s+)?povos\s+ind[íi]genas/i;

export function simulateAiReading(
  requirement: Pick<Requirement, "code" | "title" | "description"> & { descriptionEn?: string | null },
  documents: Pick<DocumentFile, "id" | "title" | "extractedText">[]
): AiSuggestion {
  const requirementTokens = tokenize(
    `${requirement.title} ${requirement.description} ${requirement.descriptionEn ?? ""}`
  );

  // Regra de aplicabilidade da régua: requisitos de recuperação pós-falha.
  if (POST_FAILURE_ONLY.includes(requirement.code)) {
    return {
      classification: "NAO_SE_APLICA",
      robustness: "AUSENTE",
      criticality: "NAO_SE_APLICA",
      infoSufficiency: "SUFICIENTE",
      confidence: 0.9,
      justification:
        "Requisito de recuperação pós-falha: só se aplica depois de uma falha catastrófica. " +
        "Confirme na validação se não houve falha.",
      evidences: [],
    };
  }

  // Só documentos com texto lido contam: um PDF escaneado sem texto não pode
  // ser citado como evidência (antes o título entrava no lugar do conteúdo).
  const readable = documents.filter((d) => (d.extractedText ?? "").trim().length > 0);

  if (requirement.code === "1.2") {
    const doc = readable.find((d) => NO_INDIGENOUS.test(d.extractedText!));
    if (doc) {
      const m = doc.extractedText!.match(NO_INDIGENOUS)!;
      const at = Math.max(0, (m.index ?? 0) - 120);
      return {
        classification: "NAO_SE_APLICA",
        robustness: "PARCIAL",
        criticality: "NAO_SE_APLICA",
        infoSufficiency: "SUFICIENTE",
        confidence: 0.7,
        justification:
          `"${doc.title}" registra que não foram identificados povos indígenas na área de influência. ` +
          "Sugestão: \"Não se aplica\". Confirme na validação.",
        evidences: [{ documentId: doc.id, excerpt: "…" + doc.extractedText!.slice(at, at + 260).replace(/\s+/g, " ") + "…" }],
      };
    }
  }

  if (readable.length === 0) {
    return {
      classification: "NAO_ATENDE",
      robustness: "AUSENTE",
      criticality: defaultCriticality(requirement.code, "NAO_ATENDE"),
      infoSufficiency: "INSUFICIENTE",
      confidence: 0.3,
      justification:
        "Nenhum documento com texto legível na base documental. " +
        "Sugestão: \"Não atende\" até que a documentação seja anexada e revisada por um especialista.",
      evidences: [],
    };
  }

  const scored = readable.map((doc) => ({ doc, score: overlapScore(requirementTokens, doc.extractedText!) }));

  // Leitura por palavras-chave, sem componente aleatório. Com a régua de
  // rigor, ela nunca sugere "Atende": isso exige confirmar aprovação formal
  // e aplicação na prática, o que só a leitura do documento (IA ou revisor) faz.
  const combined = Math.max(...scored.map((s) => s.score));

  let classification: FinalClassification;
  let robustness: EvidenceRobustness;

  if (combined >= HEURISTIC_PARTIAL) {
    classification = "ATENDE_PARCIALMENTE";
    robustness = "PARCIAL";
  } else if (combined >= HEURISTIC_WEAK) {
    classification = "ATENDE_PARCIALMENTE";
    robustness = "FRACA";
  } else {
    classification = "NAO_ATENDE";
    robustness = "AUSENTE";
  }
  // Criticidade pelo assunto do requisito: antes quase toda lacuna saía "Alta".
  const criticality: GapCriticality = defaultCriticality(requirement.code, classification);

  const confidence = Math.round((0.35 + combined * 0.55) * 100) / 100;
  const infoSufficiency: InfoSufficiency = robustness === "AUSENTE" ? "INSUFICIENTE" : "SUFICIENTE";

  // A justificativa cita só os documentos que de fato pesaram na sugestão
  // (mesmo critério usado para as evidências abaixo) — listar os N documentos
  // da base inteira, mesmo os sem nenhuma sobreposição textual, virava uma
  // parede de nomes de arquivo sem informação real quando a instalação tinha
  // muitos documentos cadastrados.
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const topMatches = ranked.filter((s) => s.score > 0).slice(0, 3);
  const relevantDocsText =
    topMatches.length > 0
      ? topMatches.map((s) => `"${s.doc.title}"`).join(", ")
      : "nenhum documento com correspondência textual relevante";

  const justification =
    `A leitura automática por palavras-chave comparou este requisito com os ` +
    `${readable.length} documento(s) com texto da base documental. Os mais ` +
    `relevantes encontrados foram: ${relevantDocsText}. Classificação sugerida: "${classificationLabel(classification)}", com ` +
    `robustez de evidência "${robustnessLabel(robustness)}". Esta sugestão deve ser ` +
    `confirmada, ajustada ou rejeitada por um revisor técnico antes da validação final.`;

  const evidences: AiEvidenceSuggestion[] = topMatches.map(({ doc }) => ({
    documentId: doc.id,
    excerpt: bestExcerpt(doc.extractedText!, requirementTokens),
  }));

  return {
    classification,
    robustness,
    criticality,
    infoSufficiency,
    confidence,
    justification,
    evidences,
  };
}

export function infoSufficiencyLabel(value: InfoSufficiency | null | undefined): string {
  switch (value) {
    case "SUFICIENTE":
      return "Informação suficiente";
    case "INSUFICIENTE":
      return "Informação insuficiente";
    default:
      return "—";
  }
}

export function classificationLabel(value: FinalClassification | null | undefined): string {
  switch (value) {
    case "ATENDE_TOTALMENTE":
      return "Atende totalmente";
    case "ATENDE_PARCIALMENTE":
      return "Atende parcialmente";
    case "NAO_ATENDE":
      return "Não atende";
    case "NAO_SE_APLICA":
      return "Não se aplica";
    default:
      return "Não avaliado";
  }
}

export function robustnessLabel(value: EvidenceRobustness | null | undefined): string {
  switch (value) {
    case "ROBUSTA":
      return "Robusta";
    case "PARCIAL":
      return "Parcial";
    case "FRACA":
      return "Fraca";
    case "AUSENTE":
      return "Ausente";
    default:
      return "—";
  }
}

export function criticalityLabel(value: GapCriticality | null | undefined): string {
  switch (value) {
    case "ALTA":
      return "Alta";
    case "MEDIA":
      return "Média";
    case "BAIXA":
      return "Baixa";
    case "NAO_SE_APLICA":
      return "Não se aplica";
    default:
      return "—";
  }
}
