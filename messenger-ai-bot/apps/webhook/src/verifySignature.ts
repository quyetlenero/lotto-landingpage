import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Facebook's `X-Hub-Signature-256` header against the raw request body using the
 * App Secret. Must run against the *raw* bytes before JSON parsing — Fastify's rawBody is
 * captured via the addContentTypeParser hook in index.ts for this reason.
 */
export function verifyFacebookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
