import { prisma } from "@/lib/prisma";
import { runDocumentAgent, AiAgentNotConfiguredError } from "@/lib/ai-agent";

/**
 * Assistente de perguntas e respostas sobre a base documental de uma instalação.
 *
 * Reescrito sobre o núcleo agêntico (`ai-agent.ts`): em vez de receber só os 6
 * trechos mais parecidos com a pergunta (RAG de trecho único), a IA agora tem
 * acesso a TODA a base documental através de ferramentas e conduz o raciocínio:
 * identifica quais documentos importam, consulta o conteúdo necessário, abre
 * outras partes quando precisa de contexto, cruza informações entre documentos,
 * checa conflitos/complementos e só então responde considerando o conjunto
 * completo — sem se limitar ao que a busca devolveu de primeira.
 */

export class ChatNotConfiguredError extends Error {}

export interface ChatSource {
  documentId: string;
  title: string;
  type: string;
}

export interface ChatAnswer {
  answer: string;
  sources: ChatSource[];
}

export async function answerQuestionAboutInstallation(
  installationId: string,
  question: string
): Promise<ChatAnswer> {
  const installation = await prisma.installation.findUniqueOrThrow({
    where: { id: installationId },
  });

  const system =
    `Você é o assistente do GISTM Compass, respondendo perguntas sobre a instalação ` +
    `"${installation.name}" com base na base documental dela. Você tem ferramentas para ` +
    `consultar essa base — use-as antes de responder.\n\n` +
    `COMO TRABALHAR:\n` +
    `1. Comece com listar_documentos para saber o que existe.\n` +
    `2. Use buscar para localizar rapidamente onde a informação pode estar.\n` +
    `3. Use ler_documento para ler o conteúdo integral quando a resposta depender do ` +
    `contexto completo — não se limite ao trecho da busca.\n` +
    `4. Cruze informações entre documentos e verifique se há dados conflitantes ou complementares.\n\n` +
    `REGRAS:\n` +
    `- Responda sempre em português, de forma direta e técnica.\n` +
    `- Baseie a resposta no conteúdo real dos documentos; não invente.\n` +
    `- Cite a fonte: diga em qual documento (e, se possível, em que seção/página) está a informação, ` +
    `pelo título do documento. Não mostre o id interno do documento.\n` +
    `- Texto simples: no máximo **negrito** e listas com "- ". Sem tabelas nem títulos com #.\n` +
    `- NÃO conclua que algo "não existe" só porque a primeira busca não achou. Antes de afirmar ` +
    `que não encontrou, verifique documentos relacionados, tente termos equivalentes e considere ` +
    `referências cruzadas. Só então diga que não localizou — e diga onde procurou.`;

  const userPrompt = `Pergunta sobre a instalação "${installation.name}":\n\n${question}`;

  try {
    const result = await runDocumentAgent(installationId, system, userPrompt, { maxTokens: 2048 });
    return {
      answer:
        result.answer ||
        "Não consegui gerar uma resposta a partir dos documentos disponíveis.",
      sources: result.sources,
    };
  } catch (err) {
    if (err instanceof AiAgentNotConfiguredError) {
      throw new ChatNotConfiguredError(err.message);
    }
    throw err;
  }
}
