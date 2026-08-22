// Smoke test: does the GEMINI_API_KEY work, and in which mode?
// Run with: node --env-file=.env.local scripts/smoke-gemini.mjs
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY missing from .env.local");
  process.exit(1);
}

const schema = z.object({
  is_opportunity: z.boolean(),
  type: z
    .enum(["scholarship", "internship", "job", "summer_program", "fellowship", "other"])
    .nullable(),
  organization: z.string().nullable(),
  program_name: z.string().nullable(),
  claimed_deadline: z.string().nullable(),
  search_query: z.string().nullable(),
});

const caption =
  "$25,000 and NO essay?! The Coca-Cola Scholars Program is OPEN for high school seniors 🎓 deadline in October, don't sleep on this #scholarship #classof2027";

async function tryMode(label, opts) {
  try {
    const ai = new GoogleGenAI(opts);
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: caption,
      config: {
        systemInstruction:
          "Extract structured facts about the opportunity in this video caption. A field the text doesn't state is null, never guess.",
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(schema),
      },
    });
    const parsed = schema.parse(JSON.parse(res.text));
    console.log(`${label}: OK`);
    console.log(JSON.stringify(parsed, null, 2));
    return true;
  } catch (e) {
    console.error(`${label}: FAILED, ${e?.message ?? e}`);
    return false;
  }
}

// AI Studio keys start with "AIza"; Vertex express-mode keys start with "AQ."
const ok =
  (await tryMode("gemini-api mode", { apiKey: key })) ||
  (await tryMode("vertex-express mode", { vertexai: true, apiKey: key }));
process.exit(ok ? 0 : 1);
