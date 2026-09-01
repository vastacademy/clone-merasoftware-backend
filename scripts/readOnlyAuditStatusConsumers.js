// READ-ONLY source audit. Reads the frontend source; touches no database and writes nothing.
//
// The status engine only helps where things actually ask it. This sweeps the frontend for places
// that still decide something from the RAW status columns (orderVisibility, projectProgress,
// currentPhase, status) instead of the engine's derived `orderState`, so a surface cannot quietly
// keep its own private version of the rules.
//
// It exists because that is exactly what happened: after the engine was wired into every badge,
// a cancelled project still showed "Upload Data · Pending", because the button's LOCK was
// computed from raw fields and its BADGE assumed the only reason to lock was payment. Labels had
// been migrated; the decisions next to them had not.
//
// Not every raw read is wrong, so each hit is classified rather than merely counted:
//
//   OK-FALLBACK  a raw read guarded by an `orderState` check on the same expression — the
//                deliberate fallback for payloads that predate the engine.
//   OK-FACT      a genuine lifecycle fact, not a derived state: "is this order in the
//                pending-approval state so the approve/reject panel should appear", "is it
//                already cancelled so the Cancel button should be hidden". These act on the
//                transition itself and are correct to read the column.
//   REVIEW       anything else — a decision or a label derived from raw columns with no engine
//                reference nearby. These are what this audit is for.
//
// Run:  node scripts/readOnlyAuditStatusConsumers.js
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "frontend", "src");

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(96));

// Raw status columns that the engine now derives from.
const RAW_PATTERNS = [
  /orderVisibility/,
  /projectProgress\s*[><=]/,
  /currentPhase\s*[!=]==/,
  /\bplanStatus\s*[!=]==/,
  /servicePlanStatus\s*[!=]==/,
];

// A hit inside a block that consults the engine first is the intended fallback. `orderState` is
// the raw property; getOrderStateCode / getOrderStatusCode are the named readers of it, and a
// block guarded by one of those is just as engine-first as one that reads the property inline.
const hasEngineReference = (text) => /orderState|getOrderStateCode|getOrderStatusCode/.test(text);

// Lifecycle facts that are correct to read directly — these drive an action ON the transition,
// not a display of derived state.
const FACT_PATTERNS = [
  /orderVisibility\s*!==\s*["']cancelled["']/,      // hide Cancel on an already-cancelled order
  /orderVisibility\s*===\s*["']pending-approval["']/, // show the approve/reject panel
  /orderVisibility\s*===\s*["']payment-rejected["']/,  // show Retry Payment
  /orderVisibility:\s*["']pending-approval["']/,       // building a new order payload
  /servicePlanStatus\s*===\s*["']active["']/,          // which services can take an update request
  /planStatus\s*===\s*["']closed["']/,                 // refuse work against a closed plan
];

// Lines that are not decisions at all: imports, and the engine-fallback branches inside the
// shared helpers themselves. The helpers are where the fallback is SUPPOSED to live — flagging
// their own bodies would mean the audit could never reach zero.
const NON_DECISION = [
  /^import\s/,
  /^export const (isActiveWorkItem|getOrderStateCode|isProjectItem|isPlanItem|isFinishedItem)/,
];

const HELPER_FILES = [
  "frontend/src/helpers/orderVisibility.js",   // the definition of isOrderApproved itself
  "frontend/src/helpers/orderType.js",         // isFinishedItem — the pre-engine classifier
  "frontend/src/helpers/orderPresentation.js", // holds the documented fallbacks
];

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|backup|_backup/i.test(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      if (/backup/i.test(full)) continue;
      out.push(full);
    }
  }
  return out;
};

const main = () => {
  if (!fs.existsSync(SRC)) {
    line("frontend/src not found at " + SRC);
    process.exit(1);
  }

  const files = walk(SRC);
  const review = [];
  const okFallback = [];
  const okFact = [];

  for (const file of files) {
    const rel = path.relative(path.join(__dirname, "..", ".."), file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split("\n");

    lines.forEach((text, index) => {
      const trimmed = text.trim();
      // Comment lines, including the continuation lines of a block comment that neither start
      // with // nor * (a wrapped sentence inside a /* … */ block reads as bare prose).
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (/^[A-Za-z][^;{}()]*$/.test(trimmed) && !/[=<>!]/.test(trimmed)) return;
      if (NON_DECISION.some((re) => re.test(trimmed))) return;
      if (!RAW_PATTERNS.some((re) => re.test(text))) return;

      // Look back far enough to catch the `if (code) return …` guard that opens a fallback
      // block — the raw reads sit several lines below it, under a "── fallback ──" marker.
      const window = lines.slice(Math.max(0, index - 14), index + 2).join("\n");
      const hit = { file: rel, line: index + 1, text: trimmed };

      if (hasEngineReference(window) || HELPER_FILES.includes(rel)) okFallback.push(hit);
      else if (FACT_PATTERNS.some((re) => re.test(text))) okFact.push(hit);
      else review.push(hit);
    });
  }

  sep();
  line("RAW STATUS READS THAT NEED REVIEW  — " + review.length);
  sep();
  if (!review.length) {
    line("  none. Every remaining raw read is either an engine fallback or a lifecycle fact.");
  } else {
    let currentFile = "";
    review.forEach((hit) => {
      if (hit.file !== currentFile) {
        currentFile = hit.file;
        line("");
        line("  " + currentFile);
      }
      line("    " + String(hit.line).padStart(5) + "  " + hit.text.slice(0, 110));
    });
  }

  sep();
  line("ACCEPTED  — engine fallbacks: " + okFallback.length + "   lifecycle facts: " + okFact.length);
  sep();
  line("");
  line("  engine fallbacks (raw read guarded by an orderState check):");
  const fallbackFiles = [...new Set(okFallback.map((h) => h.file))];
  fallbackFiles.forEach((f) =>
    line("    " + f + "  (" + okFallback.filter((h) => h.file === f).length + ")"));
  line("");
  line("  lifecycle facts (correct to read the column directly):");
  const factFiles = [...new Set(okFact.map((h) => h.file))];
  factFiles.forEach((f) =>
    line("    " + f + "  (" + okFact.filter((h) => h.file === f).length + ")"));

  sep();
  line("");
  line("  files scanned : " + files.length);
  line("  needs review  : " + review.length + (review.length ? "" : "   <-- clear"));
  line("");
  line("Nothing was modified.");

  if (review.length) process.exit(1);
};

main();
