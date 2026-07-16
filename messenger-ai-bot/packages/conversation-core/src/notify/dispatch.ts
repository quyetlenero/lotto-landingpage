import { getPrismaClient } from "@messenger-bot/db";
import { sendTelegramMessage } from "./telegram.js";
import { sendNotificationEmail } from "./email.js";

interface DispatchArgs {
  type: "lead" | "escalation" | "sla_breach";
  refId?: string;
  telegramChatId?: string | null;
  emailRecipients?: string[];
  subject: string;
  message: string;
}

/**
 * Fires a notification to every configured channel for this brand and logs each attempt.
 * Best-effort and parallel — a Telegram failure must not block the email fallback (or
 * vice versa), since either channel alone is enough for staff to catch the lead/escalation.
 */
export async function dispatchNotification(args: DispatchArgs): Promise<string[]> {
  const prisma = getPrismaClient();
  const sentChannels: string[] = [];

  const attempts: Array<Promise<void>> = [];

  if (args.telegramChatId) {
    attempts.push(
      sendTelegramMessage(args.telegramChatId, args.message)
        .then(() => {
          sentChannels.push("telegram");
          return logNotification("sent");
        })
        .catch((err) => logNotification("failed", String(err))),
    );
  }

  if (args.emailRecipients && args.emailRecipients.length > 0) {
    attempts.push(
      sendNotificationEmail(args.emailRecipients, args.subject, args.message)
        .then(() => {
          sentChannels.push("email");
          return logEmailNotification("sent");
        })
        .catch((err) => logEmailNotification("failed", String(err))),
    );
  }

  await Promise.all(attempts);
  return sentChannels;

  async function logNotification(status: "sent" | "failed", error?: string): Promise<void> {
    await prisma.notificationLog.create({
      data: { type: args.type, refId: args.refId, channel: "telegram", status, error },
    });
  }

  async function logEmailNotification(status: "sent" | "failed", error?: string): Promise<void> {
    await prisma.notificationLog.create({
      data: { type: args.type, refId: args.refId, channel: "email", status, error },
    });
  }
}
