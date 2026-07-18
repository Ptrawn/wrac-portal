"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRequirement } from "@/lib/cycles";
import type { ProposalDocument } from "@/lib/proposals";
import {
  getProposalFileUrl,
  rescindProposal,
  submitPreProposal,
  updateProposal,
} from "../actions";

type Props = {
  proposalId: string;
  projectId: string;
  state: string;
  editable: boolean;
  hasCv: boolean;
  initialTitle: string;
  initialAmount: string;
  initialPlannedYears: string;
  requirements: DocumentRequirement[];
  documents: ProposalDocument[];
};

export function ProposalWorkspace(props: Props) {
  const {
    proposalId,
    projectId,
    state,
    editable,
    hasCv,
    requirements,
    documents,
  } = props;

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

      <DetailsSection {...props} />

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
        />
      )}

      <RescindSection proposalId={proposalId} state={state} />
    </div>
  );
}

function DetailsSection({
  proposalId,
  projectId,
  editable,
  initialTitle,
  initialAmount,
  initialPlannedYears,
}: Props) {
  const router = useRouter();
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
      const res = await updateProposal(proposalId, projectId, {
        title: title.trim(),
        requestedAmount: amount.trim() === "" ? null : amount.trim(),
        plannedYears: Number(plannedYears),
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
      <div className="grid gap-2">
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
      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Saved.</p>}
      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Saving…" : "Save details"}
      </Button>
    </form>
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
}: {
  proposalId: string;
  hasCv: boolean;
  allRequiredUploaded: boolean;
}) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await submitPreProposal(proposalId);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="border-t pt-4 flex flex-col gap-2">
      <h3 className="font-semibold">Review &amp; submit</h3>
      {!hasCv && (
        <p className="text-sm text-red-500">
          You have no CV on file. Upload one on your profile before submitting.
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
