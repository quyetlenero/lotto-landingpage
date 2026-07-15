import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/** Singleton Anthropic client shared by the chat-reply, insight-extraction, and
 * report-generation call sites — avoids each one re-reading env vars / constructing
 * its own instance. */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}
