import { getPrismaClient, ConversationStatus } from "@messenger-bot/db";
import { runAiTurn } from "@messenger-bot/conversation-core";
import type { InboundMessageJob } from "@messenger-bot/queue";
import { sendMessengerText } from "./facebookSendApi.js";

const HUMAN_MUTE_MINUTES = 60;

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

  await runAiTurn({
    conversationId: conversation.id,
    brand: page.brand,
    knowledgeEntries: page.brand.knowledgeEntries,
    receivedAt,
    channel: "messenger",
    deliver: async (replyText) => {
      const sendResult = await sendMessengerText(page.pageAccessToken, job.psid, replyText);
      return { externalMessageId: sendResult.message_id };
    },
  });
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
