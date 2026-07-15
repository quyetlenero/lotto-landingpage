# Messenger AI Auto-Reply Bot

Multi-brand Facebook Messenger auto-reply system. One shared webhook + worker pipeline
serves multiple Pages (one per brand), replying via Claude within seconds, capturing leads
(phone numbers), and escalating to a human via Telegram/email when needed.

See `/root/.claude/plans/t-i-c-1-v-n-abstract-alpaca.md` (or the plan shared in chat) for the
full design rationale. This README covers day-to-day setup.

## Architecture

```
Facebook Messenger → apps/webhook (Fastify, ack <300ms) → Redis queue (BullMQ)
                                                                   │
                                                                   ▼
                                              apps/worker → Claude API (tool-use)
                                                          → Facebook Send API
                                                          → Postgres (packages/db)
                                                          → Telegram/Email notifications
```

- `apps/webhook` — verifies Facebook's signature, enqueues one job per inbound message, acks
  immediately. Never calls Claude or the Send API directly (see plan: ack/process split).
- `apps/worker` — the actual pipeline: loads brand config by Page ID, calls Claude with a
  compiled per-brand system prompt + conversation history, executes `capture_lead` /
  `escalate_to_human` tool calls, replies via the Send API, persists everything, fires
  notifications.
- `packages/db` — Prisma schema (`brands`, `pages`, `knowledge_entries`, `conversations`,
  `messages`, `leads`, `escalations`, `notification_log`, `admin_users`).
- `packages/claude` — tool definitions, per-brand system-prompt compiler, Claude client
  wrapper (thinking disabled, timeout + fallback model).
- `packages/queue` — shared BullMQ queue name/connection used by both webhook and worker.

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
| `RESEND_API_KEY` | resend.com (or swap `apps/worker/src/notify/email.ts` for SES/SendGrid) |

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

## Extending to all 5 brands

Everything routes by `pages.facebook_page_id → brands`, so adding brands 2-5 is:
insert a `Brand` row + its `KnowledgeEntry` rows + a `Page` row pointing at the new Facebook
Page ID and access token. No code changes required.
