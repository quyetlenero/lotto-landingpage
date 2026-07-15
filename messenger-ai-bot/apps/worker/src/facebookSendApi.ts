const GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION ?? "v21.0";

/**
 * Sends one text message via the Messenger Send API. Runs as its own step, decoupled from
 * webhook ack (see apps/webhook) — this is the only place actual customer-facing latency is
 * spent, so callers should call this as soon as Claude returns text, not after every side
 * effect (DB writes/notifications can happen after the customer already has their reply).
 */
export async function sendMessengerText(
  pageAccessToken: string,
  psid: string,
  text: string,
): Promise<{ message_id: string }> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(
    pageAccessToken,
  )}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      message: { text },
      messaging_type: "RESPONSE",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook Send API error ${res.status}: ${body}`);
  }

  return (await res.json()) as { message_id: string };
}
