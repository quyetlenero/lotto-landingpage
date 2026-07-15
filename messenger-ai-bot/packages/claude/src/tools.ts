import type Anthropic from "@anthropic-ai/sdk";

/**
 * Structured events the model signals back to the backend instead of free-text the
 * worker would otherwise have to regex-parse. Keep this array's contents and order
 * byte-identical across requests for the same brand — it's part of the cached prefix.
 */
export const MESSENGER_TOOLS: Anthropic.Tool[] = [
  {
    name: "capture_lead",
    description:
      "Call this as soon as the customer shares a phone number, or when they show clear " +
      "buying intent and a phone number is already known from earlier in the conversation. " +
      "This notifies the sales team to follow up — call it even if you don't yet know every field. " +
      "Always also include a natural-language reply to the customer in the same turn.",
    input_schema: {
      type: "object",
      properties: {
        phone_number: {
          type: "string",
          description: "Customer phone number as given, digits and separators preserved",
        },
        customer_name: { type: "string" },
        need_summary: {
          type: "string",
          description: "1-3 sentence summary of what the customer wants, in the conversation's language",
        },
        product_interest: { type: "string" },
        urgency: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["phone_number", "need_summary", "urgency"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Call this when the customer is angry or frustrated, explicitly asks for a human/staff " +
      "member, raises a complex complaint, or the situation is outside what you should resolve " +
      "alone. This immediately alerts a human team member. Always also include a natural-language " +
      "reply to the customer in the same turn (e.g. acknowledging you're bringing in a colleague).",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "angry_customer",
            "explicit_human_request",
            "complex_complaint",
            "policy_or_refund_dispute",
            "other",
          ],
        },
        conversation_summary: { type: "string" },
        severity: { type: "string", enum: ["normal", "urgent"] },
      },
      required: ["reason", "conversation_summary", "severity"],
      additionalProperties: false,
    },
  },
];

export interface CaptureLeadInput {
  phone_number: string;
  customer_name?: string;
  need_summary: string;
  product_interest?: string;
  urgency: "low" | "medium" | "high";
}

export interface EscalateToHumanInput {
  reason:
    | "angry_customer"
    | "explicit_human_request"
    | "complex_complaint"
    | "policy_or_refund_dispute"
    | "other";
  conversation_summary: string;
  severity: "normal" | "urgent";
}
