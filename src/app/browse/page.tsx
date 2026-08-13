"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { STATUS_STYLES } from "@/components/result-card";
import { AuthNav } from "@/components/auth-nav";

type Row = {
  id: string;
  name: string;
  organization: string | null;
  type: string | null;
  status: string | null;
  deadline: string | null;
  deadline_date: string | null;
  checked_at: string;
};

function countdown(deadlineDate: string | null): { label: string; urgent: boolean } | null {
  if (!deadlineDate) return null;
  const days = Math.ceil((new Date(deadlineDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: "closed", urgent: false };
  if (days === 0) return { label: "closes today!", urgent: true };
  if (days === 1) return { label: "1 day left", urgent: true };
  return { label: `${days} days left`, urgent: days <= 7 };
}

export default function BrowsePage() {
  const supabase = supabaseBrowser();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showExpired, setShowExpired] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setError("The directory needs Supabase configured.");
      return;
    }
    supabase
      .from("opportunities")
      .select("id,name,organization,type,status,deadline,deadline_date,checked_at")
      .order("deadline_date", { ascending: true, nullsFirst: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) {
          setError(
            "Couldn't load the directory — has supabase/schema.sql been run in the SQL Editor?"
          );
        } else {
          setRows(data ?? []);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showExpired && (r.status === "expired" || countdown(r.deadline_date)?.label === "closed"))
        return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (
        needle &&
        !`${r.name} ${r.organization ?? ""} ${r.type ?? ""}`.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [rows, q, typeFilter, showExpired]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold opacity-70 hover:opacity-100">
          ★ StarScholar
        </Link>
        <AuthNav />
      </div>

      <h1 className="text-3xl font-bold">Browse opportunities</h1>
      <p className="mt-1 text-sm opacity-70">
        Every opportunity anyone has ever checked — verified against official sources, sorted by
        deadline. It grows with every lookup.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search programs or organizations…"
          className="min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:bg-black dark:focus:border-white/50"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm dark:border-white/20 dark:bg-black"
        >
          <option value="all">All types</option>
          <option value="scholarship">Scholarships</option>
          <option value="internship">Internships</option>
          <option value="summer_program">Summer programs</option>
          <option value="fellowship">Fellowships</option>
          <option value="job">Jobs</option>
          <option value="other">Other</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs opacity-70">
          <input
            type="checkbox"
            checked={showExpired}
            onChange={(e) => setShowExpired(e.target.checked)}
          />
          show expired
        </label>
      </div>

      <div className="mt-6">
        {error && (
          <div className="rounded-2xl border border-black/10 p-5 text-sm opacity-70 dark:border-white/15">
            {error}
          </div>
        )}
        {!error && rows === null && <p className="text-sm opacity-60">Loading…</p>}
        {!error && rows !== null && filtered.length === 0 && (
          <div className="rounded-2xl border border-black/10 p-5 text-sm opacity-70 dark:border-white/15">
            {rows.length === 0 ? (
              <>
                Nothing here yet — the directory fills up as people check videos.{" "}
                <Link href="/" className="underline">
                  Check the first one.
                </Link>
              </>
            ) : (
              "No matches for that filter."
            )}
          </div>
        )}
        {!error && filtered.length > 0 && (
          <ul className="space-y-2">
            {filtered.map((r) => {
              const s = STATUS_STYLES[r.status ?? ""] ?? STATUS_STYLES.unverified;
              const cd = countdown(r.deadline_date);
              return (
                <li key={r.id}>
                  <Link
                    href={`/o/${r.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-black/10 p-4 transition-colors hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
                  >
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${s.badge}`}
                    >
                      {s.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.name}</span>
                      <span className="block truncate text-xs opacity-60">
                        {[r.organization, r.type?.replace("_", " ")].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      {r.deadline ? (
                        <>
                          <span className="block opacity-70">{r.deadline}</span>
                          {cd && (
                            <span
                              className={
                                cd.urgent
                                  ? "font-semibold text-red-600 dark:text-red-400"
                                  : "opacity-50"
                              }
                            >
                              {cd.label}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="opacity-50">no deadline listed</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
