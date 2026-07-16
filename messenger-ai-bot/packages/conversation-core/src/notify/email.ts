/** Minimal Resend wrapper — swap for SES/SendGrid by changing only this file. */
export async function sendNotificationEmail(
  to: string[],
  subject: string,
  text: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / NOTIFICATION_EMAIL_FROM not configured");
  if (to.length === 0) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend send error ${res.status}: ${body}`);
  }
}
