import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { registerFacebookWebhookRoutes } from "./routes/facebook.js";
import { registerWebsiteChatRoutes } from "./routes/website.js";

const app = Fastify({ logger: true });

// Capture the raw request body so verifyFacebookSignature can HMAC the exact bytes Facebook
// signed — re-serializing the parsed JSON would not reliably match the original signature.
// Still hands Fastify a normally-parsed request.body for every other route (including
// /chat/website), so no changes are needed here for the website route to work.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  (req as { rawBody?: Buffer }).rawBody = body as Buffer;
  try {
    done(null, JSON.parse((body as Buffer).toString("utf8")));
  } catch (err) {
    done(err as Error, undefined);
  }
});

registerFacebookWebhookRoutes(app);
registerWebsiteChatRoutes(app);

// Serves apps/webhook/public/widget.js at GET /widget.js — keeps the embeddable widget
// version-locked to the same deploy as the API it calls, no separate static host needed.
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
app.register(fastifyStatic, { root: publicDir });

app.get("/healthz", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`webhook listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
