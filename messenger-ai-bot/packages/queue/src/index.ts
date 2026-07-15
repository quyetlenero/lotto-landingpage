import { Queue, type ConnectionOptions } from "bullmq";

export const INBOUND_MESSAGE_QUEUE = "inbound-messenger-message";

export interface InboundMessageJob {
  facebookPageId: string;
  /** Customer's page-scoped ID, regardless of message direction. */
  psid: string;
  /** Facebook mid of the message, used for idempotency/dedup. */
  fbMessageId: string;
  /** Raw messaging text, empty string if the event carried no text (e.g. attachment-only). */
  text: string;
  /** Epoch ms from the webhook payload's `timestamp` field. */
  timestamp: number;
  /**
   * "inbound" = customer wrote in. "echo" = the Page sent a message (either our own bot
   * reply, confirmed via fbMessageId already on file, or a human replying manually via
   * Page Inbox — the worker tells these apart and mutes the bot for the latter).
   */
  direction: "inbound" | "echo";
}

/**
 * Returns plain connection options (not a live client) — deliberate, so BullMQ can manage
 * its own Redis connection lifecycle internally rather than us bundling a separate `ioredis`
 * dependency that risks a duplicate-package version mismatch with the one BullMQ vendors.
 */
export function getQueueConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<InboundMessageJob> | undefined;

export function getInboundMessageQueue(): Queue<InboundMessageJob> {
  if (!queue) {
    queue = new Queue<InboundMessageJob>(INBOUND_MESSAGE_QUEUE, { connection: getQueueConnection() });
  }
  return queue;
}
