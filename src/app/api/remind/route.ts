import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  sendEmail,
  emailConfigured,
  reminderSubject,
  reminderBody,
  type DueItem,
} from "@/lib/email";
import type { CardData } from "@/lib/types";

// Deadline reminders + expiry cleanup for every user's saved list.
// Run daily:  GET /api/remind?secret=<RECHECK_SECRET>
// Add &dry=1 to preview without sending or writing anything.
export const maxDuration = 120;

// Someone is nudged a week out (time to write essays and ask for recs) and
// again the day before. A row is only ever reminded once per milestone.
const MILESTONES = [7, 1] as const;

function milestoneFor(daysLeft: number): number | null {
  for (const m of [...MILESTONES].sort((a, b) => a - b)) {
    if (daysLeft <= m) return m;
  }
  return null;
}

type LookupRow = {
  id: string;
  user_id: string;
  video_url: string;
  name: string | null;
  organization: string | null;
  deadline: string | null;
  deadline_date: string;
  reminder_stage: number | null;
  result: CardData;
};

function daysBetween(todayISO: string, deadlineISO: string): number {
  const a = Date.parse(`${todayISO}T00:00:00Z`);
  const b = Date.parse(`${deadlineISO}T00:00:00Z`);
  return Math.round((b - a) / 864e5);
}

export async function GET(req: NextRequest) {
  const secret = process.env.RECHECK_SECRET;
  if (!secret || req.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";

  const supabase = supabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Reminders need SUPABASE_SERVICE_ROLE_KEY in the environment, a scheduled job has no signed-in user, so row-level security hides every row from the anon key.",
      },
      { status: 500 }
    );
  }

  const todayISO = new Date().toISOString().slice(0, 10);

  // 1. Expired saves are removed. The app already cleans these up when someone
  //    opens My List, but that never fires for users who don't visit, so the
  //    schedule is what actually guarantees a passed deadline disappears.
  let purged = 0;
  if (!dryRun) {
    const { data: gone, error } = await supabase
      .from("lookups")
      .delete()
      .lt("deadline_date", todayISO)
      .not("deadline_date", "is", null)
      .select("id");
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    purged = gone?.length ?? 0;
  } else {
    const { count } = await supabase
      .from("lookups")
      .select("id", { count: "exact", head: true })
      .lt("deadline_date", todayISO)
      .not("deadline_date", "is", null);
    purged = count ?? 0;
  }

  // 2. Everything still open and inside the widest reminder window.
  const horizon = new Date(Date.now() + Math.max(...MILESTONES) * 864e5)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabase
    .from("lookups")
    .select("id,user_id,video_url,name,organization,deadline,deadline_date,reminder_stage,result")
    .not("deadline_date", "is", null)
    .gte("deadline_date", todayISO)
    .lte("deadline_date", horizon);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // 3. Keep only rows that have crossed a milestone they haven't been told about.
  const byUser = new Map<string, { items: DueItem[]; rowIds: { id: string; stage: number }[] }>();
  for (const row of (data ?? []) as LookupRow[]) {
    const daysLeft = daysBetween(todayISO, row.deadline_date);
    const milestone = milestoneFor(daysLeft);
    if (milestone === null) continue;
    // reminder_stage holds the last milestone sent; a smaller one is newer news
    if (row.reminder_stage !== null && row.reminder_stage <= milestone) continue;

    const v = row.result?.verification;
    const entry = byUser.get(row.user_id) ?? { items: [], rowIds: [] };
    entry.items.push({
      name: row.name ?? v?.name ?? "Saved opportunity",
      organization: row.organization ?? v?.organization ?? null,
      deadline: row.deadline,
      deadlineISO: row.deadline_date,
      daysLeft,
      applyUrl: v?.direct_application_url ?? v?.official_info_url ?? null,
      videoUrl: row.video_url,
    });
    entry.rowIds.push({ id: row.id, stage: milestone });
    byUser.set(row.user_id, entry);
  }

  // 4. One digest per user, then mark those rows so they aren't re-sent daily.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
  const report: { user: string; items: number; subject: string; result: string }[] = [];

  for (const [userId, { items, rowIds }] of byUser) {
    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(userId);
    const to = userData?.user?.email;
    if (userErr || !to) {
      report.push({ user: userId, items: items.length, subject: "-", result: "no email on account" });
      continue;
    }

    const subject = reminderSubject(items);
    const { html, text } = reminderBody(items, siteUrl);

    if (dryRun) {
      report.push({ user: to, items: items.length, subject, result: "dry run, not sent" });
      continue;
    }

    const sent = await sendEmail({ to, subject, html, text });
    report.push({
      user: to,
      items: items.length,
      subject,
      result: sent.sent ? "sent" : (sent.error ?? sent.skipped ?? "not sent"),
    });

    // Only record the milestone once it actually went out, so a delivery
    // failure retries tomorrow instead of silently swallowing the reminder.
    if (sent.sent) {
      for (const { id, stage } of rowIds) {
        await supabase.from("lookups").update({ reminder_stage: stage }).eq("id", id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    emailConfigured: emailConfigured(),
    expiredRemoved: purged,
    usersNotified: report.length,
    report,
  });
}
