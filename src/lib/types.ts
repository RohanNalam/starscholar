import { z } from "zod";

// ── Step 1: what Claude extracts from the video ─────────────────────────────
// A video often lists SEVERAL opportunities ("5 internships you need!") — we
// extract every one. Unknown fields are null: never a guess.
export const ExtractedOpportunitySchema = z.object({
  type: z
    .enum(["scholarship", "internship", "job", "summer_program", "fellowship", "other"])
    .describe("The kind of opportunity"),
  organization: z.string().nullable().describe("Organization offering it, e.g. 'Google'"),
  program_name: z.string().nullable().describe("Official program name, e.g. 'STEP Internship'"),
  claimed_deadline: z
    .string()
    .nullable()
    .describe("Deadline as claimed in the video for THIS opportunity, verbatim"),
  claimed_award: z
    .string()
    .nullable()
    .describe("Award amount / pay / benefit as claimed in the video"),
  claimed_eligibility: z
    .string()
    .nullable()
    .describe("Eligibility criteria as claimed in the video"),
  search_query: z
    .string()
    .describe(
      "The best Google search query to find the OFFICIAL page for this specific opportunity. ALWAYS include the offering organization's name when it is known — 'Artificial Intelligence Fundamentals' finds nothing useful, 'IBM SkillsBuild Artificial Intelligence Fundamentals' finds the real page. e.g. 'Google STEP internship 2026 application'"
    ),
  mentioned_url: z
    .string()
    .nullable()
    .describe(
      "A website address the video or caption explicitly shows on screen, says aloud, or links for this opportunity (e.g. 'stardance.hackclub.com'), normalized to start with https://. Null if none is shown."
    ),
});
export type ExtractedOpportunity = z.infer<typeof ExtractedOpportunitySchema>;

export const ExtractionSchema = z.object({
  is_opportunity: z
    .boolean()
    .describe(
      "True if the video mentions at least one specific scholarship, internship, job, summer program, fellowship, course, or similar opportunity"
    ),
  opportunities: z
    .array(ExtractedOpportunitySchema)
    .describe(
      "EVERY distinct opportunity the video mentions, one entry each, in the order presented. Empty if the video isn't about opportunities. Only include ones identifiable enough to search for."
    ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// ── Step 2: what Claude produces after reading the official pages ───────────
export const VerificationSchema = z.object({
  status: z
    .enum(["verified", "exaggerated", "expired", "unverified"])
    .describe(
      "verified: official page found and video claims match. exaggerated: official page found but the video omitted or overstated something important. expired: the application is closed or the cited cycle has passed. unverified: could not find or confirm an official page."
    ),
  status_reason: z.string().describe("One-sentence plain-English explanation of the status"),
  name: z.string().describe("Official program name"),
  organization: z.string().describe("Organization offering it"),
  type: z.enum(["scholarship", "internship", "job", "summer_program", "fellowship", "other"]),
  official_info_url: z
    .string()
    .nullable()
    .describe("URL of the official information page, from the search results only"),
  direct_application_url: z
    .string()
    .nullable()
    .describe(
      "The deepest application link found in the page text (application portal, form, or 'apply' URL). Null if not present in the scraped text."
    ),
  deadline: z
    .string()
    .nullable()
    .describe("Application deadline as stated on the OFFICIAL page, or null if not stated"),
  deadline_iso: z
    .string()
    .nullable()
    .describe(
      "The same deadline as an ISO date, format YYYY-MM-DD, only if the official page states an unambiguous date. Null otherwise — never guess the year."
    ),
  eligibility: z
    .array(z.string())
    .describe("Eligibility requirements from the official page, one per item"),
  details: z
    .array(
      z.object({
        label: z.string().describe("e.g. 'Award amount', 'Pay', 'Program dates', 'Cost'"),
        value: z.string(),
      })
    )
    .describe(
      "Type-specific facts from the official page: scholarships → award amount, GPA, essays, rec letters; internships → pay, duration, class year, majors; summer programs → cost, dates, residential/commuter, age range; jobs → salary, qualifications. Only include facts actually stated in the scraped text."
    ),
  application_steps: z
    .array(z.string())
    .describe(
      "Ordered, actionable steps to actually apply, derived from the official page text. Empty if the page text doesn't describe the process."
    ),
  discrepancies: z
    .array(z.string())
    .describe(
      "Ways the video's claims differ from the official page (wrong deadline, omitted requirement, inflated award). Empty if none."
    ),
});
export type Verification = z.infer<typeof VerificationSchema>;

// ── What the API returns to the frontend ────────────────────────────────────
// Exactly what the ResultCard component needs to render one opportunity.
// Saved My List rows store this shape (older rows carry extra fields — fine).
export type CardData = {
  verification: Verification;
  sources: { title: string; url: string }[];
  checkedAt: string; // ISO date — "we verified this on ..."
};

export type VerifiedOpportunity = {
  claimed: ExtractedOpportunity;
  verification: Verification | null; // null when search/verification failed for this one
  sources: { title: string; url: string }[];
  saved?: boolean; // stored to the signed-in user's My List
};

export type CheckResult = {
  ok: true;
  videoUrl: string;
  platform: string;
  caption: string | null;
  author: string | null;
  checkedAt: string;
  analyzedWith?: string; // which rung identified it (video / caption / cover image)
  opportunities: VerifiedOpportunity[]; // empty → not an opportunity video
};

export type CheckError = {
  ok: false;
  error: string;
  needsCaption?: boolean; // true when we couldn't read the video — ask the user to paste the caption
};

// ── Streaming ───────────────────────────────────────────────────────────────
// Verifying five opportunities takes far longer than identifying them, so the
// lookup is streamed as newline-delimited JSON: the video's opportunities are
// named as soon as they're extracted, then each card fills in as its own
// verification lands. Buffered callers replay the same events into one object.
export type CheckEvent =
  | { type: "error"; error: string; needsCaption?: boolean; status: number }
  // everything known before verification starts; `claimed` drives the placeholders
  | { type: "meta"; result: CheckResult; claimed: ExtractedOpportunity[] }
  | { type: "opportunity"; index: number; data: VerifiedOpportunity }
  | { type: "done"; result: CheckResult };
