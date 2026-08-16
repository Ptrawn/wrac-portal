"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  getCycleTemplateUrl,
  removeCycleTemplate,
  setCycleTemplate,
} from "../actions";

const ACCEPTED = ["pdf", "docx", "doc"];

/**
 * The per-cycle proposal template. The file is uploaded straight to the private
 * 'cycle-templates' bucket at '{cycle_id}/template.{ext}' (manager-only by
 * storage policy, same client-side upload pattern the proposal document slots
 * use), then a server action records the path + original filename on the cycle.
 */
export function CycleTemplate({
  cycleId,
  templatePath,
  templateName,
}: {
  cycleId: string;
  templatePath: string | null;
  templateName: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [isPending, startTransition] = useTransition();

  const upload = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setError(null);

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      setError(`Accepted file types: ${ACCEPTED.join(", ")}.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const path = `${cycleId}/template.${ext}`;

      // Replacing with a different extension would orphan the old object.
      if (templatePath && templatePath !== path) {
        await supabase.storage.from("cycle-templates").remove([templatePath]);
      }

      const { error: uploadError } = await supabase.storage
        .from("cycle-templates")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const res = await setCycleTemplate(cycleId, path, file.name);
      if (res?.error) throw new Error(res.error);

      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const view = async () => {
    if (!templatePath) return;
    setError(null);
    const res = await getCycleTemplateUrl(templatePath);
    if (res.error) setError(res.error);
    else if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const remove = () => {
    if (!templatePath) return;
    setError(null);
    startTransition(async () => {
      const res = await removeCycleTemplate(cycleId, templatePath);
      if (res?.error) setError(res.error);
      else {
        setConfirmingRemove(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Upload the template or guidance document that shows researchers what this
        cycle&apos;s proposal should contain. Researchers see it on their proposal
        workspace at both the pre- and full-proposal stages; committee members see
        it as review context.
      </p>

      {templatePath ? (
        <div className="rounded-md border p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm min-w-0">
              <span className="font-medium">Current template: </span>
              <span className="text-muted-foreground break-all">
                {templateName ?? templatePath}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={view}>
                View
              </Button>
              {!confirmingRemove && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending || busy}
                  onClick={() => setConfirmingRemove(true)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>

          {confirmingRemove && (
            <div className="text-sm flex flex-col gap-2 border rounded-md p-3">
              <p>
                This deletes the file and leaves this cycle with no template.
                Researchers will stop seeing it. Continue?
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isPending}
                  onClick={remove}
                >
                  {isPending ? "Removing…" : "Remove template"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => setConfirmingRemove(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              Replace with a new file ({ACCEPTED.join(", ")})
            </label>
            <Input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.map((e) => `.${e}`).join(",")}
              disabled={busy}
              onChange={upload}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">
            Upload a template ({ACCEPTED.join(", ")})
          </label>
          <Input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.map((e) => `.${e}`).join(",")}
            disabled={busy}
            onChange={upload}
          />
        </div>
      )}

      {busy && <p className="text-xs text-muted-foreground">Uploading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
