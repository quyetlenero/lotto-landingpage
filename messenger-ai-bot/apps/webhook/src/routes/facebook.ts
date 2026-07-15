import type { FastifyInstance, FastifyRequest } from "fastify";
import { getInboundMessageQueue, type InboundMessageJob } from "@messenger-bot/queue";
import { verifyFacebookSignature } from "../verifySignature.js";
import type { FacebookWebhookPayload } from "../types.js";

interface RawBodyRequest extends FastifyRequest {
  rawBody?: Buffer;
}

export function registerFacebookWebhookRoutes(app: FastifyInstance): void {
  // Meta's one-time subscription verification handshake.
  app.get("/webhook/facebook", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send("Verification failed");
  });

  app.post("/webhook/facebook", async (request: RawBodyRequest, reply) => {
    const signature = request.headers["x-hub-signature-256"] as string | undefined;
    const appSecret = process.env.FB_APP_SECRET ?? "";

    if (!request.rawBody || !verifyFacebookSignature(request.rawBody, signature, appSecret)) {
      request.log.warn("Rejected webhook: invalid signature");
      return reply.code(401).send("Invalid signature");
    }

    // Ack immediately after signature check — enqueue is fire-and-forget from Facebook's
    // point of view. Never call Claude or the Send API in this handler (see plan: ack/process
    // split is what makes the sub-1-minute reply SLA achievable and reliable).
    reply.code(200).send("EVENT_RECEIVED");

    const payload = request.body as FacebookWebhookPayload;
    if (payload.object !== "page") return;

    const queue = getInboundMessageQueue();

    for (const entry of payload.entry ?? []) {
      const facebookPageId = entry.id;
      for (const event of entry.messaging ?? []) {
        if (!event.message || !event.message.mid) continue;

        const job: InboundMessageJob = {
          facebookPageId,
          psid: event.message.is_echo ? event.recipient.id : event.sender.id,
          fbMessageId: event.message.mid,
          text: event.message.text ?? "",
          timestamp: event.timestamp,
          direction: event.message.is_echo ? "echo" : "inbound",
        };

        await queue.add("process-message", job, {
          jobId: job.fbMessageId, // idempotent: Facebook may redeliver the same webhook
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
      }
    }
  });
}
