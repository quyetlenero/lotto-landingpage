export interface KnowledgeEntryInput {
  category: string;
  title: string;
  content: string;
  sortOrder: number;
}

export interface BrandPromptInput {
  name: string;
  systemPrompt: string;
  knowledgeEntries: KnowledgeEntryInput[];
}

const CATEGORY_ORDER = ["brand_story", "product", "faq", "policy", "escalation_rule"] as const;

const RESPONSE_RULES = `
Format rules:
- Write short paragraphs (1-3 sentences), no markdown headers or bullet lists — Messenger renders plain text.
- Reply in the same language the customer is using.
- Do not overuse emoji.
- Do not claim to be human if directly asked whether you are an AI — answer honestly, briefly, then continue helping.

Tool-use rule:
- When you call capture_lead or escalate_to_human, always also include a natural-language reply to
  the customer in the same turn. Never call a tool silently without a customer-facing message.
`.trim();

/**
 * Compiles a brand's system prompt deterministically so the rendered text is byte-identical
 * across requests for the same brand — required for prompt-cache hits. Never interpolate
 * timestamps or non-deterministic ordering here.
 */
export function compileBrandSystemPrompt(brand: BrandPromptInput): string {
  const sortedEntries = [...brand.knowledgeEntries].sort((a, b) => {
    const categoryDiff =
      CATEGORY_ORDER.indexOf(a.category as (typeof CATEGORY_ORDER)[number]) -
      CATEGORY_ORDER.indexOf(b.category as (typeof CATEGORY_ORDER)[number]);
    if (categoryDiff !== 0) return categoryDiff;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });

  const knowledgeBlock = CATEGORY_ORDER.map((category) => {
    const entries = sortedEntries.filter((e) => e.category === category);
    if (entries.length === 0) return null;
    const heading = categoryHeading(category);
    const body = entries.map((e) => `### ${e.title}\n${e.content}`).join("\n\n");
    return `## ${heading}\n${body}`;
  })
    .filter(Boolean)
    .join("\n\n");

  return [
    `You are the Messenger assistant for ${brand.name}.`,
    brand.systemPrompt.trim(),
    knowledgeBlock,
    RESPONSE_RULES,
  ]
    .filter((section) => section && section.length > 0)
    .join("\n\n");
}

function categoryHeading(category: string): string {
  switch (category) {
    case "brand_story":
      return "Brand story & voice";
    case "product":
      return "Products";
    case "faq":
      return "Frequently asked questions";
    case "policy":
      return "Policies";
    case "escalation_rule":
      return "Escalation rules";
    default:
      return category;
  }
}
