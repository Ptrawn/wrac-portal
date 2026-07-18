"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DocumentRequirement, DocumentStage } from "@/lib/cycles";
import {
  addRequirement,
  copyRequirementsFromCycle,
  deactivateRequirement,
  moveRequirement,
  updateRequirement,
} from "./document-actions";

type OtherCycle = { id: string; name: string; year: number };

const STAGES: { stage: DocumentStage; title: string }[] = [
  { stage: "pre", title: "Pre-Proposal" },
  { stage: "full", title: "Full Proposal" },
  { stage: "status_report", title: "Status Report" },
  { stage: "final_report", title: "Final Report" },
];

export function DocumentRequirements({
  cycleId,
  requirements,
  otherCycles,
}: {
  cycleId: string;
  requirements: DocumentRequirement[];
  otherCycles: OtherCycle[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <CopyFromCycle
        cycleId={cycleId}
        otherCycles={otherCycles}
        existingCount={requirements.length}
      />
      {STAGES.map(({ stage, title }) => (
        <StageSection
          key={stage}
          cycleId={cycleId}
          stage={stage}
          title={title}
          requirements={requirements.filter((r) => r.stage === stage)}
        />
      ))}
    </div>
  );
}

function StageSection({
  cycleId,
  stage,
  title,
  requirements,
}: {
  cycleId: string;
  stage: DocumentStage;
  title: string;
  requirements: DocumentRequirement[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">{title}</h3>
      {requirements.length === 0 ? (
        <p className="text-sm text-muted-foreground">No document slots yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requirements.map((r, i) => (
            <RequirementRow
              key={r.id}
              requirement={r}
              cycleId={cycleId}
              stage={stage}
              isFirst={i === 0}
              isLast={i === requirements.length - 1}
            />
          ))}
        </ul>
      )}
      <AddRequirementForm cycleId={cycleId} stage={stage} />
    </div>
  );
}

function RequirementRow({
  requirement,
  cycleId,
  stage,
  isFirst,
  isLast,
}: {
  requirement: DocumentRequirement;
  cycleId: string;
  stage: DocumentStage;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(requirement.label);
  const [description, setDescription] = useState(requirement.description ?? "");
  const [isRequired, setIsRequired] = useState(requirement.is_required);
  const [acceptedTypes, setAcceptedTypes] = useState(
    requirement.accepted_file_types,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else onOk?.();
    });
  };

  const resetEdit = () => {
    setLabel(requirement.label);
    setDescription(requirement.description ?? "");
    setIsRequired(requirement.is_required);
    setAcceptedTypes(requirement.accepted_file_types);
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="border rounded-md p-3 flex flex-col gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Description (optional)</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Accepted file types (comma-separated)</Label>
          <Input
            value={acceptedTypes}
            onChange={(e) => setAcceptedTypes(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isRequired}
            onCheckedChange={(v) => setIsRequired(v === true)}
          />
          Required
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  updateRequirement(requirement.id, cycleId, {
                    label: label.trim(),
                    description: description.trim() === "" ? null : description.trim(),
                    is_required: isRequired,
                    accepted_file_types: acceptedTypes.trim(),
                  }),
                () => setEditing(false),
              )
            }
          >
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={resetEdit}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="border rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          {requirement.label}{" "}
          <span className="text-muted-foreground">
            ({requirement.is_required ? "required" : "optional"} ·{" "}
            {requirement.accepted_file_types})
          </span>
          {requirement.description && (
            <div className="text-muted-foreground text-xs mt-0.5">
              {requirement.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Move up"
            disabled={isFirst || isPending}
            onClick={() =>
              run(() => moveRequirement(requirement.id, cycleId, stage, "up"))
            }
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Move down"
            disabled={isLast || isPending}
            onClick={() =>
              run(() => moveRequirement(requirement.id, cycleId, stage, "down"))
            }
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(() => deactivateRequirement(requirement.id, cycleId))
            }
          >
            Remove
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </li>
  );
}

function AddRequirementForm({
  cycleId,
  stage,
}: {
  cycleId: string;
  stage: DocumentStage;
}) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [isRequired, setIsRequired] = useState(true);
  const [acceptedTypes, setAcceptedTypes] = useState("pdf");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addRequirement(cycleId, stage, {
        label: label.trim(),
        description: description.trim() === "" ? null : description.trim(),
        is_required: isRequired,
        accepted_file_types: acceptedTypes.trim() === "" ? "pdf" : acceptedTypes.trim(),
      });
      if (res?.error) {
        setError(res.error);
      } else {
        setLabel("");
        setDescription("");
        setIsRequired(true);
        setAcceptedTypes("pdf");
      }
    });
  };

  return (
    <form onSubmit={submit} className="border-t pt-3 flex flex-col gap-2">
      <Label className="text-xs">Add a document slot</Label>
      <Input
        placeholder="Label (e.g. Proposal narrative)"
        required
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <Input
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="flex gap-3 items-center flex-wrap">
        <div className="grid gap-1">
          <Label className="text-xs">Accepted types</Label>
          <Input
            className="w-40"
            placeholder="pdf or pdf,docx"
            value={acceptedTypes}
            onChange={(e) => setAcceptedTypes(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm mt-4">
          <Checkbox
            checked={isRequired}
            onCheckedChange={(v) => setIsRequired(v === true)}
          />
          Required
        </label>
        <Button type="submit" size="sm" disabled={isPending} className="mt-4">
          {isPending ? "Adding…" : "Add"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}

function CopyFromCycle({
  cycleId,
  otherCycles,
  existingCount,
}: {
  cycleId: string;
  otherCycles: OtherCycle[];
  existingCount: number;
}) {
  const [sourceId, setSourceId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (otherCycles.length === 0) return null;

  const doCopy = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await copyRequirementsFromCycle(cycleId, sourceId);
      if (res?.error) {
        setError(res.error);
      } else {
        setMessage(`Copied ${res.copied ?? 0} document slot(s).`);
        setConfirming(false);
        setSourceId("");
      }
    });
  };

  const onCopyClick = () => {
    setMessage(null);
    setError(null);
    if (!sourceId) {
      setError("Pick a cycle to copy from.");
      return;
    }
    if (existingCount > 0) {
      setConfirming(true);
      return;
    }
    doCopy();
  };

  return (
    <div className="border rounded-md p-3 flex flex-col gap-2">
      <Label className="text-xs">Copy document slots from another cycle</Label>
      <div className="flex gap-2 items-center">
        <select
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            setConfirming(false);
          }}
          className="border rounded-md h-9 px-2 text-sm bg-background"
        >
          <option value="">Select a cycle…</option>
          {otherCycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.year})
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={onCopyClick}
        >
          Copy
        </Button>
      </div>
      {confirming && (
        <div className="text-sm flex flex-col gap-2">
          <p>
            This cycle already has {existingCount} document slot(s); copied slots
            will be added to them.
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={isPending} onClick={doCopy}>
              {isPending ? "Copying…" : "Confirm copy"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {message && <p className="text-sm text-green-600">{message}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
