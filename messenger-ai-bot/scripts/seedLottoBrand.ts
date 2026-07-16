import { getPrismaClient } from "../packages/db/src/index.js";

/**
 * Seeds the LOTTO pilot brand with real content pulled from the landing page
 * (repo-root index.html) — the "Thu Cũ Đổi Mới Lotto 2026" trade-in campaign.
 *
 * Before running against a real environment:
 *   1. Replace `facebookPageId` / `pageAccessToken` below with the real values from
 *      Meta for Developers (see docs/deployment-guide — "Chuẩn bị Meta Business Manager").
 *   2. Replace `telegramChatId` / `notificationEmails` with the sales team's real channels.
 *   3. Confirm the campaign window (03/07–05/08/2026) is still current — this content
 *      goes stale after 05/08/2026 and needs a refresh or a follow-up campaign.
 *
 * Run with:
 *   npx tsx scripts/seedLottoBrand.ts
 */
async function main(): Promise<void> {
  const prisma = getPrismaClient();

  const brand = await prisma.brand.upsert({
    where: { slug: "lotto" },
    create: {
      name: "LOTTO Sport Việt Nam",
      slug: "lotto",
      systemPrompt: SYSTEM_PROMPT,
      claudeModel: "claude-sonnet-5",
      telegramChatId: null, // TODO: điền chat_id nhóm Telegram sale trước khi go-live
      notificationEmails: ["contact@nero.com.vn"], // TODO: đổi sang email đội sale thật nếu khác
      businessHours: {
        tz: "Asia/Ho_Chi_Minh",
        windows: [
          { day: "mon", start: "08:00", end: "18:00" },
          { day: "tue", start: "08:00", end: "18:00" },
          { day: "wed", start: "08:00", end: "18:00" },
          { day: "thu", start: "08:00", end: "18:00" },
          { day: "fri", start: "08:00", end: "18:00" },
          { day: "sat", start: "08:00", end: "17:00" },
          { day: "sun", start: "08:00", end: "17:00" },
        ],
      },
    },
    update: { systemPrompt: SYSTEM_PROMPT },
  });

  await prisma.knowledgeEntry.deleteMany({ where: { brandId: brand.id } });
  await prisma.knowledgeEntry.createMany({
    data: KNOWLEDGE_ENTRIES.map((entry) => ({ ...entry, brandId: brand.id })),
  });

  await prisma.page.upsert({
    where: { facebookPageId: "REPLACE_WITH_REAL_LOTTO_PAGE_ID" },
    create: {
      brandId: brand.id,
      facebookPageId: "REPLACE_WITH_REAL_LOTTO_PAGE_ID",
      pageAccessToken: "REPLACE_WITH_REAL_LOTTO_PAGE_ACCESS_TOKEN",
      pageName: "LOTTO Sport Việt Nam",
    },
    update: {},
  });

  console.log(`Seeded brand "${brand.name}" (${brand.id})`);
  console.log(`Website widget key: ${brand.widgetKey}`);
  console.log(`Knowledge entries: ${KNOWLEDGE_ENTRIES.length}`);
  console.log("Nhớ thay facebookPageId/pageAccessToken/telegramChatId thật trước khi go-live.");
}

const SYSTEM_PROMPT = `
Bạn là trợ lý tư vấn của LOTTO Sport Việt Nam — thương hiệu giày thể thao Ý thành lập năm 1973,
được phân phối chính thức tại Việt Nam bởi Công ty Cổ phần NERO. Bạn đang hỗ trợ khách nhắn tin
hỏi về chương trình khuyến mãi "Thu Cũ Đổi Mới Lotto 2026" (03/07 – 05/08/2026).

Vai trò của bạn:
- Trả lời nhanh, thân thiện, chính xác theo đúng thông tin chương trình và sản phẩm trong knowledge base.
- Khai thác nhu cầu một cách tự nhiên: giày cũ của khách đang trong tình trạng gì (rách/mòn đế/còn tốt),
  khách quan tâm mẫu giày hoặc môn thể thao nào, đang ở tỉnh/thành nào.
- Hướng khách tới hành động cụ thể: mang giày đến đại lý gần nhất để nhân viên kiểm tra và xác nhận
  mức hỗ trợ, hoặc để lại số điện thoại để nhân viên chủ động liên hệ tư vấn.

Quy tắc quan trọng khi tư vấn mức hỗ trợ:
- Mức hỗ trợ (500.000đ cho giày rách, 700.000đ cho giày mòn đế) chỉ là ƯỚC TÍNH dựa trên mô tả
  của khách qua tin nhắn. Luôn nói rõ rằng nhân viên tại đại lý sẽ kiểm tra trực tiếp giày để xác
  nhận mức hỗ trợ chính thức. Không cam kết chắc chắn số tiền khi chưa kiểm tra thực tế.
- Chương trình chỉ áp dụng tại đại lý — không có giao dịch/đổi giày online.

Khi nào chủ động xin số điện thoại (gọi tool capture_lead):
- Khi khách xác nhận muốn đổi giày, hỏi giá cụ thể một mẫu, hoặc thể hiện ý định mua rõ ràng.
- Khi khách ở xa đại lý hoặc muốn nhân viên chủ động gọi lại tư vấn trước khi ra cửa hàng.
- Đừng hỏi số điện thoại ngay từ tin nhắn đầu — trò chuyện tự nhiên, tìm hiểu nhu cầu trước.

Khi nào cần chuyển cho nhân viên (gọi tool escalate_to_human): xem knowledge base mục
"Quy tắc chuyển tiếp nhân viên" — đặc biệt là tranh chấp kết quả kiểm tra tại đại lý, yêu cầu
đổi trả/bảo hành ngoài chính sách, khách bức xúc, hoặc yêu cầu ưu đãi ngoài chương trình.
`.trim();

interface SeedKnowledgeEntry {
  category: string;
  title: string;
  content: string;
  sortOrder: number;
}

const KNOWLEDGE_ENTRIES: SeedKnowledgeEntry[] = [
  // -- brand_story --
  {
    category: "brand_story",
    title: "LOTTO là ai",
    content:
      "LOTTO là thương hiệu giày thể thao Ý, thành lập năm 1973, hơn 50 năm kinh nghiệm, nổi " +
      "tiếng với công nghệ đế chuẩn Ý. Tại Việt Nam, LOTTO được phân phối chính thức bởi Công ty " +
      "Cổ phần NERO (địa chỉ: NV1-19 KĐT Dream Town, Đường 70, Phường Xuân Phương, Hà Nội). " +
      "Website: lottosports.vn. Hệ thống hơn 200 điểm bán trên toàn quốc, gồm cả sản phẩm dòng Nirox.",
    sortOrder: 0,
  },
  {
    category: "brand_story",
    title: "Chương trình Thu Cũ Đổi Mới 2026",
    content:
      "Chương trình khuyến mãi 'Thu Cũ Đổi Mới Lotto 2026' diễn ra từ 03/07/2026 đến hết " +
      "05/08/2026. Khách mang giày thể thao cũ (không bắt buộc là giày Lotto, chấp nhận mọi " +
      "thương hiệu như Nike, Adidas, Mizuno, Yonex, Babolat...) đến đại lý chính thức của Lotto " +
      "để được hỗ trợ giảm giá khi mua giày Lotto mới chính hãng. Đây là chương trình đổi trực " +
      "tiếp tại cửa hàng, không giao dịch online. Sau 05/08/2026, chương trình này hết hạn — cần " +
      "cập nhật lại nội dung nếu có chương trình kế tiếp.",
    sortOrder: 1,
  },

  // -- product --
  {
    category: "product",
    title: "Mức hỗ trợ đổi giày",
    content:
      "Giày rách (rách mũi, tách đế, bung keo): hỗ trợ 500.000đ khi mua sản phẩm áp dụng. " +
      "Giày mòn đế (đế mòn rõ, dễ trơn trượt): hỗ trợ 700.000đ khi mua sản phẩm áp dụng. Giày còn " +
      "tốt/gần như mới không thuộc diện áp dụng. Loại giày áp dụng: giày thể thao, chạy bộ, gym, " +
      "tennis, pickleball — không áp dụng giày bảo hộ lao động hoặc dép. Khoản hỗ trợ được trừ " +
      "thẳng vào giá mua, khách thanh toán phần chênh lệch. Có thể mang nhiều đôi giày cũ để cộng " +
      "dồn mức hỗ trợ.",
    sortOrder: 0,
  },
  {
    category: "product",
    title: "Sản phẩm tiêu biểu áp dụng chương trình",
    content:
      "RAPTOR 300 (Nam) — 2.359.000đ — hỗ trợ tối đa 500K khi đổi giày cũ.\n" +
      "MIRAGE 300 (Nam) — 2.559.000đ — hỗ trợ tối đa 700K.\n" +
      "MIRAGE 700 (Nam) — 1.839.000đ — hỗ trợ tối đa 700K.\n" +
      "MIRAGE 700 (Nữ) — 1.839.000đ — hỗ trợ tối đa 700K.\n" +
      "RAPTOR 100 (Nam) — 4.599.000đ — hỗ trợ tối đa 500K.\n" +
      "RAPTOR 300 (Nữ) — 2.359.000đ — hỗ trợ tối đa 500K.\n" +
      "Giá trên là giá niêm yết, chưa trừ khoản hỗ trợ đổi giày cũ. Còn nhiều mẫu khác tại " +
      "website lottosports.vn.",
    sortOrder: 1,
  },
  {
    category: "product",
    title: "Bảng size giày Lotto",
    content:
      "Nam: 25.2cm = US7/EU39, 25.5cm = US7.5/EU40, 26.5cm = US8.5/EU41, 27cm = US9/EU42, " +
      "27.7cm = US10/EU43, 28.5cm = US11/EU44.\n" +
      "Nữ: 23cm = US5.5/EU36, 24cm = US6.5/EU37, 24.5cm = US7/EU38, 25.2cm = US8/EU39, " +
      "25.5cm = US8.5/EU40.",
    sortOrder: 2,
  },

  // -- faq (verbatim from the landing page) --
  {
    category: "faq",
    title: "Chương trình Thu cũ đổi mới Lotto là gì?",
    content:
      "Khách hàng mang giày thể thao cũ (bất kỳ thương hiệu) đến điểm bán Lotto để được hỗ trợ " +
      "giảm giá khi mua giày Lotto chính hãng. Áp dụng từ 03/07 đến 05/08/2026.",
    sortOrder: 0,
  },
  {
    category: "faq",
    title: "Giày cũ có bắt buộc là giày Lotto không?",
    content:
      "Không. Áp dụng với mọi thương hiệu giày thể thao cũ: Nike, Adidas, Mizuno, Yonex, " +
      "Babolat... Chỉ cần là giày thể thao là được.",
    sortOrder: 1,
  },
  {
    category: "faq",
    title: "Mức hỗ trợ là bao nhiêu?",
    content:
      "Giày rách: hỗ trợ 500.000đ khi mua sản phẩm áp dụng. Giày mòn đế: hỗ trợ 700.000đ khi mua " +
      "sản phẩm áp dụng. Khoản hỗ trợ được trừ thẳng vào giá mua.",
    sortOrder: 2,
  },
  {
    category: "faq",
    title: "Có thể cộng dồn nhiều đôi giày cũ không?",
    content:
      "Có. Bạn có thể mang nhiều đôi giày cũ và cộng dồn số tiền hỗ trợ. Liên hệ hotline " +
      "0964 890 686 để được tư vấn chi tiết.",
    sortOrder: 3,
  },
  {
    category: "faq",
    title: "Chương trình áp dụng ở đâu?",
    content:
      "Tại hệ thống đại lý chính thức của Lotto trên toàn quốc. Xem danh sách đầy đủ trên " +
      "website lottosports.vn hoặc hỏi bot theo tỉnh/thành của khách.",
    sortOrder: 4,
  },

  // -- policy --
  {
    category: "policy",
    title: "Bảo hành",
    content: "Giày mới mua được bảo hành 2 tháng cho thân giày và 1 tháng cho mòn đế.",
    sortOrder: 0,
  },
  {
    category: "policy",
    title: "Hình thức tham gia",
    content:
      "Chương trình chỉ áp dụng trực tiếp tại đại lý chính thức của Lotto trên toàn quốc, không " +
      "giao dịch/đổi giày online. Khách có thể để lại thông tin qua chat để được nhân viên tư vấn " +
      "và hẹn lịch, nhưng việc kiểm tra giày cũ và xác nhận mức hỗ trợ chỉ thực hiện tại cửa hàng.",
    sortOrder: 1,
  },
  {
    category: "policy",
    title: "Xác định mức hỗ trợ chính thức",
    content:
      "Mức hỗ trợ (500K hoặc 700K) bot đưa ra qua tin nhắn chỉ mang tính tham khảo dựa trên mô tả " +
      "của khách. Nhân viên tại đại lý sẽ kiểm tra trực tiếp tình trạng giày để xác nhận mức hỗ " +
      "trợ chính thức trước khi thanh toán.",
    sortOrder: 2,
  },
  {
    category: "policy",
    title: "Thông tin liên hệ",
    content:
      "Hotline: 0964 890 686. Email: contact@nero.com.vn. Website: lottosports.vn. Công ty phân " +
      "phối: Công ty Cổ phần NERO, địa chỉ NV1-19 KĐT Dream Town, Đường 70, Phường Xuân Phương, " +
      "Hà Nội.",
    sortOrder: 3,
  },

  // -- escalation_rule --
  {
    category: "escalation_rule",
    title: "Tranh chấp kết quả kiểm tra giày tại đại lý",
    content:
      "Nếu khách phản ánh nhân viên đại lý xác nhận mức hỗ trợ khác với những gì bot đã tư vấn, " +
      "hoặc khách không hài lòng với kết quả kiểm tra tại cửa hàng: xin lỗi vì sự bất tiện, giải " +
      "thích mức hỗ trợ bot đưa ra chỉ là ước tính qua mô tả, và gọi escalate_to_human " +
      "(reason=policy_or_refund_dispute) để nhân viên phụ trách xử lý trực tiếp.",
    sortOrder: 0,
  },
  {
    category: "escalation_rule",
    title: "Khiếu nại bảo hành/đổi trả ngoài chính sách",
    content:
      "Bất kỳ yêu cầu đổi trả, hoàn tiền, hoặc bảo hành nào vượt quá 2 tháng (thân giày) hoặc " +
      "1 tháng (mòn đế) đều phải chuyển cho nhân viên, không tự hứa hẹn ngoại lệ " +
      "(escalate_to_human, reason=policy_or_refund_dispute).",
    sortOrder: 1,
  },
  {
    category: "escalation_rule",
    title: "Khách bức xúc hoặc đòi gặp người thật",
    content:
      "Nếu khách thể hiện sự bức xúc, khó chịu, hoặc yêu cầu rõ ràng muốn nói chuyện với nhân " +
      "viên/người thật, luôn gọi escalate_to_human ngay (reason=angry_customer hoặc " +
      "explicit_human_request tuỳ tình huống), không cố gắng tự xử lý thêm.",
    sortOrder: 2,
  },
  {
    category: "escalation_rule",
    title: "Yêu cầu ưu đãi ngoài chương trình",
    content:
      "Nếu khách yêu cầu mức giảm giá/hỗ trợ cao hơn 500K/700K đã công bố, hoặc muốn áp dụng " +
      "khuyến mãi ngoài thời gian 03/07–05/08/2026: không tự ý cam kết, giải thích chính sách " +
      "hiện tại, và nếu khách vẫn muốn được xem xét thì gọi capture_lead để nhân viên liên hệ " +
      "tư vấn thêm thay vì escalate ngay (đây không phải tình huống khẩn cấp).",
    sortOrder: 3,
  },
];

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
