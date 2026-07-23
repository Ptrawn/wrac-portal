"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { DocumentRequirement } from "@/lib/cycles";
import {
  getReportFileUrl,
  saveReportNarrative,
  submitReport,
} from "../actions";

export type ReportDoc = {
  id: string;
  requirement_id: string;
  file_path: string;
  file_name: string;
};

type Props = {
  reportId: string;
  state: string;
  editable: boolean;
  initialNarrative: string;
  requirements: DocumentRequirement[];
  documents: ReportDoc[];
};

export function ReportWorkspace(props: Props) {
  const { reportId, state, editable, requirements, documents } = props;

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
          This report is locked ({state}). It can no longer be edited. Documents
          remain viewable below. The program manager can reopen it if a
          correction is needed.
        </div>
      )}

      <NarrativeSection
        reportId={reportId}
        editable={editable}
        initialNarrative={props.initialNarrative}
        allRequiredUploaded={allRequiredUploaded}
      />

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
            No document slots are defined for this report stage.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requirements.map((req) => (
              <ReportDocSlot
                key={req.id}
                reportId={reportId}
                editable={editable}
                requirement={req}
                document={
                  documents.find((d) => d.requirement_id === req.id) ?? null
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NarrativeSection({
  reportId,
  editable,
  initialNarrative,
  allRequiredUploaded,
}: {
  reportId: string;
  editable: boolean;
  initialNarrative: string;
  allRequiredUploaded: boolean;
}) {
  const router = useRouter();
  const [narrative, setNarrative] = useState(initialNarrative);
  const [savedNarrative, setSavedNarrative] = useState(initialNarrative);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, startSave] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();

  const dirty = narrative !== savedNarrative;

  const save = () => {
    setError(null);
    setSaved(false);
    startSave(async () => {
      const res = await saveReportNarrative(reportId, narrative);
      if (res?.error) setError(res.error);
      else {
        setSavedNarrative(narrative);
        setSaved(true);
        router.refresh();
      }
    });
  };

  const submit = () => {
    setError(null);
    startSubmit(async () => {
      const res = await submitReport(reportId);
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  if (!editable) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Narrative</h3>
        {savedNarrative.trim() === "" ? (
          <p className="text-sm text-muted-foreground">No narrative.</p>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{savedNarrative}</p>
        )}
      </div>
    );
  }

  const canSubmit =
    !dirty &&
    savedNarrative.trim() !== "" &&
    allRequiredUploaded &&
    !isSaving &&
    !isSubmitting;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="narrative">Narrative</Label>
        <textarea
          id="narrative"
          className="border rounded-md p-2 text-sm min-h-40 bg-background"
          value={narrative}
          onChange={(e) => {
            setNarrative(e.target.value);
            setSaved(false);
          }}
          placeholder="Describe progress, findings, and any changes to the plan…"
        />
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={isSaving || !dirty}
            onClick={save}
          >
            {isSaving ? "Saving…" : "Save narrative"}
          </Button>
          {saved && !dirty && (
            <span className="text-sm text-green-600">Saved.</span>
          )}
          {dirty && (
            <span className="text-sm text-muted-foreground">
              Unsaved changes.
            </span>
          )}
        </div>
      </div>

      <div className="border-t pt-4 flex flex-col gap-2">
        <h3 className="font-semibold">Submit report</h3>
        {savedNarrative.trim() === "" && (
          <p className="text-sm text-muted-foreground">
            Enter and save a narrative before submitting.
          </p>
        )}
        {dirty && savedNarrative.trim() !== "" && (
          <p className="text-sm text-muted-foreground">
            Save your narrative before submitting.
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
            disabled={!canSubmit}
            onClick={() => setReviewing(true)}
          >
            Submit report
          </Button>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Once submitted, your report is locked unless the program manager
              reopens it. Continue?
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={isSubmitting} onClick={submit}>
                {isSubmitting ? "Submitting…" : "Submit report"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => setReviewing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}

function ReportDocSlot({
  reportId,
  editable,
  requirement,
  document: doc,
}: {
  reportId: string;
  editable: boolean;
  requirement: DocumentRequirement;
  document: ReportDoc | null;
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
    const res = await getReportFileUrl(doc.file_path);
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
      const path = `${reportId}/${requirement.id}.${ext}`;

      // Replacing a file stored at a different extension: remove the old object.
      if (doc && doc.file_path !== path) {
        await supabase.storage.from("reports").remove([doc.file_path]);
      }

      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { error: rowError } = await supabase
        .from("report_documents")
        .upsert(
          {
            report_id: reportId,
            requirement_id: requirement.id,
            file_path: path,
            file_name: file.name,
            file_size: file.size,
          },
          { onConflict: "report_id,requirement_id" },
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
        .from("reports")
        .remove([doc.file_path]);
      if (storageError) throw storageError;
      const { error: rowError } = await supabase
        .from("report_documents")
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
