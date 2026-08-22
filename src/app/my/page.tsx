"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ResultCard, STATUS_STYLES } from "@/components/result-card";
import type { CardData } from "@/lib/types";

type SavedLookup = {
  id: string;
  video_url: string;
  result: CardData;
  status: string | null;
  type: string | null;
  name: string | null;
  organization: string | null;
  deadline: string | null;
  created_at: string;
};

export default function MyListPage() {
  const supabase = supabaseBrowser();
  const [state, setState] = useState<"loading" | "unconfigured" | "signedout" | "ready">(
    "loading"
  );
  const [items, setItems] = useState<SavedLookup[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) {
      setState("unconfigured");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setState("signedout");
      return;
    }
    // Auto-cleanup: saves whose deadline has passed delete themselves.
    // RLS guarantees this only ever touches the signed-in user's own rows.
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("lookups").delete().not("deadline_date", "is", null).lt("deadline_date", today);
    const { data } = await supabase
      .from("lookups")
      .select("*")
      .order("created_at", { ascending: false });
    setItems((data as SavedLookup[]) ?? []);
    setState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (!supabase) return;
    await supabase.from("lookups").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold opacity-70 hover:opacity-100">
          ★ StarScholar
        </Link>
      </div>

      <h1 className="text-3xl font-bold">My List</h1>
      <p className="mt-1 text-sm opacity-70">
        Anything you look up while signed in gets saved here. Only you can see it.
      </p>

      <div className="mt-8">
        {state === "loading" && <p className="opacity-60">Loading…</p>}

        {state === "unconfigured" && (
          <div className="rounded-2xl border border-black/10 p-5 text-sm opacity-70 dark:border-white/15">
            Accounts aren&apos;t set up yet, the site owner needs to add Supabase keys to{" "}
            <code>.env.local</code>.
          </div>
        )}

        {state === "signedout" && (
          <div className="rounded-2xl border border-black/10 p-5 text-sm dark:border-white/15">
            <p>
              <Link href="/login" className="font-semibold underline">
                Sign in
              </Link>{" "}
              to start saving your lookups. Everything you check gets stored privately so you can
              come back to it without hunting down the video again.
            </p>
          </div>
        )}

        {state === "ready" && items.length === 0 && (
          <div className="rounded-2xl border border-black/10 p-5 text-sm opacity-70 dark:border-white/15">
            Nothing saved yet.{" "}
            <Link href="/" className="underline">
              Check your first video
            </Link>{" "}
           , it&apos;ll show up here automatically.
          </div>
        )}

        {state === "ready" && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((item) => {
              const s = STATUS_STYLES[item.status ?? ""] ?? STATUS_STYLES.unverified;
              const open = openId === item.id;
              return (
                <li
                  key={item.id}
                  className="rounded-2xl border border-black/10 dark:border-white/15"
                >
                  <button
                    onClick={() => setOpenId(open ? null : item.id)}
                    className="flex w-full items-center gap-3 p-4 text-left"
                  >
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${s.badge}`}>
                      {s.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {item.name ?? "Unknown opportunity"}
                      </span>
                      <span className="block truncate text-xs opacity-60">
                        {[item.organization, item.type?.replace("_", " "), item.deadline && `due ${item.deadline}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs opacity-50">{open ? "▲" : "▼"}</span>
                  </button>

                  {open && (
                    <div className="border-t border-black/10 p-4 dark:border-white/15">
                      <ResultCard r={item.result} />
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <a
                          href={item.video_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline opacity-60 hover:opacity-100"
                        >
                          Original video
                        </a>
                        <button
                          onClick={() => void remove(item.id)}
                          className="text-red-600 underline opacity-70 hover:opacity-100 dark:text-red-400"
                        >
                          Remove from My List
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
