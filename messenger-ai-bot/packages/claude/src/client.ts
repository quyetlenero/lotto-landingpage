import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "./anthropicClient.js";
import { MESSENGER_TOOLS } from "./tools.js";

export interface ReplyRequest {
  systemPrompt: string;
  /** Prior conversation, oldest first, as raw Anthropic content blocks. */
  history: Anthropic.MessageParam[];
  primaryModel: string;
  fallbackModel: string;
  timeoutMs: number;
}

export interface ReplyResult {
  response: Anthropic.Message;
  modelUsed: string;
  usedFallback: boolean;
}

/**
 * Calls Claude for one Messenger turn. Disables extended thinking and caps max_tokens —
 * this is a latency-sensitive chat reply, not a reasoning task. Falls back to a faster/
 * cheaper model once on timeout or error so the customer never waits indefinitely; the
 * worker's caller is responsible for a final canned-reply fallback if both attempts fail.
 */
export async function generateReply(req: ReplyRequest): Promise<ReplyResult> {
  const anthropic = getAnthropicClient();

  const request = (model: string): Promise<Anthropic.Message> =>
    anthropic.messages.create(
      {
        model,
        max_tokens: 1024,
        thinking: { type: "disabled" },
        tools: MESSENGER_TOOLS,
        system: [
          {
            type: "text",
            text: req.systemPrompt,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        messages: req.history,
      },
      { timeout: req.timeoutMs },
    );

  try {
    const response = await request(req.primaryModel);
    return { response, modelUsed: req.primaryModel, usedFallback: false };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[claude] primary model ${req.primaryModel} failed, falling back`, err);
    const response = await request(req.fallbackModel);
    return { response, modelUsed: req.fallbackModel, usedFallback: true };
  }
}

export * from "./tools.js";
export * from "./promptCompiler.js";
