#!/usr/bin/env node
/**
 * MAINTENANCE SCRIPT — DESTRUCTIVE. Not part of the app build.
 *
 * Clears all test data ahead of go-live: every cycle, proposal, review and
 * report, every uploaded test file, and every account except the KEEP list.
 *
 * Usage (from the repo root):
 *     node scripts/clear-test-data.mjs              # report only, deletes nothing
 *     node scripts/clear-test-data.mjs --execute    # actually delete
 *
 * It reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * .env.local and uses the service role, so it bypasses RLS.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DELETES:
 *   1. every object in the 'proposals', 'reports' and 'cycle-templates'
 *      storage buckets
 *   2. every row in: review_answers, reviews, report_documents, reports,
 *      proposal_documents, proposal_budget_years, proposals, projects,
 *      review_questions, document_requirements, cycles
 *   3. every auth user whose email is NOT on the KEEP list (matched
 *      case-insensitively), including auth users that have no profile.
 *      Deleting the auth user removes its profile: profiles.id references
 *      auth.users ON DELETE CASCADE.
 *
 * WHAT THIS DELIBERATELY DOES **NOT** TOUCH:
 *   - the five KEEP accounts: their auth users and profile rows.
 *   - the 'cvs' storage bucket — never emptied. CVs belonging to deleted
 *     accounts are left behind as orphans on purpose.
 *   - the storage buckets themselves — only their contents are emptied.
 *   - any schema: no tables, columns, functions, RPCs, triggers or policies are
 *     changed. This is a DATA clear only.
 *
 * SAFETY: before anything is deleted, the KEEP list must resolve to exactly
 * five existing accounts, one per address. If it doesn't (a typo, a missing
 * account, a duplicate) the script aborts having deleted nothing.
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
 *   projects.researcher_id          -> profiles              RESTRICT
 *   proposals.researcher_id         -> profiles              RESTRICT
 *   reviews.reviewer_id             -> profiles              RESTRICT
 * The last three are why accounts go LAST: an account that still owns a
 * project or proposal, or has a review, cannot be deleted.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// The accounts that survive. Compared lowercased against auth emails.
const KEEP_EMAILS = [
  "mgr-test@twomountainwinery.com",
  "researcher-test@twomountainwinery.com",
  "patrick@twomountainwinery.com",
  "committee-test@twomountainwinery.com",
  "JTarara@washingtonwine.org",
];

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
// Counted before and after so the run proves it was left alone; never emptied.
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

/** Every object path in a bucket, walking nested folders and paging. */
async function listAllObjects(admin, bucket, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Supabase returns folders as rows with a null id.
      if (item.id === null) out.push(...(await listAllObjects(admin, bucket, path)));
      else out.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Every auth user, across all pages. */
async function listAllUsers(admin) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`list auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return users;
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
  const users = await listAllUsers(admin);
  const { data: profileRows, error } = await admin.from("profiles").select("id");
  if (error) throw new Error(`list profiles: ${error.message}`);
  const profileIds = new Set((profileRows ?? []).map((p) => p.id));
  return { tables, storage, users, profileIds };
}

function printSnapshot(label, snap) {
  console.log(`\n===== ${label} =====`);
  console.log("Tables:");
  for (const t of TABLES_IN_DELETE_ORDER) {
    console.log(`  ${t.padEnd(24)} ${String(snap.tables[t]).padStart(5)}`);
  }
  console.log("  " + "-".repeat(30));
  console.log(`  ${"profiles".padEnd(24)} ${String(snap.tables.profiles).padStart(5)}`);
  console.log(`  ${"auth users".padEnd(24)} ${String(snap.users.length).padStart(5)}`);
  console.log("Storage objects:");
  for (const b of BUCKETS_TO_EMPTY) {
    console.log(`  ${b.padEnd(24)} ${String(snap.storage[b]).padStart(5)}`);
  }
  for (const b of BUCKETS_TO_KEEP) {
    console.log(
      `  ${(b + " (NOT TOUCHED)").padEnd(24)} ${String(snap.storage[b]).padStart(5)}`,
    );
  }
}

/**
 * Split auth users into keep / delete. Any entry in `problems` means abort:
 * the keep list must resolve to exactly one existing account per address.
 */
function planAccounts(users, profileIds) {
  const keepSet = new Set(KEEP_EMAILS.map((e) => e.trim().toLowerCase()));
  const problems = [];
  if (keepSet.size !== KEEP_EMAILS.length) {
    problems.push("the KEEP list contains a duplicate address");
  }

  const keep = [];
  const remove = [];
  for (const u of users) {
    const email = (u.email ?? "").trim().toLowerCase();
    const row = {
      id: u.id,
      email: u.email ?? "(no email)",
      hasProfile: profileIds.has(u.id),
    };
    (keepSet.has(email) ? keep : remove).push(row);
  }

  for (const k of keepSet) {
    const matches = keep.filter((u) => u.email.toLowerCase() === k);
    if (matches.length === 0) problems.push(`no existing account for keep address "${k}"`);
    if (matches.length > 1) problems.push(`${matches.length} accounts match keep address "${k}"`);
  }
  if (keep.length !== 5) {
    problems.push(`expected exactly 5 accounts to keep, found ${keep.length}`);
  }

  const byEmail = (a, b) => a.email.localeCompare(b.email);
  return { keep: keep.sort(byEmail), remove: remove.sort(byEmail), problems };
}

function printPlan(plan) {
  const line = (u) =>
    `  ${u.email.padEnd(42)} ${u.id}${u.hasProfile ? "" : "  (no profile)"}`;
  console.log(`\n===== ACCOUNTS TO KEEP (${plan.keep.length}) =====`);
  for (const u of plan.keep) console.log(line(u));
  console.log(`\n===== ACCOUNTS TO DELETE (${plan.remove.length}) =====`);
  for (const u of plan.remove) console.log(line(u));
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

  const plan = planAccounts(before.users, before.profileIds);
  printPlan(plan);

  // The keep-list check runs in both modes, and in --execute mode it runs
  // BEFORE the first deletion, so a bad keep list deletes nothing at all.
  if (plan.problems.length) {
    console.error("\n!!!!! KEEP LIST CHECK FAILED — ABORTING, NOTHING DELETED !!!!!");
    for (const p of plan.problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nKeep list check: OK (exactly 5 accounts, one per address).");

  if (!execute) {
    console.log(
      "\nNo changes made. Re-run with --execute to delete everything listed above.",
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

  // Accounts last. A failure here almost always means a data row survived that
  // still references the account (RESTRICT), so report it and carry on: the
  // list of blocked accounts is what tells us which row to look for.
  const failed = [];
  for (const u of plan.remove) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) {
      failed.push({ ...u, reason: error.message });
      console.error(`  FAILED to delete account ${u.email} (${u.id}): ${error.message}`);
    } else {
      console.log(`  deleted account ${u.email}`);
    }
  }

  const after = await snapshot(admin);
  printSnapshot("AFTER", after);

  const mismatches = [];
  for (const t of TABLES_IN_DELETE_ORDER) {
    if (after.tables[t] !== 0) mismatches.push(`${t}: expected 0 rows, found ${after.tables[t]}`);
  }
  for (const b of BUCKETS_TO_EMPTY) {
    if (after.storage[b] !== 0) mismatches.push(`bucket ${b}: expected 0 objects, found ${after.storage[b]}`);
  }
  if (after.users.length !== 5) mismatches.push(`auth users: expected 5, found ${after.users.length}`);
  if (after.tables.profiles !== 5) mismatches.push(`profiles: expected 5, found ${after.tables.profiles}`);
  const keptIds = new Set(plan.keep.map((u) => u.id));
  for (const u of plan.keep) {
    if (!after.users.some((x) => x.id === u.id)) mismatches.push(`KEEP account missing: ${u.email}`);
    if (!after.profileIds.has(u.id)) mismatches.push(`KEEP profile missing: ${u.email}`);
  }
  for (const u of after.users) {
    if (!keptIds.has(u.id)) mismatches.push(`account still present that is not on the keep list: ${u.email}`);
  }
  if (after.storage.cvs !== before.storage.cvs) {
    mismatches.push(`cvs bucket changed: ${before.storage.cvs} -> ${after.storage.cvs} (it must not be touched)`);
  }
  for (const f of failed) mismatches.push(`account deletion failed: ${f.email}: ${f.reason}`);

  if (mismatches.length) {
    console.error("\n!!!!! VERIFICATION FAILED !!!!!");
    for (const m of mismatches) console.error(`  - ${m}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "\nOK: 0 rows in all 11 data tables, 3 buckets emptied, exactly 5 auth users and 5 profiles remain (the keep list), cvs untouched.",
  );
}

main().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exitCode = 1;
});
