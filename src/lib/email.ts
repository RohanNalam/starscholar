import "server-only";

// Email delivery for deadline reminders.
//
// Uses Resend (free tier: 3,000/month, no card). Without RESEND_API_KEY the
// whole reminder pipeline still runs and reports exactly what it *would* have
// sent, so the schedule, the queries and the copy can all be verified before
// signing up for anything.
export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendResult = { sent: boolean; skipped?: string; error?: string };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[remind] DRY RUN, would email ${email.to}: ${email.subject}`);
    return { sent: false, skipped: "no RESEND_API_KEY, dry run" };
  }
  // Resend only delivers to arbitrary recipients from a verified domain. Until
  // one is set up, onboarding@resend.dev works but only to your own address.
  const from = process.env.REMINDER_FROM || "StarScholar <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { sent: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message.slice(0, 200) : "send failed" };
  }
}

// ── The reminder itself ─────────────────────────────────────────────────────
export type DueItem = {
  name: string;
  organization: string | null;
  deadline: string | null;
  deadlineISO: string;
  daysLeft: number;
  applyUrl: string | null;
  videoUrl: string;
};

function urgency(daysLeft: number): string {
  if (daysLeft <= 0) return "closes today";
  if (daysLeft === 1) return "closes tomorrow";
  return `closes in ${daysLeft} days`;
}

export function reminderSubject(items: DueItem[]): string {
  const soonest = items.reduce((a, b) => (a.daysLeft <= b.daysLeft ? a : b));
  if (items.length === 1) return `${soonest.name} ${urgency(soonest.daysLeft)}`;
  return `${soonest.name} ${urgency(soonest.daysLeft)}, plus ${items.length - 1} more`;
}

export function reminderBody(items: DueItem[], siteUrl: string): { html: string; text: string } {
  const sorted = [...items].sort((a, b) => a.daysLeft - b.daysLeft);

  const text = [
    "Deadlines coming up on your StarScholar list:",
    "",
    ...sorted.flatMap((i) => [
      `${i.name}${i.organization ? ` (${i.organization})` : ""}`,
      `  ${urgency(i.daysLeft)} (${i.deadline ?? i.deadlineISO})`,
      i.applyUrl ? `  Apply: ${i.applyUrl}` : "  No application link found, check the official page",
      "",
    ]),
    `Your full list: ${siteUrl}/my`,
  ].join("\n");

  const rows = sorted
    .map(
      (i) => `
      <tr><td style="padding:14px 0;border-bottom:1px solid #e5e5e5">
        <div style="font-size:16px;font-weight:600;color:#111">${escapeHtml(i.name)}</div>
        ${i.organization ? `<div style="font-size:13px;color:#666">${escapeHtml(i.organization)}</div>` : ""}
        <div style="font-size:14px;color:${i.daysLeft <= 1 ? "#b91c1c" : "#a16207"};font-weight:600;margin-top:4px">
          ${urgency(i.daysLeft)} &middot; ${escapeHtml(i.deadline ?? i.deadlineISO)}
        </div>
        ${
          i.applyUrl
            ? `<a href="${escapeHtml(i.applyUrl)}" style="display:inline-block;margin-top:8px;font-size:14px;color:#1d4ed8">Apply now &rarr;</a>`
            : `<div style="margin-top:8px;font-size:13px;color:#666">No direct link found, check the official page.</div>`
        }
      </td></tr>`
    )
    .join("");

  const html = `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <div style="font-size:14px;font-weight:700;color:#111">&#9733; StarScholar</div>
      <h1 style="font-size:20px;color:#111;margin:16px 0 4px">Deadlines coming up</h1>
      <p style="font-size:14px;color:#666;margin:0 0 8px">From the opportunities you saved.</p>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <p style="font-size:13px;color:#666;margin-top:24px">
        <a href="${escapeHtml(siteUrl)}/my" style="color:#1d4ed8">See your full list</a>
      </p>
      <p style="font-size:12px;color:#999;margin-top:16px">
        We read these dates off each program's official page, but they do change.
        Always confirm on the official site before you apply.
      </p>
    </div></body></html>`;

  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
