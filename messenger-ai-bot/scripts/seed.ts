import { getPrismaClient } from "../packages/db/src/index.js";

/**
 * Seeds one sample brand + page for local development. Run with:
 *   npm run db:seed
 * Replace the placeholder values (Page ID, access token) with real ones from your Facebook
 * App once you have a test Page connected — see README.md for the setup steps.
 */
async function main(): Promise<void> {
  const prisma = getPrismaClient();

  const brand = await prisma.brand.upsert({
    where: { slug: "demo-brand" },
    create: {
      name: "Demo Brand",
      slug: "demo-brand",
      systemPrompt:
        "You are a warm, professional assistant for Demo Brand, a Vietnamese footwear retailer. " +
        "Speak naturally, ask about the customer's needs before pitching products, and gently " +
        "work toward getting their phone number once you sense genuine interest.",
      claudeModel: "claude-sonnet-5",
      notificationEmails: ["sales@example.com"],
      businessHours: {
        tz: "Asia/Ho_Chi_Minh",
        windows: [
          { day: "mon", start: "08:00", end: "18:00" },
          { day: "tue", start: "08:00", end: "18:00" },
          { day: "wed", start: "08:00", end: "18:00" },
          { day: "thu", start: "08:00", end: "18:00" },
          { day: "fri", start: "08:00", end: "18:00" },
          { day: "sat", start: "08:00", end: "12:00" },
        ],
      },
    },
    update: {},
  });

  await prisma.knowledgeEntry.createMany({
    data: [
      {
        brandId: brand.id,
        category: "brand_story",
        title: "Who we are",
        content: "Demo Brand has sold quality footwear across Vietnam since 2010, known for durability and after-sales support.",
        sortOrder: 0,
      },
      {
        brandId: brand.id,
        category: "faq",
        title: "Delivery time",
        content: "Standard delivery takes 2-4 business days within major cities, 5-7 days elsewhere.",
        sortOrder: 0,
      },
      {
        brandId: brand.id,
        category: "escalation_rule",
        title: "Refund disputes",
        content: "Any refund or warranty dispute beyond the standard 30-day policy must be escalated to a human — do not promise exceptions.",
        sortOrder: 0,
      },
    ],
    skipDuplicates: true,
  });

  await prisma.page.upsert({
    where: { facebookPageId: "REPLACE_WITH_REAL_PAGE_ID" },
    create: {
      brandId: brand.id,
      facebookPageId: "REPLACE_WITH_REAL_PAGE_ID",
      pageAccessToken: "REPLACE_WITH_REAL_PAGE_ACCESS_TOKEN",
      pageName: "Demo Brand Page",
    },
    update: {},
  });

  console.log(`Seeded brand "${brand.name}" (${brand.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
