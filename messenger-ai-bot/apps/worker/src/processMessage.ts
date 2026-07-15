import type Anthropic from "@anthropic-ai/sdk";
import { getPrismaClient, ConversationStatus } from "@messenger-bot/db";
import type { Message as DbMessage } from "@messenger-bot/db";
import {
  generateReply,
  compileBrandSystemPrompt,
  type CaptureLeadInput,
  type EscalateToHumanInput,
} from "@messenger-bot/claude";
import type { InboundMessageJob } from "@messenger-bot/queue";
import { sendMessengerText } from "./facebookSendApi.js";
import { dispatchNotification } from "./notify/dispatch.js";
import { isWithinBusinessHours } from "./businessHours.js";

const MAX_HISTORY_MESSAGES = 20;
const HUMAN_MUTE_MINUTES = 60;
const CANNED_FALLBACK_REPLY =
  "Cảm ơn bạn đã nhắn tin! Chúng tôi đã nhận được tin nhắn và sẽ phản hồi sớm nhất có thể.";

export async function processInboundMessageJob(job: InboundMessageJob): Promise<void> {
  const prisma = getPrismaClient();

  const page = await prisma.page.findUnique({
    where: { facebookPageId: job.facebookPageId },
    include: { brand: { include: { knowledgeEntries: { where: { isActive: true } } } } },
  });

  if (!page || !page.isActive || !page.brand.isActive) {
    console.warn(`[worker] ignoring message for unknown/inactive page ${job.facebookPageId}`);
    return;
  }

  const conversation = await prisma.conversation.upsert({
    where: { pageId_psid: { pageId: page.id, psid: job.psid } },
    create: { brandId: page.brandId, pageId: page.id, psid: job.psid, status: ConversationStatus.active },
    update: {},
  });

  if (job.direction === "echo") {
    await handleEcho(job, conversation.id);
    return;
  }

  const receivedAt = new Date(job.timestamp);

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: job.text }],
      fbMessageId: job.fbMessageId,
      receivedAt,
    },
  });

  // lastMessageAt drives the idle-conversation scan in apps/worker/src/insightExtraction.ts —
  // update it on every customer message, not just tool-triggered writes below.
  const freshConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: receivedAt },
  });
  if (freshConversation.humanMutedUntil && freshConversation.humanMutedUntil > new Date()) {
    // A human is actively handling this thread via Page Inbox — stay quiet so the bot
    // doesn't talk over them.
    return;
  }

  const history = await loadHistory(conversation.id);
  const systemPrompt = compileBrandSystemPrompt({
    name: page.brand.name,
    systemPrompt: page.brand.systemPrompt,
    knowledgeEntries: page.brand.knowledgeEntries.map((e) => ({
      category: e.category,
      title: e.title,
      content: e.content,
      sortOrder: e.sortOrder,
    })),
  });

  let assistantContent: Anthropic.ContentBlock[];
  try {
    const { response } = await generateReply({
      systemPrompt,
      history,
      primaryModel: page.brand.claudeModel,
      fallbackModel: process.env.CLAUDE_FALLBACK_MODEL ?? "claude-haiku-4-5",
      timeoutMs: Number(process.env.CLAUDE_REQUEST_TIMEOUT_MS ?? 8000),
    });
    assistantContent = response.content;
  } catch (err) {
    console.error(`[worker] Claude call failed for conversation ${conversation.id}, using canned reply`, err);
    await sendMessengerText(page.pageAccessToken, job.psid, CANNED_FALLBACK_REPLY);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: [{ type: "text", text: CANNED_FALLBACK_REPLY }],
        repliedAt: new Date(),
        latencyMs: Date.now() - receivedAt.getTime(),
      },
    });
    return;
  }

  const replyText = assistantContent
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();

  // Send to the customer first — everything below (DB writes, notifications) can happen
  // after they already have their reply.
  const sendResult = await sendMessengerText(
    page.pageAccessToken,
    job.psid,
    replyText || CANNED_FALLBACK_REPLY,
  );
  const repliedAt = new Date();

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: assistantContent as unknown as object,
      fbMessageId: sendResult.message_id,
      repliedAt,
      latencyMs: repliedAt.getTime() - receivedAt.getTime(),
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
        conversationId: conversation.id,
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
        await handleCaptureLead(block.input as CaptureLeadInput, conversation.id, page.brand);
      } else if (block.name === "escalate_to_human") {
        await handleEscalation(block.input as EscalateToHumanInput, conversation.id, page.brand);
      }
    }
  }
}

async function handleEcho(job: InboundMessageJob, conversationId: string): Promise<void> {
  const prisma = getPrismaClient();

  const existing = await prisma.message.findFirst({ where: { fbMessageId: job.fbMessageId } });
  if (existing) {
    // Confirmation echo of our own bot reply — already recorded when we sent it.
    return;
  }

  // Not a message we sent — a human replied directly via Page Inbox. Persist it as an
  // assistant-authored turn (for conversation continuity) and mute the bot.
  await prisma.message.create({
    data: {
      conversationId,
      role: "assistant",
      content: [{ type: "text", text: job.text }],
      fbMessageId: job.fbMessageId,
      repliedAt: new Date(job.timestamp),
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: ConversationStatus.human_takeover,
      humanMutedUntil: new Date(Date.now() + HUMAN_MUTE_MINUTES * 60_000),
      lastMessageAt: new Date(job.timestamp),
    },
  });
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
  brand: { id: string; name: string; telegramChatId: string | null; notificationEmails: string[] },
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
    `🟢 *New lead — ${brand.name}*`,
    `📞 ${input.phone_number}`,
    `👤 ${input.customer_name ?? "unknown"}`,
    `📝 ${input.need_summary}`,
    `Urgency: ${input.urgency}`,
  ].join("\n");

  const channels = await dispatchNotification({
    type: "lead",
    refId: lead.id,
    telegramChatId: brand.telegramChatId,
    emailRecipients: brand.notificationEmails,
    subject: `Lead mới - ${brand.name}`,
    message,
  });

  await prisma.lead.update({ where: { id: lead.id }, data: { notifiedAt: new Date() } });
  void channels;
}

async function handleEscalation(
  input: EscalateToHumanInput,
  conversationId: string,
  brand: {
    id: string;
    name: string;
    telegramChatId: string | null;
    notificationEmails: string[];
    businessHours: unknown;
  },
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
    `${urgencyTag} *Escalation — ${brand.name}*`,
    `Reason: ${input.reason}`,
    `Business hours: ${duringBusinessHours ? "yes" : "no"}`,
    `Summary: ${input.conversation_summary}`,
  ].join("\n");

  const channels = await dispatchNotification({
    type: "escalation",
    refId: escalation.id,
    telegramChatId: brand.telegramChatId,
    emailRecipients: brand.notificationEmails,
    subject: `Escalation - ${brand.name}`,
    message,
  });

  await prisma.escalation.update({
    where: { id: escalation.id },
    data: { notifiedChannels: channels },
  });
}
