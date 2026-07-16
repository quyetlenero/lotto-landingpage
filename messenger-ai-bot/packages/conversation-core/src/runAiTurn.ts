import type Anthropic from "@anthropic-ai/sdk";
import { getPrismaClient, ConversationStatus } from "@messenger-bot/db";
import type { Message as DbMessage } from "@messenger-bot/db";
import {
  generateReply,
  compileBrandSystemPrompt,
  type ChatChannel,
  type CaptureLeadInput,
  type EscalateToHumanInput,
} from "@messenger-bot/claude";
import { dispatchNotification } from "./notify/dispatch.js";
import { isWithinBusinessHours } from "./businessHours.js";

const MAX_HISTORY_MESSAGES = 20;
const CANNED_FALLBACK_REPLY =
  "Cảm ơn bạn đã nhắn tin! Chúng tôi đã nhận được tin nhắn và sẽ phản hồi sớm nhất có thể.";

const CHANNEL_LABEL: Record<ChatChannel, string> = {
  messenger: "Facebook Messenger",
  web: "Website",
};

export interface RunAiTurnBrand {
  id: string;
  name: string;
  systemPrompt: string;
  claudeModel: string;
  telegramChatId: string | null;
  notificationEmails: string[];
  businessHours: unknown;
}

export interface RunAiTurnKnowledgeEntry {
  category: string;
  title: string;
  content: string;
  sortOrder: number;
}

export interface RunAiTurnArgs {
  conversationId: string;
  brand: RunAiTurnBrand;
  knowledgeEntries: RunAiTurnKnowledgeEntry[];
  receivedAt: Date;
  channel: ChatChannel;
  /**
   * Delivers the reply to the customer. Called as soon as text is available, BEFORE the
   * assistant Message row / tool_result / capture_lead / escalate_to_human side effects are
   * persisted — preserves the "send first, persist after" latency optimization for every
   * channel. For Facebook Messenger this calls the Send API; for the website widget it's a
   * no-op that just captures the text for the synchronous HTTP response.
   */
  deliver: (replyText: string) => Promise<{ externalMessageId?: string }>;
}

export interface RunAiTurnResult {
  replyText: string;
  usedFallback: boolean;
  assistantMessageId: string;
}

/**
 * Channel-agnostic core of one AI reply turn: load history, compile the brand's system
 * prompt, call Claude, deliver the reply, persist everything, and dispatch capture_lead /
 * escalate_to_human tool calls. Shared by the Facebook Messenger worker
 * (apps/worker/src/processMessage.ts) and the website chat route
 * (apps/webhook/src/routes/website.ts) — those callers own everything channel-specific
 * (page/brand lookup, echo/human-mute handling, actual message delivery).
 */
export async function runAiTurn(args: RunAiTurnArgs): Promise<RunAiTurnResult> {
  const prisma = getPrismaClient();
  const channelLabel = CHANNEL_LABEL[args.channel];

  const history = await loadHistory(args.conversationId);
  const systemPrompt = compileBrandSystemPrompt({
    name: args.brand.name,
    systemPrompt: args.brand.systemPrompt,
    knowledgeEntries: args.knowledgeEntries,
    channel: args.channel,
  });

  let assistantContent: Anthropic.ContentBlock[];
  let usedFallback = false;
  try {
    const generated = await generateReply({
      systemPrompt,
      history,
      primaryModel: args.brand.claudeModel,
      fallbackModel: process.env.CLAUDE_FALLBACK_MODEL ?? "claude-haiku-4-5",
      timeoutMs: Number(process.env.CLAUDE_REQUEST_TIMEOUT_MS ?? 8000),
    });
    assistantContent = generated.response.content;
    usedFallback = generated.usedFallback;
  } catch (err) {
    console.error(
      `[conversation-core] Claude call failed for conversation ${args.conversationId}, using canned reply`,
      err,
    );
    const delivered = await args.deliver(CANNED_FALLBACK_REPLY);
    const repliedAt = new Date();
    const canned = await prisma.message.create({
      data: {
        conversationId: args.conversationId,
        role: "assistant",
        content: [{ type: "text", text: CANNED_FALLBACK_REPLY }],
        fbMessageId: delivered.externalMessageId,
        repliedAt,
        latencyMs: repliedAt.getTime() - args.receivedAt.getTime(),
      },
    });
    return { replyText: CANNED_FALLBACK_REPLY, usedFallback: true, assistantMessageId: canned.id };
  }

  const replyText = assistantContent
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  const finalReplyText = replyText || CANNED_FALLBACK_REPLY;

  // Deliver to the customer first — everything below (DB writes, notifications) can happen
  // after they already have their reply.
  const delivered = await args.deliver(finalReplyText);
  const repliedAt = new Date();

  const assistantMessage = await prisma.message.create({
    data: {
      conversationId: args.conversationId,
      role: "assistant",
      content: assistantContent as unknown as object,
      fbMessageId: delivered.externalMessageId,
      repliedAt,
      latencyMs: repliedAt.getTime() - args.receivedAt.getTime(),
    },
  });

  const toolUseBlocks = assistantContent.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  if (toolUseBlocks.length > 0) {
    // Anthropic requires every tool_use to be followed by a matching tool_result before the
    // next assistant turn — persist synthetic results now so future history reconstruction
    // stays API-valid without a second live round-trip to Claude.
    await prisma.message.create({
      data: {
        conversationId: args.conversationId,
        role: "tool_result",
        content: toolUseBlocks.map((block) => ({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Recorded.",
        })) as unknown as object,
      },
    });

    for (const block of toolUseBlocks) {
      if (block.name === "capture_lead") {
        await handleCaptureLead(block.input as CaptureLeadInput, args.conversationId, args.brand, channelLabel);
      } else if (block.name === "escalate_to_human") {
        await handleEscalation(block.input as EscalateToHumanInput, args.conversationId, args.brand, channelLabel);
      }
    }
  }

  return { replyText: finalReplyText, usedFallback, assistantMessageId: assistantMessage.id };
}

async function loadHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY_MESSAGES,
  });
  return rows.reverse().map(dbMessageToAnthropicParam);
}

function dbMessageToAnthropicParam(row: DbMessage): Anthropic.MessageParam {
  // tool_result blocks must travel back to the API as role "user".
  const role = row.role === "assistant" ? "assistant" : "user";
  return { role, content: row.content as unknown as Anthropic.MessageParam["content"] };
}

async function handleCaptureLead(
  input: CaptureLeadInput,
  conversationId: string,
  brand: RunAiTurnBrand,
  channelLabel: string,
): Promise<void> {
  const prisma = getPrismaClient();

  const lead = await prisma.lead.create({
    data: {
      conversationId,
      brandId: brand.id,
      phoneNumber: input.phone_number,
      customerName: input.customer_name,
      needSummary: input.need_summary,
      productInterest: input.product_interest,
      urgency: input.urgency,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: ConversationStatus.lead_captured },
  });

  const message = [
    `🟢 *New lead — ${brand.name} (${channelLabel})*`,
    `📞 ${input.phone_number}`,
    `👤 ${input.customer_name ?? "unknown"}`,
    `📝 ${input.need_summary}`,
    `Urgency: ${input.urgency}`,
  ].join("\n");

  await dispatchNotification({
    type: "lead",
    refId: lead.id,
    telegramChatId: brand.telegramChatId,
    emailRecipients: brand.notificationEmails,
    subject: `Lead mới - ${brand.name} (${channelLabel})`,
    message,
  });

  await prisma.lead.update({ where: { id: lead.id }, data: { notifiedAt: new Date() } });
}

async function handleEscalation(
  input: EscalateToHumanInput,
  conversationId: string,
  brand: RunAiTurnBrand,
  channelLabel: string,
): Promise<void> {
  const prisma = getPrismaClient();
  const now = new Date();
  const duringBusinessHours = isWithinBusinessHours(brand.businessHours, now);

  const escalation = await prisma.escalation.create({
    data: {
      conversationId,
      brandId: brand.id,
      reason: input.reason,
      severity: input.severity,
      conversationSummary: input.conversation_summary,
      duringBusinessHours,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: ConversationStatus.escalated },
  });

  const urgencyTag = input.severity === "urgent" ? "🔴 URGENT" : "🟡";
  const message = [
    `${urgencyTag} *Escalation — ${brand.name} (${channelLabel})*`,
    `Reason: ${input.reason}`,
    `Business hours: ${duringBusinessHours ? "yes" : "no"}`,
    `Summary: ${input.conversation_summary}`,
  ].join("\n");

  const channels = await dispatchNotification({
    type: "escalation",
    refId: escalation.id,
    telegramChatId: brand.telegramChatId,
    emailRecipients: brand.notificationEmails,
    subject: `Escalation - ${brand.name} (${channelLabel})`,
    message,
  });

  await prisma.escalation.update({
    where: { id: escalation.id },
    data: { notifiedChannels: channels },
  });
}
