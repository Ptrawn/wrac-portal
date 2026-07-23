"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { formatBudget, type DocumentRequirement } from "@/lib/cycles";
import type { ProposalDocument } from "@/lib/proposals";
import {
  endProject,
  getProposalFileUrl,
  rescindProposal,
  saveBudgetPlan,
  submitProposal,
  updateProposal,
} from "../actions";

type BudgetYearInput = { year_number: number; planned_amount: string };

type ContinuationInfo = {
  yearNumber: number;
  projectedThisYear: string | null;
  originalPlan: {
    year_number: number;
    planned_amount: string;
    source_cycle_name: string;
  }[];
  parentId: string | null;
  parentTitle: string | null;
};

type SubmissionInfo = {
  canSubmit: boolean;
  blockedReason: "wrong_stage" | "deadline_passed" | null;
  message: string | null;
  overrideActive: boolean;
  deadlineLong: string | null;
};

type Props = {
  proposalId: string;
  projectId: string;
  type: string;
  state: string;
  editable: boolean;
  hasCv: boolean;
  initialTitle: string;
  initialAmount: string;
  initialPlannedYears: string;
  requirements: DocumentRequirement[];
  documents: ProposalDocument[];
  budgetYears: BudgetYearInput[];
  submission: SubmissionInfo;
  projectStatus: string;
  continuation: ContinuationInfo | null;
};

export function ProposalWorkspace(props: Props) {
  const {
    proposalId,
    projectId,
    type,
    state,
    editable,
    hasCv,
    requirements,
    documents,
    initialAmount,
    initialPlannedYears,
    budgetYears,
    submission,
    projectStatus,
    continuation,
  } = props;

  const isFull = type === "full";
  const requiredReqs = requirements.filter((r) => r.is_required);
  const uploadedReqIds = new Set(documents.map((d) => d.requirement_id));
  const requiredUploaded = requiredReqs.filter((r) =>
    uploadedReqIds.has(r.id),
  ).length;
  const allRequiredUploaded =
    requiredReqs.length === 0 || requiredUploaded === requiredReqs.length;

  return (
    <div className="flex flex-col gap-8">
      {!editable && (
        <div className="bg-accent text-sm p-3 rounded-md">
          This proposal is locked ({state}). It can no longer be edited.
        </div>
      )}

      {type === "continuation" && continuation && (
        <ContinuationContext continuation={continuation} />
      )}

      <DetailsSection {...props} />

      {isFull && (
        <BudgetPlanSection
          proposalId={proposalId}
          projectId={projectId}
          editable={editable}
          initialPlannedYears={initialPlannedYears}
          initialAmount={initialAmount}
          initialBudgetYears={budgetYears}
        />
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Documents</h3>
          <span className="text-sm text-muted-foreground">
            {requiredUploaded} of {requiredReqs.length} required documents
            uploaded
          </span>
        </div>
        {requirements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No document slots are defined for this stage.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requirements.map((req) => (
              <DocumentSlot
                key={req.id}
                proposalId={proposalId}
                editable={editable}
                requirement={req}
                document={documents.find((d) => d.requirement_id === req.id) ?? null}
              />
            ))}
          </ul>
        )}
      </div>

      {editable && (
        <SubmitSection
          proposalId={proposalId}
          hasCv={hasCv}
          allRequiredUploaded={allRequiredUploaded}
          submission={submission}
        />
      )}

      <RescindSection proposalId={proposalId} state={state} />

      {(projectStatus === "active" || projectStatus === "proposed") && (
        <EndProjectSection projectId={projectId} />
      )}
    </div>
  );
}

function ContinuationContext({
  continuation,
}: {
  continuation: ContinuationInfo;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <h3 className="font-semibold">Continuation of a funded project</h3>
      {continuation.parentId && (
        <Link
          href={`/dashboard/proposals/${continuation.parentId}`}
          className="text-sm underline underline-offset-4 w-fit"
        >
          View the funded proposal you&apos;re continuing
          {continuation.parentTitle ? ` (${continuation.parentTitle})` : ""}
        </Link>
      )}
      {continuation.originalPlan.length > 0 ? (
        <div className="text-sm">
          <div className="text-muted-foreground mb-1">
            Your original multi-year projection
            {continuation.originalPlan[0]?.source_cycle_name
              ? ` (from ${continuation.originalPlan[0].source_cycle_name})`
              : ""}
            :
          </div>
          <ul className="flex flex-col gap-0.5">
            {continuation.originalPlan.map((row) => (
              <li
                key={row.year_number}
                className={
                  "grid grid-cols-[8rem_1fr] " +
                  (row.year_number === continuation.yearNumber
                    ? "font-medium"
                    : "text-muted-foreground")
                }
              >
                <span>
                  Year {row.year_number}
                  {row.year_number === continuation.yearNumber
                    ? " (this request)"
                    : ""}
                </span>
                <span>
                  {row.planned_amount === ""
                    ? "—"
                    : formatBudget(row.planned_amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No original multi-year plan is on file for this project.
        </p>
      )}
    </div>
  );
}

function EndProjectSection({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const end = () => {
    if (reason.trim() === "") {
      setError("Please give a short reason for ending the project.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await endProject(projectId, reason.trim());
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="border-t pt-4 flex flex-col gap-2">
      {!confirming ? (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => setConfirming(true)}
        >
          End this project
        </Button>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Ending this project stops any future funding requests for it and
            means a final report will be required. This affects the whole
            project, not just this proposal. Give a short reason:
          </p>
          <Input
            aria-label="Reason for ending the project"
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={end}
            >
              {isPending ? "Ending…" : "End project"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}

function DetailsSection({
  proposalId,
  projectId,
  type,
  editable,
  initialTitle,
  initialAmount,
  initialPlannedYears,
  continuation,
}: Props) {
  const router = useRouter();
  const isFull = type === "full";
  const [title, setTitle] = useState(initialTitle);
  const [amount, setAmount] = useState(initialAmount);
  const [plannedYears, setPlannedYears] = useState(initialPlannedYears);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!editable) {
    return (
      <div className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
        <span className="text-muted-foreground">Title</span>
        <span>{initialTitle}</span>
        <span className="text-muted-foreground">Requested amount</span>
        <span>{initialAmount === "" ? "—" : initialAmount}</span>
        <span className="text-muted-foreground">Planned years</span>
        <span>{initialPlannedYears}</span>
      </div>
    );
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      // Full proposals manage amount + planned years through the plan below,
      // so this only saves the title for them.
      const res = await updateProposal(proposalId, projectId, {
        title: title.trim(),
        requestedAmount: isFull
          ? undefined
          : amount.trim() === ""
            ? null
            : amount.trim(),
        // Only a pre-proposal sets the project's planned years; continuations
        // inherit the plan fixed at year 1 and off-cycle isn't multi-year here.
        plannedYears: type === "pre" ? Number(plannedYears) : undefined,
      });
      if (res?.error) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      {!isFull && (
        <div className="grid gap-2">
          {type === "continuation" && continuation && (
            <p className="text-sm rounded-md border bg-accent p-2">
              {continuation.projectedThisYear != null ? (
                <>
                  Originally projected{" "}
                  <span className="font-semibold">
                    {formatBudget(continuation.projectedThisYear)}
                  </span>{" "}
                  for Year {continuation.yearNumber} in the multi-year plan.
                </>
              ) : (
                <>
                  No amount was projected for Year {continuation.yearNumber} in
                  the original plan.
                </>
              )}
            </p>
          )}
          <Label htmlFor="amount">Requested amount (this year)</Label>
          <Input
            id="amount"
            type="number"
            min="0"
            step="0.01"
            className="w-40"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      )}
      {type === "pre" && (
        <div className="grid gap-2">
          <Label htmlFor="planned_years">Planned years (1–10)</Label>
          <Input
            id="planned_years"
            type="number"
            min="1"
            max="10"
            className="w-28"
            value={plannedYears}
            onChange={(e) => setPlannedYears(e.target.value)}
          />
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Saved.</p>}
      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}

function BudgetPlanSection({
  proposalId,
  projectId,
  editable,
  initialPlannedYears,
  initialAmount,
  initialBudgetYears,
}: {
  proposalId: string;
  projectId: string;
  editable: boolean;
  initialPlannedYears: string;
  initialAmount: string;
  initialBudgetYears: BudgetYearInput[];
}) {
  const router = useRouter();

  const initialAmounts = () => {
    const m: Record<number, string> = {};
    for (const b of initialBudgetYears) m[b.year_number] = b.planned_amount;
    // Year 1 mirrors the proposal's requested amount if no plan row yet.
    if (m[1] === undefined && initialAmount !== "") m[1] = initialAmount;
    return m;
  };

  const [years, setYears] = useState<number>(
    Math.min(10, Math.max(1, Number(initialPlannedYears) || 1)),
  );
  const [amounts, setAmounts] = useState<Record<number, string>>(initialAmounts);
  const [pendingReduce, setPendingReduce] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const amountOf = (y: number): number => {
    const raw = amounts[y] ?? "";
    if (raw.trim() === "") return 0;
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  };

  const total = Array.from({ length: years }, (_, i) => amountOf(i + 1)).reduce(
    (s, v) => s + v,
    0,
  );

  const applyYears = (n: number) => {
    setSaved(false);
    setYears(n);
  };

  const changeYears = (raw: string) => {
    const n = Math.min(10, Math.max(1, Number(raw) || 1));
    if (n < years) {
      // Warn if any of the years being dropped has an entered amount.
      const dropped = [];
      for (let y = n + 1; y <= years; y++) {
        if ((amounts[y] ?? "").trim() !== "") dropped.push(y);
      }
      if (dropped.length > 0) {
        setPendingReduce(n);
        return;
      }
    }
    applyYears(n);
  };

  const confirmReduce = () => {
    if (pendingReduce == null) return;
    const n = pendingReduce;
    setAmounts((a) => {
      const next = { ...a };
      for (let y = n + 1; y <= years; y++) delete next[y];
      return next;
    });
    applyYears(n);
    setPendingReduce(null);
  };

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const payload = Array.from({ length: years }, (_, i) => ({
        year_number: i + 1,
        planned_amount: amountOf(i + 1),
      }));
      const res = await saveBudgetPlan(proposalId, projectId, years, payload);
      if (res?.error) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  if (!editable) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Multi-year budget plan</h3>
        <ul className="flex flex-col gap-0.5 text-sm">
          {initialBudgetYears.length === 0 ? (
            <li className="text-muted-foreground">No plan entered.</li>
          ) : (
            initialBudgetYears.map((b) => (
              <li
                key={b.year_number}
                className="grid grid-cols-[8rem_1fr] text-muted-foreground"
              >
                <span>
                  Year {b.year_number}
                  {b.year_number === 1 ? " (this cycle)" : ""}
                </span>
                <span>
                  {b.planned_amount === "" ? "—" : formatBudget(b.planned_amount)}
                </span>
              </li>
            ))
          )}
        </ul>
        {initialBudgetYears.length > 0 && (
          <p className="text-sm">
            Plan total:{" "}
            {formatBudget(
              initialBudgetYears
                .reduce((s, b) => s + Number(b.planned_amount || 0), 0)
                .toString(),
            )}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">Multi-year budget plan</h3>
        <p className="text-xs text-muted-foreground">
          Year 1 is this cycle&apos;s requested amount; it&apos;s the authoritative
          ask and is saved as the proposal&apos;s requested amount.
        </p>
      </div>

      <div className="grid gap-1 w-40">
        <Label htmlFor="plan_years" className="text-xs">
          Planned years (1–10)
        </Label>
        <Input
          id="plan_years"
          type="number"
          min="1"
          max="10"
          className="w-28"
          value={String(years)}
          onChange={(e) => changeYears(e.target.value)}
        />
      </div>

      {pendingReduce != null && (
        <div className="text-sm flex flex-col gap-2 border rounded-md p-3">
          <p>
            Reducing to {pendingReduce} year(s) will discard the amounts you
            entered for later years. Continue?
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={confirmReduce}>
              Discard and reduce
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPendingReduce(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {Array.from({ length: years }, (_, i) => i + 1).map((y) => (
          <li key={y} className="grid grid-cols-[8rem_1fr] items-center gap-3">
            <Label htmlFor={`year-${y}`} className="text-sm">
              Year {y}
              {y === 1 ? " (this cycle)" : ""}
            </Label>
            <Input
              id={`year-${y}`}
              type="number"
              min="0"
              step="0.01"
              className="w-40"
              value={amounts[y] ?? ""}
              onChange={(e) => {
                setSaved(false);
                setAmounts((a) => ({ ...a, [y]: e.target.value }));
              }}
            />
          </li>
        ))}
      </ul>

      <p className="text-sm">Plan total: {formatBudget(total.toString())}</p>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Plan saved.</p>}
      <Button size="sm" disabled={isPending} onClick={save} className="w-fit">
        {isPending ? "Saving…" : "Save plan"}
      </Button>
    </div>
  );
}

function DocumentSlot({
  proposalId,
  editable,
  requirement,
  document: doc,
}: {
  proposalId: string;
  editable: boolean;
  requirement: DocumentRequirement;
  document: ProposalDocument | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const acceptedExts = requirement.accepted_file_types
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const acceptAttr = acceptedExts.map((e) => `.${e}`).join(",");

  const view = async () => {
    if (!doc) return;
    setError(null);
    const res = await getProposalFileUrl(doc.file_path);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const upload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setError(null);

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (acceptedExts.length > 0 && !acceptedExts.includes(ext)) {
      setError(`Accepted file types: ${acceptedExts.join(", ")}.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const path = `${proposalId}/${requirement.id}.${ext}`;

      // If replacing a file stored at a different path (different extension),
      // remove the old object first so it isn't orphaned.
      if (doc && doc.file_path !== path) {
        await supabase.storage.from("proposals").remove([doc.file_path]);
      }

      const { error: uploadError } = await supabase.storage
        .from("proposals")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase
        .from("proposal_documents")
        .upsert(
          {
            proposal_id: proposalId,
            requirement_id: requirement.id,
            file_path: path,
            file_name: file.name,
            file_size: file.size,
          },
          { onConflict: "proposal_id,requirement_id" },
        );
      if (rowError) throw rowError;

      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!doc) return;
    setError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const { error: storageError } = await supabase.storage
        .from("proposals")
        .remove([doc.file_path]);
      if (storageError) throw storageError;
      const { error: rowError } = await supabase
        .from("proposal_documents")
        .delete()
        .eq("id", doc.id);
      if (rowError) throw rowError;
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">{requirement.label}</span>{" "}
          <span className="text-muted-foreground">
            ({requirement.is_required ? "required" : "optional"} ·{" "}
            {requirement.accepted_file_types})
          </span>
          {requirement.description && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {requirement.description}
            </div>
          )}
        </div>
        {doc && (
          <button
            type="button"
            onClick={view}
            className="text-sm underline underline-offset-4 shrink-0"
          >
            View
          </button>
        )}
      </div>

      {doc ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground truncate">{doc.file_name}</span>
          {editable && (
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-sm underline underline-offset-4 cursor-pointer">
                Replace
                <input
                  ref={inputRef}
                  type="file"
                  accept={acceptAttr || undefined}
                  className="hidden"
                  disabled={busy}
                  onChange={upload}
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={remove}
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      ) : editable ? (
        <Input
          ref={inputRef}
          type="file"
          accept={acceptAttr || undefined}
          disabled={busy}
          onChange={upload}
        />
      ) : (
        <span className="text-sm text-muted-foreground">Not uploaded</span>
      )}

      {busy && <p className="text-xs text-muted-foreground">Working…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </li>
  );
}

function SubmitSection({
  proposalId,
  hasCv,
  allRequiredUploaded,
  submission,
}: {
  proposalId: string;
  hasCv: boolean;
  allRequiredUploaded: boolean;
  submission: SubmissionInfo;
}) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await submitProposal(proposalId);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  const blocked = !submission.canSubmit;

  return (
    <div className="border-t pt-4 flex flex-col gap-2">
      <h3 className="font-semibold">Review &amp; submit</h3>

      {submission.overrideActive && submission.message && (
        <div className="text-sm p-3 rounded-md border bg-accent">
          {submission.message}
        </div>
      )}

      {blocked ? (
        // Stage/deadline gate: the submit control is replaced by the reason.
        <div className="text-sm p-3 rounded-md border border-destructive/40 bg-destructive/10">
          {submission.message}
        </div>
      ) : (
        <>
          {submission.deadlineLong && (
            <p className="text-sm font-medium">Due {submission.deadlineLong}</p>
          )}
          {!hasCv && (
            <p className="text-sm text-red-500">
              You have no CV on file. Upload one on your profile before
              submitting.
            </p>
          )}
          {!allRequiredUploaded && (
            <p className="text-sm text-muted-foreground">
              Upload every required document to enable submission.
            </p>
          )}

          {!reviewing ? (
            <Button
              size="sm"
              className="w-fit"
              disabled={!allRequiredUploaded || !hasCv || isPending}
              onClick={() => setReviewing(true)}
            >
              Review &amp; submit
            </Button>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Submitting locks this proposal. You can still rescind it, and the
                Manager can reopen it before the deadline. Continue?
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={isPending} onClick={submit}>
                  {isPending ? "Submitting…" : "Submit proposal"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setReviewing(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </>
      )}
    </div>
  );
}

function RescindSection({
  proposalId,
  state,
}: {
  proposalId: string;
  state: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Rescinding is possible from draft/reopened/submitted (not once rescinded).
  if (state === "rescinded") return null;

  const rescind = () => {
    setError(null);
    startTransition(async () => {
      const res = await rescindProposal(proposalId);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="border-t pt-4 flex flex-col gap-2">
      {!confirming ? (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => setConfirming(true)}
        >
          Rescind proposal
        </Button>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>This withdraws your proposal. It will remain in your history.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={rescind}
            >
              {isPending ? "Rescinding…" : "Yes, rescind"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
