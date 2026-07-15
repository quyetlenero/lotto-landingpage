import Fastify from "fastify";
import { registerFacebookWebhookRoutes } from "./routes/facebook.js";

const app = Fastify({ logger: true });

// Capture the raw request body so verifyFacebookSignature can HMAC the exact bytes Facebook
// signed — re-serializing the parsed JSON would not reliably match the original signature.
app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  (req as { rawBody?: Buffer }).rawBody = body as Buffer;
  try {
    done(null, JSON.parse((body as Buffer).toString("utf8")));
  } catch (err) {
    done(err as Error, undefined);
  }
});

registerFacebookWebhookRoutes(app);

app.get("/healthz", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`webhook listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
