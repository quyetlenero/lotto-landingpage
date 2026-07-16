# lotto-landingpage

Static marketing landing page for LOTTO's "Thu Cũ Đổi Mới Lotto 2026" shoe trade-in campaign
(03/07–05/08/2026). Plain HTML/CSS/vanilla JS, no build step, deployed on Netlify.

- `index.html` — the entire site (~3,300 lines, inline `<style>`/`<script>`).
- `apps-script-form-dang-ky.gs` — Google Apps Script backing the registration form (writes to
  a Google Sheet).
- Dealer list and before/after testimonial photos are loaded client-side from published Google
  Sheets (CSV), not hardcoded — see the JS in `index.html` for the sheet URLs/parsing.
- `index.html` embeds a `<script src=".../widget.js" data-widget-key="...">` tag near
  `</body>` for the AI chat widget — see "Related project" below.

## Related project: AI Messenger/website chat bot — moved to a separate repo

A Facebook Messenger + website-chat AI auto-reply system was originally built inside this
repo under `messenger-ai-bot/`, then **split out into its own repository**:
**`github.com/quyetlenero/nero-mes`** (full commit history + design docs preserved there under
`docs/`). It is **no longer part of this repo** — do not recreate `messenger-ai-bot/` here.

If asked to work on the bot (Messenger replies, lead capture, insight analytics, the chat
widget itself), that work belongs in the `nero-mes` repo, not this one. The only thing that
stays here is the one `<script>` embed tag in `index.html` — its `src` domain and
`data-widget-key` need to be updated once the bot backend is deployed and the real widget key
is known (currently placeholders: `YOUR-BACKEND-DOMAIN` / `REPLACE_WITH_BRAND_WIDGET_KEY`).

## Known content issues to fix (flagged during the bot build, not yet fixed here)

- Registration form section says staff will contact "trong vòng 60 phút", but the post-submit
  success screen says "trong vòng 24 giờ" — pick one and make them consistent.
- No public Privacy Policy page exists, despite the form collecting name + phone number. One is
  required before the Messenger bot can pass Facebook's App Review (see `nero-mes` repo's
  `docs/DEPLOYMENT_GUIDE.md`).
