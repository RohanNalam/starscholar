import type { CardData } from "@/lib/types";
import { AddToCalendar } from "./add-to-calendar";

export const STATUS_STYLES: Record<string, { badge: string; label: string; emoji: string }> = {
  verified: {
    badge: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    label: "Verified",
    emoji: "🟢",
  },
  exaggerated: {
    badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    label: "Exaggerated",
    emoji: "🟡",
  },
  expired: {
    badge: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    label: "Expired / Closed",
    emoji: "🔴",
  },
  unverified: {
    badge: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    label: "Unverified",
    emoji: "⚪",
  },
};

export function ResultCard({ r }: { r: CardData }) {
  const v = r.verification;
  const s = STATUS_STYLES[v.status] ?? STATUS_STYLES.unverified;
  const checked = new Date(r.checkedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/15">
      <div className="border-b border-black/10 p-6 dark:border-white/15">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.badge}`}>
            {s.emoji} {s.label}
          </span>
          <span className="rounded-full bg-black/5 px-3 py-1 text-xs font-medium capitalize dark:bg-white/10">
            {v.type.replace("_", " ")}
          </span>
        </div>
        <h1 className="text-2xl font-bold">{v.name}</h1>
        <p className="opacity-70">{v.organization}</p>
        <p className="mt-2 text-sm opacity-60">{v.status_reason}</p>
      </div>

      <div className="grid gap-6 p-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-50">
            Deadline
          </h2>
          <p className="text-lg font-medium">
            {v.deadline ?? "Not listed, check the official page"}
          </p>
          <AddToCalendar v={v} />
        </div>
        <div>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-50">Links</h2>
          <div className="flex flex-col gap-1 text-sm">
            {v.direct_application_url && (
              <a
                href={v.direct_application_url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-blue-600 underline dark:text-blue-400"
              >
                → Direct application link
              </a>
            )}
            {v.official_info_url && (
              <a
                href={v.official_info_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline dark:text-blue-400"
              >
                Official info page
              </a>
            )}
            {!v.direct_application_url && !v.official_info_url && (
              <span className="opacity-60">No official link found</span>
            )}
          </div>
        </div>
      </div>

      {v.details.length > 0 && (
        <Section title="Details">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {v.details.map((d, i) => (
              <div key={`${i}-${d.label}`} className="text-sm">
                <dt className="font-medium opacity-60">{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {v.eligibility.length > 0 && (
        <Section title="Eligibility">
          <ul className="list-inside list-disc space-y-1 text-sm">
            {v.eligibility.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Section>
      )}

      {v.application_steps.length > 0 && (
        <Section title="How to apply">
          <ol className="list-inside list-decimal space-y-2 text-sm">
            {v.application_steps.map((stepText, i) => (
              <li key={i}>{stepText}</li>
            ))}
          </ol>
        </Section>
      )}

      {v.discrepancies.length > 0 && (
        <Section title="⚠️ What the video got wrong or left out">
          <ul className="list-inside list-disc space-y-1 text-sm text-yellow-800 dark:text-yellow-300">
            {v.discrepancies.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Section>
      )}

      <div className="border-t border-black/10 p-6 text-xs opacity-50 dark:border-white/15">
        <p>
          Verified against{" "}
          {r.sources.map((src, i) => (
            <span key={src.url}>
              {i > 0 && ", "}
              <a href={src.url} target="_blank" rel="noopener noreferrer" className="underline">
                {new URL(src.url).hostname}
              </a>
            </span>
          ))}{" "}
          on {checked}. Worth confirming on their site before you apply.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-black/10 p-6 dark:border-white/15">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide opacity-50">{title}</h2>
      {children}
    </div>
  );
}
