import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { getPrismaClient, ConversationStatus, PageChannel } from "@messenger-bot/db";
import { runAiTurn } from "@messenger-bot/conversation-core";

const MAX_MESSAGE_LENGTH = 2000;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,100}$/;

interface WebsiteChatBody {
  widgetKey?: string;
  sessionId?: string;
  message?: string;
}

/**
 * Public, browser-facing chat endpoint for the website widget (apps/webhook/public/widget.js).
 * Unlike /webhook/facebook (server-to-server, HMAC-signature verified), this route is reached
 * directly from customer browsers, so it needs CORS and abuse protection — both scoped to this
 * route only via Fastify plugin encapsulation, never applied to the Facebook webhook route.
 */
export function registerWebsiteChatRoutes(app: FastifyInstance): void {
  app.register(async (instance) => {
    const allowedOrigins = (process.env.WEBSITE_WIDGET_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);

    await instance.register(cors, {
      origin: allowedOrigins,
    });

    await instance.register(rateLimit, {
      max: Number(process.env.WIDGET_RATE_LIMIT_MAX ?? 20),
      timeWindow: Number(process.env.WIDGET_RATE_LIMIT_WINDOW_MS ?? 60_000),
    });

    instance.post("/chat/website", async (request, reply) => {
      const body = request.body as WebsiteChatBody;
      const widgetKey = body.widgetKey?.trim();
      const sessionId = body.sessionId?.trim();
      const message = body.message?.trim();

      if (!widgetKey || !sessionId || !message) {
        return reply.code(400).send({ error: "widgetKey, sessionId, and message are required" });
      }
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return reply.code(400).send({ error: "invalid sessionId" });
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        return reply.code(400).send({ error: `message exceeds ${MAX_MESSAGE_LENGTH} characters` });
      }

      const prisma = getPrismaClient();
      const brand = await prisma.brand.findUnique({
        where: { widgetKey },
        include: { knowledgeEntries: { where: { isActive: true } } },
      });

      if (!brand || !brand.isActive) {
        return reply.code(404).send({ error: "unknown widget key" });
      }

      // One synthetic Page per brand represents the website channel — reuses the same
      // Conversation.@@unique([pageId, psid]) upsert/history/message pipeline the Facebook
      // flow already relies on, instead of a parallel data model for web conversations.
      const webPage = await prisma.page.upsert({
        where: { facebookPageId: `web:${brand.slug}` },
        create: {
          brandId: brand.id,
          channel: PageChannel.web,
          facebookPageId: `web:${brand.slug}`,
          pageAccessToken: "unused",
          pageName: `${brand.name} — Website Widget`,
        },
        update: {},
      });

      const conversation = await prisma.conversation.upsert({
        where: { pageId_psid: { pageId: webPage.id, psid: sessionId } },
        create: {
          brandId: brand.id,
          pageId: webPage.id,
          psid: sessionId,
          status: ConversationStatus.active,
        },
        update: {},
      });

      const receivedAt = new Date();

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "user",
          content: [{ type: "text", text: message }],
          receivedAt,
        },
      });

      const freshConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: receivedAt },
      });
      if (freshConversation.humanMutedUntil && freshConversation.humanMutedUntil > new Date()) {
        // No live-agent web console in this phase, so this path is effectively unused today —
        // kept for structural parity with the Facebook flow in case that changes later.
        return reply.send({
          reply: "Cảm ơn bạn đã nhắn tin, nhân viên sẽ phản hồi sớm.",
          sessionId,
          conversationId: conversation.id,
        });
      }

      const result = await runAiTurn({
        conversationId: conversation.id,
        brand,
        knowledgeEntries: brand.knowledgeEntries,
        receivedAt,
        channel: "web",
        deliver: async (replyText) => {
          void replyText; // delivered via the HTTP response below, not a side channel
          return {};
        },
      });

      return reply.send({ reply: result.replyText, sessionId, conversationId: conversation.id });
    });
  });
}
