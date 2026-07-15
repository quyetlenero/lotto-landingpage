import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropicClient.js";

const TOOL_NAME = "extract_conversation_insight";

/**
 * Separate from MESSENGER_TOOLS/tools.ts on purpose — this runs as its own Claude call
 * (apps/worker/src/insightExtraction.ts, once per idle conversation), not on every chat
 * reply turn, so it doesn't share — or risk invalidating — the chat system-prompt's cache.
 */
const EXTRACT_INSIGHT_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record the structured customer-insight analysis of this Messenger conversation transcript.",
  input_schema: {
    type: "object",
    properties: {
      persona_summary: {
        type: "string",
        description: "1-2 sentence description of who this customer seems to be (role, style, likely age bracket).",
      },
      age_range_guess: { type: "string", description: "e.g. '18-24', '25-34' — omit if there's no signal." },
      gender_guess: { type: "string", enum: ["male", "female", "unknown"] },
      location_guess: { type: "string", description: "City/region mentioned or implied, if any." },
      needs: { type: "array", items: { type: "string" }, description: "What the customer is trying to get done." },
      pain_points: { type: "array", items: { type: "string" } },
      objections: { type: "array", items: { type: "string" }, description: "Reasons they hesitated or pushed back." },
      product_interests: { type: "array", items: { type: "string" } },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative", "frustrated"] },
      purchase_intent: { type: "string", enum: ["low", "medium", "high"] },
      drop_off_reason: {
        type: "string",
        description: "Why the customer seems to have left without converting, if applicable.",
      },
      quote_highlights: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to 3 short, representative verbatim quotes from the customer. Never include phone numbers, " +
          "full names, or other personally identifying details — paraphrase around them if needed.",
      },
    },
    required: ["persona_summary", "needs", "pain_points", "sentiment", "purchase_intent", "quote_highlights"],
    additionalProperties: false,
  },
};

export interface ExtractedInsight {
  persona_summary: string;
  age_range_guess?: string;
  gender_guess?: "male" | "female" | "unknown";
  location_guess?: string;
  needs: string[];
  pain_points: string[];
  objections?: string[];
  product_interests?: string[];
  sentiment: "positive" | "neutral" | "negative" | "frustrated";
  purchase_intent: "low" | "medium" | "high";
  drop_off_reason?: string;
  quote_highlights: string[];
}

const SYSTEM_PROMPT = `You are a customer-experience analyst reviewing a transcript of one customer's Messenger
conversation with a brand's support/sales assistant. Read the full transcript and call the
${TOOL_NAME} tool once with your analysis. Be concrete and specific — avoid generic filler like
"customer wants good service." Base every field only on what's actually in the transcript; leave
optional fields out rather than guessing without any signal. Never include phone numbers, full
names, or other personally identifying details in quote_highlights.`;

/**
 * Runs a single, non-latency-sensitive Claude call to distill one conversation transcript into
 * structured insight. Forces tool use so the result is always well-formed (no free-text parsing).
 */
export async function extractConversationInsight(
  brandName: string,
  transcript: string,
  timeoutMs: number,
): Promise<ExtractedInsight> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create(
    {
      model: process.env.CLAUDE_INSIGHT_MODEL ?? "claude-sonnet-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      tools: [EXTRACT_INSIGHT_TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      system: `Brand: ${brandName}\n\n${SYSTEM_PROMPT}`,
      messages: [{ role: "user", content: `Transcript:\n\n${transcript}` }],
    },
    { timeout: timeoutMs },
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error("Claude did not return the expected extract_conversation_insight tool call");
  }

  return toolUse.input as ExtractedInsight;
}
