import { getPrismaClient } from "@messenger-bot/db";
import type { Message as DbMessage } from "@messenger-bot/db";
import { extractConversationInsight } from "@messenger-bot/claude";

const IDLE_HOURS = Number(process.env.CONVERSATION_IDLE_HOURS ?? 6);
const BATCH_LIMIT = Number(process.env.INSIGHT_EXTRACTION_BATCH_LIMIT ?? 200);
const CLAUDE_INSIGHT_TIMEOUT_MS = Number(process.env.CLAUDE_INSIGHT_TIMEOUT_MS ?? 20000);

/**
 * Intended to run on a schedule (e.g. every hour via cron/Railway Cron Job):
 *   npm run insights:extract --workspace apps/worker
 *
 * Finds conversations that have gone idle (no activity for CONVERSATION_IDLE_HOURS) and
 * distills each one into a ConversationInsight row via a single Claude tool-use call. Safe
 * to run repeatedly without a lookback window: a conversation is only re-analyzed once new
 * activity (a later lastMessageAt) happens after its most recent insight snapshot.
 */
async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const idleDeadline = new Date(Date.now() - IDLE_HOURS * 60 * 60 * 1000);

  const candidates = await prisma.conversation.findMany({
    where: {
      lastMessageAt: { lte: idleDeadline },
      brand: { isActive: true },
    },
    include: {
      brand: true,
      insights: { orderBy: { extractedAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "asc" },
    take: BATCH_LIMIT,
  });

  let analyzed = 0;
  let skipped = 0;

  for (const conversation of candidates) {
    const latestInsight = conversation.insights[0];
    if (latestInsight && conversation.lastMessageAt && latestInsight.extractedAt > conversation.lastMessageAt) {
      skipped++;
      continue; // already analyzed this activity period
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    const transcript = flattenTranscript(messages);
    if (!transcript) {
      skipped++;
      continue; // nothing conversational to analyze (e.g. only synthetic tool_result rows)
    }

    try {
      const extracted = await extractConversationInsight(
        conversation.brand.name,
        transcript,
        CLAUDE_INSIGHT_TIMEOUT_MS,
      );

      await prisma.conversationInsight.create({
        data: {
          conversationId: conversation.id,
          brandId: conversation.brandId,
          personaSummary: extracted.persona_summary,
          ageRangeGuess: extracted.age_range_guess,
          genderGuess: extracted.gender_guess,
          locationGuess: extracted.location_guess,
          needs: extracted.needs,
          painPoints: extracted.pain_points,
          objections: extracted.objections ?? [],
          productInterests: extracted.product_interests ?? [],
          sentiment: extracted.sentiment,
          purchaseIntent: extracted.purchase_intent,
          dropOffReason: extracted.drop_off_reason,
          quoteHighlights: extracted.quote_highlights,
        },
      });
      analyzed++;
    } catch (err) {
      console.error(`[insight-extraction] failed for conversation ${conversation.id}`, err);
    }
  }

  console.log(
    `[insight-extraction] analyzed ${analyzed}, skipped ${skipped}, candidates ${candidates.length}`,
  );
}

/** Turns stored Anthropic content-block JSON into a plain "Khách/Bot: ..." transcript for
 * the analysis prompt — cheaper and simpler than round-tripping raw content blocks, which
 * `loadHistory()` in processMessage.ts does for the (different) purpose of continuing the
 * conversation with Claude. */
function flattenTranscript(messages: DbMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "tool_result") continue;
    const speaker = message.role === "user" ? "Khách" : "Bot";
    const text = extractTextBlocks(message.content);
    if (text) lines.push(`${speaker}: ${text}`);
  }
  return lines.join("\n");
}

function extractTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => {
      const b = block as { type?: unknown; text?: unknown };
      return b?.type === "text" && typeof b.text === "string";
    })
    .map((block) => block.text)
    .join(" ")
    .trim();
}

main()
  .catch((err) => {
    console.error("[insight-extraction] fatal error", err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
