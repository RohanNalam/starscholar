"use client";

import { useState } from "react";
import type { Verification } from "@/lib/types";
import { canAddToCalendar, googleCalendarUrl, icsForOpportunity, icsFilename } from "@/lib/calendar";

// Its own client component because ResultCard is rendered from a server
// component on /o/[id], the .ics download needs a click handler, which a
// server component can't carry.
export function AddToCalendar({ v, sourceUrl }: { v: Verification; sourceUrl?: string }) {
  const [saved, setSaved] = useState(false);
  if (!canAddToCalendar(v)) return null;

  const google = googleCalendarUrl(v, sourceUrl);

  const downloadICS = () => {
    const ics = icsForOpportunity(v, sourceUrl);
    if (!ics) return;
    // text/calendar makes phones offer "Add to Calendar" instead of saving a file
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = icsFilename(v);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
    setSaved(true);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {google && (
        <a
          href={google}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          <span aria-hidden="true">📅 </span>Add to Google Calendar
        </a>
      )}
      <button
        type="button"
        onClick={downloadICS}
        className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      >
        <span aria-hidden="true">🍎 </span>Apple / Outlook (.ics)
      </button>
      <span role="status" aria-live="polite" className="text-xs text-green-700 dark:text-green-400">
        {saved ? "Downloaded. Open it to add the reminder." : ""}
      </span>
    </div>
  );
}
