# Messenger AI Auto-Reply Bot

Multi-brand, multi-channel AI auto-reply system — Facebook Messenger and an embeddable
website chat widget share the same Claude-powered reply pipeline. Replies within seconds,
captures leads (phone numbers), and escalates to a human via Telegram/email when needed.

See `/root/.claude/plans/t-i-c-1-v-n-abstract-alpaca.md` (or the plan shared in chat) for the
full design rationale. This README covers day-to-day setup.

## Architecture

```
Facebook Messenger → apps/webhook /webhook/facebook (ack <300ms) → Redis queue (BullMQ)
                                                                            │
                                                                            ▼
Website widget      → apps/webhook /chat/website (sync HTTP)  ┐    apps/worker
                                                                ├──▶ runAiTurn()
                                                                ┘  (packages/conversation-core)
                                                                            │
                                                                            ▼
                                                          Claude API (tool-use)
                                                          → Postgres (packages/db)
                                                          → Telegram/Email notifications
```

- `apps/webhook` — `/webhook/facebook` verifies Facebook's signature, enqueues one job per
  inbound message, acks immediately (never calls Claude/Send API directly — see plan:
  ack/process split). `/chat/website` is a synchronous, CORS + rate-limited endpoint for the
  browser widget — no queue needed here since there's no Facebook 5-second-ack constraint to
  work around. Also serves the widget script itself at `GET /widget.js`.
- `apps/worker` — Facebook-specific glue: loads brand config by Page ID, handles Messenger
  echo events for human takeover, calls the Send API, then hands off to `runAiTurn()` for the
  actual reply generation.
- `packages/conversation-core` — the channel-agnostic reply pipeline shared by both the
  Facebook worker and the website route: `runAiTurn()` loads conversation history, compiles
  the per-brand system prompt, calls Claude, persists messages, and dispatches `capture_lead`/
  `escalate_to_human` tool calls (including the Telegram/email notification dispatch).
- `packages/db` — Prisma schema (`brands`, `pages`, `knowledge_entries`, `conversations`,
  `messages`, `leads`, `escalations`, `notification_log`, `admin_users`,
  `conversation_insights`, `insight_reports`). `pages` now has a `channel` column
  (`facebook` | `web`) — a website conversation reuses one synthetic `web`-channel `Page` row
  per brand so the existing `Conversation` uniqueness/history logic needs no special-casing.
- `packages/claude` — tool definitions, per-brand system-prompt compiler (channel-aware:
  Messenger vs web formatting rules), Claude client wrapper (thinking disabled, timeout +
  fallback model), plus separate insight-extraction and report-generation Claude calls (own
  tool definitions, not part of the chat-reply system prompt/cache).
- `packages/queue` — shared BullMQ queue name/connection used by the Facebook side of
  `apps/webhook` and `apps/worker`.

There is intentionally no custom admin UI in this scaffold — point **Directus** or **Retool**
at the Postgres database to get a working internal tool (conversation/lead viewer, knowledge
base editor) without writing a frontend. Add a hand-built `apps/admin` later only if the UX
needs outgrow a generic admin builder.

## Local setup

```bash
cp .env.example .env   # fill in real values — see "Required credentials" below
docker compose up -d   # postgres + redis
npm install
npm run db:migrate --workspace packages/db -- --name init   # first run: creates the schema
npm run db:generate
npm run db:seed        # inserts one sample brand — edit scripts/seed.ts with your real Page ID/token first
```

Run the two services in separate terminals:

```bash
npm run dev:webhook   # listens on $PORT (default 3000), exposes /webhook/facebook
npm run dev:worker    # consumes the queue, talks to Claude + Facebook
```

Expose the webhook publicly for Facebook to reach it (e.g. `ngrok http 3000` in development).

SLA monitor is a one-shot script meant to be triggered by an external scheduler (cron,
Railway Cron Job, etc.) every 1 minute — it is not a long-running process:

```bash
npm run sla:monitor
```

## Required credentials

| Variable | Where to get it |
|---|---|
| `FB_APP_SECRET` | Meta for Developers → your App → Settings → Basic |
| `FB_WEBHOOK_VERIFY_TOKEN` | Any random string you choose; enter the same value in the Messenger webhook subscription config |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `TELEGRAM_BOT_TOKEN` | Message @BotFather on Telegram, `/newbot` |
| `TELEGRAM_ENGINEERING_CHAT_ID` | Add the bot to an internal ops group, then use `getUpdates` to read the chat ID |
| `RESEND_API_KEY` | resend.com (or swap `packages/conversation-core/src/notify/email.ts` for SES/SendGrid) |

Per-brand `telegramChatId` and `notificationEmails` are configured per row in the `brands`
table (via the admin UI or seed script), not as env vars — each of the 5 brands can notify a
different sales channel.

## Facebook / Meta setup checklist

1. Create one Meta App, add the **Messenger** product.
2. Under Business Manager, generate a **System User** access token per Page (not a personal
   admin token) with `pages_messaging` — system-user tokens don't expire on the usual 60-day
   cycle.
3. Subscribe each of the 5 Pages to the App (`Page → Webhooks`, or `POST
   /{page-id}/subscribed_apps`), subscribing to the `messages` field.
4. Set the webhook URL to `https://<your-domain>/webhook/facebook` with the same verify token
   as `FB_WEBHOOK_VERIFY_TOKEN`.
5. **Submit App Review for `pages_messaging` (Advanced Access) + Business Verification early**
   — this is the longest lead-time item (1-4+ weeks). You can develop/test against a Page
   where your dev account is an admin/tester before Advanced Access is approved; real
   (non-tester) customer traffic requires it.
6. Outside the 24-hour messaging window, don't try to re-open a Messenger thread — have staff
   call the phone number captured by `capture_lead` instead.

## Human takeover

When a staff member replies to a customer directly in Meta Business Suite Inbox (no extra
integration needed), the webhook receives an "echo" event. The worker detects it's not one of
the bot's own sent messages and sets `conversations.human_muted_until = now() + 60 minutes`,
during which the bot stays silent on that conversation. Revisit Facebook's full Handover
Protocol later if this rolling mute window isn't precise enough for the sales workflow.

## Customer insight analytics & ad-targeting reports

Two more one-shot scripts, same pattern as the SLA monitor — meant to be triggered by an
external scheduler, not run as long-lived processes:

```bash
npm run insights:extract   # hourly cron recommended
npm run insights:report    # weekly cron recommended (e.g. Monday 06:00)
```

- **`insights:extract`** finds conversations idle for `CONVERSATION_IDLE_HOURS` (default 6)
  and makes one Claude tool-use call per conversation to distill it into a
  `conversation_insights` row: persona guess, needs, pain points, objections, sentiment,
  purchase intent, and a few anonymized representative quotes (never phone numbers/real
  names). Safe to re-run on a schedule — a conversation is only re-analyzed once new activity
  happens after its last insight snapshot, so no lookback window is needed, just a per-run
  batch limit (`INSIGHT_EXTRACTION_BATCH_LIMIT`).
- **`insights:report`** aggregates each active brand's `conversation_insights` from the past
  `REPORT_PERIOD_DAYS` (default 7) in plain JS — no Claude call needed just to tally
  frequencies — then makes exactly **one** Claude call per brand to turn those aggregated
  stats into a `insight_reports` row: a persona/segment summary, ranked needs and pain
  points, and ad-targeting recommendations using only parameters Meta Ads Manager actually
  exposes (age range, gender, location, interest keywords) plus messaging/creative guidance.
  Brands with zero insights that period are skipped (no empty reports).

Both tables are read-only from the app's perspective — view them the same way as `leads`/
`conversations`, by pointing Directus/Retool at the Postgres database. There's no separate
notification for reports (unlike leads/escalations); check the admin UI weekly, or wire up
`dispatchNotification` (`packages/conversation-core/src/notify/dispatch.ts`) the same way
leads/escalations do if you'd rather have a Telegram/email summary pushed automatically.

## Website chat widget

A hand-built, dependency-free embeddable widget (`apps/webhook/public/widget.js`) so any
brand's website/landing page can use the same AI reply pipeline as Messenger, with a
synchronous request/response call (no WebSocket/queue needed — the browser just waits a few
seconds for the reply in the HTTP response).

**Embed on a site:**
```html
<script src="https://<your-webhook-domain>/widget.js" data-widget-key="<brand's widgetKey>" defer></script>
```
`index.html` at the repo root already has this tag before `</body>` — replace the placeholder
domain and `data-widget-key` with the real deployed backend URL and that brand's
`Brand.widgetKey` (every brand gets one automatically via `@default(cuid())`; `npm run db:seed`
prints it).

**How it works:** the widget generates a visitor UUID (`crypto.randomUUID()`, stored in
`localStorage`) and posts `{ widgetKey, sessionId, message }` to `POST /chat/website`. That
route looks up the `Brand` by `widgetKey`, upserts a synthetic `web`-channel `Page` row for
that brand (`facebookPageId: "web:<brand-slug>"`), then reuses the exact same
`Conversation`/`Message` model and `runAiTurn()` pipeline Messenger uses — same
`capture_lead`/`escalate_to_human` tools, same leads/escalations tables, same Telegram/email
notifications (labeled `(Website)` so sales can tell the channel apart).

**No live-agent takeover for web chat** — unlike Messenger's Page Inbox mute mechanism, there's
no equivalent "human took over" signal for a browser widget in this phase. The AI always
replies; staff follow up by calling the phone number captured via `capture_lead`, same as the
existing Messenger 24-hour-window fallback.

**Security/abuse protection**, since this endpoint is reachable directly from any browser
(unlike the HMAC-signature-verified Facebook webhook): CORS is restricted to
`WEBSITE_WIDGET_ALLOWED_ORIGINS` and rate-limited per IP (`WIDGET_RATE_LIMIT_MAX` /
`WIDGET_RATE_LIMIT_WINDOW_MS`), both scoped only to `/chat/website` via Fastify plugin
encapsulation — never applied to `/webhook/facebook`. `widgetKey` itself is not a secret (it's
visible in page source, like a Stripe publishable key); it identifies the brand, it doesn't
authenticate the caller.

## Extending to all 5 brands

**Messenger:** everything routes by `pages.facebook_page_id → brands`, so adding brands 2-5 is:
insert a `Brand` row + its `KnowledgeEntry` rows + a `Page` row pointing at the new Facebook
Page ID and access token. No code changes required.

**Website widget:** since it's already parameterized by `widgetKey`, adding brand 2-5's site is:
(1) the `Brand` row already has a `widgetKey` from step above, (2) add one `<script>` tag to
that brand's site, (3) add its origin to `WEBSITE_WIDGET_ALLOWED_ORIGINS`. No code changes.
