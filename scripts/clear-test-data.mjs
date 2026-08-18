#!/usr/bin/env node
/**
 * MAINTENANCE SCRIPT — DESTRUCTIVE. Not part of the app build.
 *
 * Clears all CYCLE and PROPOSAL data so the portal can be tested from a clean
 * slate, while leaving every account intact.
 *
 * Usage (from the repo root):
 *     node scripts/clear-test-data.mjs              # report only, deletes nothing
 *     node scripts/clear-test-data.mjs --execute    # actually delete
 *
 * It reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * .env.local and uses the service role, so it bypasses RLS.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELETES (every row, all cycles):
 *   review_answers, reviews,
 *   report_documents, reports,
 *   proposal_documents, proposal_budget_years, proposals,
 *   projects,
 *   review_questions, document_requirements,
 *   cycles
 * ...plus every object in the 'proposals', 'reports' and 'cycle-templates'
 * storage buckets.
 *
 * WHAT THIS DELIBERATELY DOES **NOT** TOUCH:
 *   - auth.users — no account is deleted. (Before go-live we'll extend this
 *     script to remove the test accounts too; that is NOT what it does today.)
 *   - public.profiles — roles, statuses, names, institutions, cv_path all kept.
 *   - the 'cvs' storage bucket — researchers need their seeded CVs to submit.
 *   - the storage buckets themselves — only their contents are emptied.
 *   - any schema: no tables, columns, functions, RPCs, triggers or policies are
 *     changed. This is a DATA clear only.
 * ---------------------------------------------------------------------------
 *
 * DELETION ORDER is derived from the actual foreign keys. The ON DELETE
 * RESTRICT edges are what force the order (a CASCADE would tidy itself up, but
 * we delete explicitly so the result is deterministic and countable):
 *   review_answers.question_id      -> review_questions      RESTRICT
 *   proposal_documents.requirement_id -> document_requirements RESTRICT
 *   report_documents.requirement_id -> document_requirements  RESTRICT
 *   proposals.cycle_id              -> cycles                RESTRICT
 *   reports.cycle_id                -> cycles                RESTRICT
 *   projects.researcher_id          -> profiles              RESTRICT (kept)
 *   proposals.researcher_id         -> profiles              RESTRICT (kept)
 *   reviews.reviewer_id             -> profiles              RESTRICT (kept)
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Child -> parent. See the FK notes above.
const TABLES_IN_DELETE_ORDER = [
  "review_answers",
  "reviews",
  "report_documents",
  "reports",
  "proposal_documents",
  "proposal_budget_years",
  "proposals",
  "projects",
  "review_questions",
  "document_requirements",
  "cycles",
];

const BUCKETS_TO_EMPTY = ["proposals", "reports", "cycle-templates"];
const BUCKETS_TO_KEEP = ["cvs"];

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function countRows(admin, table) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

/** Every object path in a bucket, walking nested folders. */
async function listAllObjects(admin, bucket, prefix = "") {
  const out = [];
  const { data, error } = await admin.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    // Supabase returns folders as rows with a null id.
    if (item.id === null) out.push(...(await listAllObjects(admin, bucket, path)));
    else out.push(path);
  }
  return out;
}

async function snapshot(admin) {
  const tables = {};
  for (const t of [...TABLES_IN_DELETE_ORDER, "profiles"]) {
    tables[t] = await countRows(admin, t);
  }
  const storage = {};
  for (const b of [...BUCKETS_TO_EMPTY, ...BUCKETS_TO_KEEP]) {
    storage[b] = (await listAllObjects(admin, b)).length;
  }
  const { data: userPage } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  return { tables, storage, accounts: userPage?.users.length ?? 0 };
}

function printSnapshot(label, snap) {
  console.log(`\n===== ${label} =====`);
  console.log("Tables:");
  for (const t of TABLES_IN_DELETE_ORDER) {
    console.log(`  ${t.padEnd(24)} ${String(snap.tables[t]).padStart(5)}`);
  }
  console.log("  " + "-".repeat(30));
  console.log(
    `  ${"profiles (KEPT)".padEnd(24)} ${String(snap.tables.profiles).padStart(5)}`,
  );
  console.log(
    `  ${"auth accounts (KEPT)".padEnd(24)} ${String(snap.accounts).padStart(5)}`,
  );
  console.log("Storage objects:");
  for (const b of BUCKETS_TO_EMPTY) {
    console.log(`  ${b.padEnd(24)} ${String(snap.storage[b]).padStart(5)}`);
  }
  for (const b of BUCKETS_TO_KEEP) {
    console.log(
      `  ${(b + " (KEPT)").padEnd(24)} ${String(snap.storage[b]).padStart(5)}`,
    );
  }
}

async function emptyBucket(admin, bucket) {
  const paths = await listAllObjects(admin, bucket);
  if (paths.length === 0) return 0;
  // remove() caps out on very large batches; chunk it.
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await admin.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`remove from ${bucket}: ${error.message}`);
  }
  return paths.length;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const admin = loadEnv();

  console.log(
    execute
      ? "MODE: --execute  (data WILL be deleted)"
      : "MODE: report only (nothing will be deleted; pass --execute to delete)",
  );

  const before = await snapshot(admin);
  printSnapshot("BEFORE", before);

  if (!execute) {
    console.log(
      "\nNo changes made. Re-run with --execute to clear the data above.",
    );
    return;
  }

  console.log("\n===== DELETING =====");
  // Storage first: the rows are the only index of these objects, so removing
  // files before rows means a failure can't orphan files we can't find again.
  for (const bucket of BUCKETS_TO_EMPTY) {
    const n = await emptyBucket(admin, bucket);
    console.log(`  emptied bucket ${bucket.padEnd(18)} ${n} object(s)`);
  }

  for (const table of TABLES_IN_DELETE_ORDER) {
    // PostgREST refuses an unfiltered DELETE; "id is not null" matches all rows.
    const { error } = await admin.from(table).delete().not("id", "is", null);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    console.log(`  cleared table  ${table}`);
  }

  const after = await snapshot(admin);
  printSnapshot("AFTER", after);

  const leftovers = TABLES_IN_DELETE_ORDER.filter((t) => after.tables[t] !== 0);
  const bucketLeftovers = BUCKETS_TO_EMPTY.filter((b) => after.storage[b] !== 0);
  if (leftovers.length || bucketLeftovers.length) {
    console.error(
      `\nFAILED to fully clear: ${[...leftovers, ...bucketLeftovers].join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const keptOk =
    after.tables.profiles === before.tables.profiles &&
    after.accounts === before.accounts &&
    after.storage.cvs === before.storage.cvs;
  console.log(
    keptOk
      ? "\nOK: all target data cleared; profiles, accounts and cvs untouched."
      : "\nWARNING: something that should have been KEPT changed — review above.",
  );
  if (!keptOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exitCode = 1;
});
