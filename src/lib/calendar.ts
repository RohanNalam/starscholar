// Turns a verified opportunity's deadline into a calendar event.
//
// Deadlines are the whole point of the product, but a card someone reads once
// and closes is a deadline they will miss. Both exports below only work from
// `deadline_iso`, the field the verifier fills in *only* when the official page
// states an unambiguous date, so we never put a guessed date in someone's
// calendar.
import type { Verification } from "./types";

// All-day events are half-open: an event on Sept 30 runs 20260930 → 20261001.
function isoToStamp(iso: string): string {
  return iso.replace(/-/g, "");
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return isoToStamp(d.toISOString().slice(0, 10));
}

function eventTitle(v: Verification): string {
  // Program names often already carry the org ("Hack Club Stardance Challenge"),
  // and "… (Hack Club)" on the end just eats room in a calendar cell.
  const org = v.organization?.trim();
  const redundant =
    !org || v.name.toLowerCase().includes(org.toLowerCase());
  return `Deadline: ${v.name}${redundant ? "" : ` (${org})`}`;
}

// What someone needs in hand when the reminder fires: where to apply, what the
// video got wrong, and the fact that we checked rather than guessed.
function eventDetails(v: Verification, sourceUrl?: string): string {
  const lines: string[] = [];
  const applyUrl = v.direct_application_url ?? v.official_info_url;
  if (applyUrl) lines.push(`Apply: ${applyUrl}`);
  if (v.deadline) lines.push(`Deadline as stated: ${v.deadline}`);
  if (v.eligibility.length > 0) lines.push("", "Eligibility:", ...v.eligibility.map((e) => `• ${e}`));
  if (v.application_steps.length > 0) {
    lines.push("", "How to apply:", ...v.application_steps.map((s, i) => `${i + 1}. ${s}`));
  }
  if (v.discrepancies.length > 0) {
    lines.push("", "What the video got wrong:", ...v.discrepancies.map((d) => `• ${d}`));
  }
  if (sourceUrl) lines.push("", `Verified by StarScholar: ${sourceUrl}`);
  return lines.join("\n");
}

export function canAddToCalendar(v: Verification): boolean {
  // A closed opportunity is not worth a calendar entry.
  return Boolean(v.deadline_iso) && v.status !== "expired";
}

export function googleCalendarUrl(v: Verification, sourceUrl?: string): string | null {
  if (!canAddToCalendar(v)) return null;
  const iso = v.deadline_iso!;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: eventTitle(v),
    dates: `${isoToStamp(iso)}/${dayAfter(iso)}`,
    details: eventDetails(v, sourceUrl),
  });
  const location = v.direct_application_url ?? v.official_info_url;
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// RFC 5545 escaping: backslash first, or it would double-escape the others.
function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Lines must be =<75 octets; continuations start with a single space.
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const chunks = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    chunks.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  if (rest) chunks.push(` ${rest}`);
  return chunks.join("\r\n");
}

export function icsForOpportunity(v: Verification, sourceUrl?: string): string | null {
  if (!canAddToCalendar(v)) return null;
  const iso = v.deadline_iso!;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `${isoToStamp(iso)}-${v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}@starscholar`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StarScholar//Opportunity Deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${isoToStamp(iso)}`,
    `DTEND;VALUE=DATE:${dayAfter(iso)}`,
    `SUMMARY:${escapeICS(eventTitle(v))}`,
    `DESCRIPTION:${escapeICS(eventDetails(v, sourceUrl))}`,
  ];
  const url = v.direct_application_url ?? v.official_info_url;
  if (url) lines.push(`URL:${escapeICS(url)}`);
  lines.push(
    // Two nudges: a week out to start the essays, the day before to submit.
    "BEGIN:VALARM",
    "TRIGGER:-P7D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeICS(`${v.name} closes in a week`)}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeICS(`${v.name} closes tomorrow`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  );
  return lines.map(foldLine).join("\r\n");
}

export function icsFilename(v: Verification): string {
  const slug = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  return `${slug || "opportunity"}-deadline.ics`;
}
