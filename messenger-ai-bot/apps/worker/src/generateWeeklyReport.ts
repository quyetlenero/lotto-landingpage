import { getPrismaClient } from "@messenger-bot/db";
import { generateTargetingReport, type AggregatedInsightStats, type FrequencyItem } from "@messenger-bot/claude";

const REPORT_PERIOD_DAYS = Number(process.env.REPORT_PERIOD_DAYS ?? 7);
const TOP_N = 10;
const SAMPLE_QUOTES_LIMIT = 15;
const CLAUDE_REPORT_TIMEOUT_MS = Number(process.env.CLAUDE_REPORT_TIMEOUT_MS ?? 30000);

/**
 * Intended to run on a schedule (e.g. weekly, Monday 06:00 via Railway Cron Job):
 *   npm run insights:report --workspace apps/worker
 *
 * For each active brand, aggregates the period's ConversationInsight rows in plain JS (cheap,
 * no Claude call needed for tallying) and makes exactly one Claude call per brand to turn the
 * aggregated stats into a persona summary + ranked needs/pain points + ad-targeting
 * recommendations. Cost stays flat regardless of conversation volume that week, since raw
 * transcripts are never re-sent here — only the already-distilled insight fields.
 */
async function main(): Promise<void> {
  const prisma = getPrismaClient();
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - REPORT_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const brands = await prisma.brand.findMany({
    where: { isActive: true },
    include: { knowledgeEntries: { where: { isActive: true, category: "brand_story" } } },
  });

  let reportsGenerated = 0;

  for (const brand of brands) {
    const insights = await prisma.conversationInsight.findMany({
      where: { brandId: brand.id, extractedAt: { gte: periodStart, lte: periodEnd } },
    });

    if (insights.length === 0) {
      console.log(`[weekly-report] ${brand.name}: no insights this period, skipping`);
      continue;
    }

    const stats: AggregatedInsightStats = {
      conversationsAnalyzed: insights.length,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      needsFrequency: tally(insights.flatMap((i) => i.needs)).slice(0, TOP_N),
      painPointsFrequency: tally(insights.flatMap((i) => i.painPoints)).slice(0, TOP_N),
      productInterestsFrequency: tally(insights.flatMap((i) => i.productInterests)).slice(0, TOP_N),
      sentimentDistribution: distribution(insights.map((i) => i.sentiment)),
      purchaseIntentDistribution: distribution(insights.map((i) => i.purchaseIntent)),
      sampleQuotes: insights.flatMap((i) => i.quoteHighlights).slice(0, SAMPLE_QUOTES_LIMIT),
    };

    const brandStory =
      brand.knowledgeEntries.map((entry) => entry.content).join("\n\n") || brand.systemPrompt;

    try {
      const report = await generateTargetingReport(brand.name, brandStory, stats, CLAUDE_REPORT_TIMEOUT_MS);

      await prisma.insightReport.create({
        data: {
          brandId: brand.id,
          periodStart,
          periodEnd,
          conversationsAnalyzed: insights.length,
          personaSummary: report.persona_summary,
          topNeeds: report.top_needs as unknown as object,
          topPainPoints: report.top_pain_points as unknown as object,
          targetingRecommendations: report.targeting_recommendations as unknown as object,
          rawReportMarkdown: report.raw_report_markdown,
        },
      });
      reportsGenerated++;
      console.log(`[weekly-report] ${brand.name}: generated report from ${insights.length} insight(s)`);
    } catch (err) {
      console.error(`[weekly-report] failed to generate report for ${brand.name}`, err);
    }
  }

  console.log(`[weekly-report] done — ${reportsGenerated}/${brands.length} brand(s) got a report`);
}

function tally(items: string[]): FrequencyItem[] {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const value = raw.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

function distribution(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

main()
  .catch((err) => {
    console.error("[weekly-report] fatal error", err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
