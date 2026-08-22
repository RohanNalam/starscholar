// Regression suite: run every known test link through the live pipeline.
//   node scripts/regression.mjs            → uses the shared cache (fast, free)
//   node scripts/regression.mjs --fresh    → full re-verification of every link
// Add new links to scripts/test-links.json, every reported bug becomes a
// permanent test case so fixes can never regress older links.
import { readFileSync } from "fs";

const fresh = process.argv.includes("--fresh");
const base = process.env.BASE_URL || "http://localhost:3000";
const links = JSON.parse(readFileSync(new URL("./test-links.json", import.meta.url), "utf8"));

console.log(`Running ${links.length} links against ${base} (${fresh ? "FRESH, full pipeline" : "cache allowed"})\n`);

let pass = 0;
for (const item of links) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.url, refresh: fresh }),
    });
    const r = await res.json();
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!r.ok) {
      console.log(`✗ ${item.note}, ERROR: ${r.error} (${secs}s)`);
      continue;
    }
    console.log(`■ ${item.note} (${secs}s)`);
    console.log(`  read from: ${r.analyzedWith}`);
    if (r.opportunities.length === 0) {
      console.log("  ✗ no opportunities identified");
      continue;
    }
    let allGood = true;
    for (const o of r.opportunities) {
      const v = o.verification;
      if (!v) {
        console.log(`  ✗ ${o.claimed.program_name ?? o.claimed.search_query}, verification failed`);
        allGood = false;
        continue;
      }
      const link = v.direct_application_url || v.official_info_url;
      const dl = v.deadline ? `deadline: ${v.deadline}` : "no deadline listed";
      console.log(
        `  ${v.status.toUpperCase().padEnd(11)} ${v.organization}, ${v.name} | ${dl} | ${link ? "link ✓" : "NO LINK ✗"}`
      );
      if (!link) allGood = false;
    }
    if (allGood) pass++;
  } catch (e) {
    console.log(`✗ ${item.note}, ${e.message}`);
  }
  console.log("");
}
console.log(`${pass}/${links.length} links fully passed (all opportunities verified with links)`);
