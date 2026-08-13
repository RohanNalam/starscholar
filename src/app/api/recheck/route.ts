import { NextRequest, NextResponse } from "next/server";
import { verifyClaim } from "@/lib/pipeline";
import { supabaseServer } from "@/lib/supabase/server";
import type { VerifiedOpportunity } from "@/lib/types";

// Freshness engine: re-verifies the stalest directory entries so statuses stay
// honest (live links flip to expired the day they close). Call it on a
// schedule — Vercel cron, GitHub Actions, or by hand:
//   GET /api/recheck?secret=<RECHECK_SECRET>
export const maxDuration = 300;

const BATCH = 8; // per run — keeps well inside free-tier quotas

export async function GET(req: NextRequest) {
  const secret = process.env.RECHECK_SECRET;
  if (!secret || req.nextUrl.searchParams.get("secret") !== secret) {
    return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });
  }
  const supabase = await supabaseServer();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "supabase not configured" }, { status: 500 });
  }

  // Budget-aware selection (Tavily free tier = 1,000 searches/month):
  // entries whose deadline is close get re-checked daily; everything else
  // weekly. Expired entries stay archived and are never re-checked.
  const now = Date.now();
  const dayAgo = new Date(now - 864e5).toISOString();
  const weekAgo = new Date(now - 7 * 864e5).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);
  const twoWeeksOut = new Date(now + 14 * 864e5).toISOString().slice(0, 10);

  const { data: urgent, error: e1 } = await supabase
    .from("opportunities")
    .select("id, name, checked_at, result")
    .neq("status", "expired")
    .not("deadline_date", "is", null)
    .gte("deadline_date", today)
    .lte("deadline_date", twoWeeksOut)
    .lt("checked_at", dayAgo)
    .order("checked_at", { ascending: true })
    .limit(4);
  if (e1) return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });

  const { data: routine, error: e2 } = await supabase
    .from("opportunities")
    .select("id, name, checked_at, result")
    .neq("status", "expired")
    .lt("checked_at", weekAgo)
    .order("checked_at", { ascending: true })
    .limit(BATCH);
  if (e2) return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });

  const seen = new Set<string>();
  const rows = [...(urgent ?? []), ...(routine ?? [])]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .slice(0, BATCH);

  const todayISO = new Date().toISOString().slice(0, 10);
  const summary: { name: string; before?: string; after?: string; error?: string }[] = [];

  for (const row of rows ?? []) {
    const prev = row.result as VerifiedOpportunity;
    const claimed = prev.claimed;
    if (!claimed?.search_query) continue;
    try {
      const { verification: v, sources } = await verifyClaim(claimed, null, todayISO);
      if (!v) {
        summary.push({ name: row.name, error: "no readable pages" });
        continue;
      }
      const updated: VerifiedOpportunity = {
        claimed,
        verification: v,
        sources,
      };
      await supabase
        .from("opportunities")
        .update({
          status: v.status,
          deadline: v.deadline,
          deadline_date: v.deadline_iso,
          result: updated,
          checked_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      summary.push({
        name: row.name,
        before: (row.result as VerifiedOpportunity).verification?.status,
        after: v.status,
      });
    } catch (e) {
      summary.push({ name: row.name, error: e instanceof Error ? e.message.slice(0, 120) : "?" });
    }
  }

  return NextResponse.json({ ok: true, rechecked: summary.length, summary });
}
