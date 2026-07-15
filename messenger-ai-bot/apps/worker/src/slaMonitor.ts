import { getPrismaClient } from "@messenger-bot/db";
import { sendTelegramMessage } from "./notify/telegram.js";

const SLA_THRESHOLD_SECONDS = Number(process.env.SLA_THRESHOLD_SECONDS ?? 60);
// How far back to look for candidate breaches each run — bounds the query, doesn't affect
// the SLA threshold itself. Should comfortably exceed the scheduler's own run interval.
const LOOKBACK_MINUTES = 15;

/**
 * Intended to run on a schedule (e.g. every 1 minute via cron/Railway cron job):
 *   npm run sla:monitor --workspace apps/worker
 *
 * Finds customer messages that received no assistant reply within SLA_THRESHOLD_SECONDS and
 * alerts the engineering Telegram channel exactly once per breach. This is the canary for
 * the whole pipeline being degraded (queue backed up, Claude API outage, Send API failing) —
 * distinct from the per-brand sales notification channel.
 */
async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const engineeringChatId = process.env.TELEGRAM_ENGINEERING_CHAT_ID;
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000);
  const deadline = new Date(now.getTime() - SLA_THRESHOLD_SECONDS * 1000);

  const candidates = await prisma.message.findMany({
    where: {
      role: "user",
      receivedAt: { gte: lookbackStart, lte: deadline },
    },
    include: { conversation: { include: { brand: true } } },
    orderBy: { receivedAt: "asc" },
  });

  for (const candidate of candidates) {
    const hasReply = await prisma.message.findFirst({
      where: {
        conversationId: candidate.conversationId,
        role: "assistant",
        createdAt: { gt: candidate.createdAt },
      },
    });
    if (hasReply) continue;

    const alreadyAlerted = await prisma.notificationLog.findFirst({
      where: { type: "sla_breach", refId: candidate.id },
    });
    if (alreadyAlerted) continue;

    const waitedSeconds = Math.round((now.getTime() - (candidate.receivedAt?.getTime() ?? 0)) / 1000);
    const text = `🚨 *SLA breach* — ${candidate.conversation.brand.name}\nMessage waiting ${waitedSeconds}s with no reply (conversation ${candidate.conversationId}).`;

    let status: "sent" | "failed" = "failed";
    let error: string | undefined;
    if (engineeringChatId) {
      try {
        await sendTelegramMessage(engineeringChatId, text);
        status = "sent";
      } catch (err) {
        error = String(err);
        console.error("[sla-monitor] failed to send alert", err);
      }
    } else {
      error = "TELEGRAM_ENGINEERING_CHAT_ID not configured";
    }

    await prisma.notificationLog.create({
      data: { type: "sla_breach", refId: candidate.id, channel: "telegram", status, error },
    });
  }

  console.log(`[sla-monitor] checked ${candidates.length} candidate message(s)`);
}

main()
  .catch((err) => {
    console.error("[sla-monitor] fatal error", err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
