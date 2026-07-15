import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropicClient.js";

const TOOL_NAME = "generate_targeting_report";

const GENERATE_REPORT_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Record the weekly customer-insight report and ad-targeting recommendations for this brand.",
  input_schema: {
    type: "object",
    properties: {
      persona_summary: {
        type: "string",
        description: "Narrative synthesis of the dominant customer personas/segments seen this period.",
      },
      top_needs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            need: { type: "string" },
            frequency: { type: "integer" },
            example_quote: { type: "string" },
          },
          required: ["need", "frequency"],
          additionalProperties: false,
        },
      },
      top_pain_points: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pain_point: { type: "string" },
            frequency: { type: "integer" },
            example_quote: { type: "string" },
          },
          required: ["pain_point", "frequency"],
          additionalProperties: false,
        },
      },
      targeting_recommendations: {
        type: "array",
        description:
          "Ad-targeting recommendations using only parameters a human can set manually in Meta Ads Manager " +
          "(age range, gender, location, interest keywords) plus messaging/creative guidance.",
        items: {
          type: "object",
          properties: {
            segment_name: { type: "string" },
            age_range: { type: "string" },
            gender: { type: "string", enum: ["male", "female", "all"] },
            location_hints: { type: "array", items: { type: "string" } },
            interest_keywords: { type: "array", items: { type: "string" } },
            pain_points_to_address: { type: "array", items: { type: "string" } },
            messaging_angle: { type: "string" },
            creative_ideas: { type: "array", items: { type: "string" } },
          },
          required: ["segment_name", "messaging_angle"],
          additionalProperties: false,
        },
      },
      raw_report_markdown: {
        type: "string",
        description: "Full, human-readable report (markdown) combining all of the above for reading in the admin UI.",
      },
    },
    required: ["persona_summary", "top_needs", "top_pain_points", "targeting_recommendations", "raw_report_markdown"],
    additionalProperties: false,
  },
};

export interface FrequencyItem {
  value: string;
  count: number;
  exampleQuote?: string;
}

export interface AggregatedInsightStats {
  conversationsAnalyzed: number;
  periodStart: string;
  periodEnd: string;
  needsFrequency: FrequencyItem[];
  painPointsFrequency: FrequencyItem[];
  productInterestsFrequency: FrequencyItem[];
  sentimentDistribution: Record<string, number>;
  purchaseIntentDistribution: Record<string, number>;
  sampleQuotes: string[];
}

export interface GeneratedReport {
  persona_summary: string;
  top_needs: Array<{ need: string; frequency: number; example_quote?: string }>;
  top_pain_points: Array<{ pain_point: string; frequency: number; example_quote?: string }>;
  targeting_recommendations: Array<{
    segment_name: string;
    age_range?: string;
    gender?: "male" | "female" | "all";
    location_hints?: string[];
    interest_keywords?: string[];
    pain_points_to_address?: string[];
    messaging_angle: string;
    creative_ideas?: string[];
  }>;
  raw_report_markdown: string;
}

const SYSTEM_PROMPT = `You are a customer-insight and media-buying analyst. You'll be given aggregated statistics
(not raw transcripts) distilled from a brand's Messenger conversations over the past reporting period, plus
brand context. Synthesize them into a persona summary, ranked needs/pain points, and concrete ad-targeting
recommendations the brand's ads team can apply manually in Meta Ads Manager — only use targeting parameters
that platform actually supports (age range, gender, location, interest keywords), plus messaging/creative
guidance tied to the real pain points and needs you were given. Call ${TOOL_NAME} once with your analysis.`;

/**
 * One Claude call per brand per reporting period. Takes pre-aggregated stats (computed in
 * apps/worker/src/generateWeeklyReport.ts) rather than raw transcripts, so cost stays flat
 * regardless of how many conversations happened that week.
 */
export async function generateTargetingReport(
  brandName: string,
  brandStory: string,
  stats: AggregatedInsightStats,
  timeoutMs: number,
): Promise<GeneratedReport> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create(
    {
      model: process.env.CLAUDE_REPORT_MODEL ?? "claude-sonnet-5",
      max_tokens: 4096,
      thinking: { type: "disabled" },
      tools: [GENERATE_REPORT_TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      system: `Brand: ${brandName}\nBrand story: ${brandStory}\n\n${SYSTEM_PROMPT}`,
      messages: [{ role: "user", content: `Aggregated stats:\n\n${JSON.stringify(stats, null, 2)}` }],
    },
    { timeout: timeoutMs },
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
  );
  if (!toolUse) {
    throw new Error("Claude did not return the expected generate_targeting_report tool call");
  }

  return toolUse.input as GeneratedReport;
}
