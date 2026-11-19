"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  previewTemplate,
  resetTemplate,
  saveTemplate,
  sendTestEmail,
  type PreviewResult,
} from "../actions";

/** How long after the last keystroke the preview re-renders. */
const PREVIEW_DEBOUNCE_MS = 400;

const OUTCOME_TEXT: Record<string, string> = {
  sent: "Sent. Check your inbox.",
  logged:
    "Recorded in the send log, but not delivered — this environment is in log-only mode.",
  duplicate: "Skipped as a duplicate (this shouldn't happen for a test).",
  skipped_off: "Skipped because the type is off (this shouldn't happen for a test).",
};

export function TemplateEditor({
  emailKey,
  allowedPlaceholders,
  defaultSubject,
  defaultBody,
  savedSubject,
  savedBody,
  testAddress,
}: {
  emailKey: string;
  allowedPlaceholders: string[];
  defaultSubject: string;
  defaultBody: string;
  /** The stored override, or null when this type uses the default. */
  savedSubject: string | null;
  savedBody: string | null;
  testAddress: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(savedSubject ?? defaultSubject);
  const [body, setBody] = useState(savedBody ?? defaultBody);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testFailed, setTestFailed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Which field a chip inserts into. Tracked on focus rather than guessed, so
  // clicking a chip puts {placeholder} where the manager was actually typing.
  const lastFocused = useRef<"subject" | "body">("body");

  const dirty =
    subject !== (savedSubject ?? defaultSubject) ||
    body !== (savedBody ?? defaultBody);
  const matchesDefault =
    subject.trim() === defaultSubject.trim() && body.trim() === defaultBody.trim();

  /**
   * The preview is rendered by the SERVER, by the same renderTemplate the send
   * path uses with the same allowed-placeholder list. That is the whole point:
   * if it previews, it sends. A failure replaces the preview and blocks Save,
   * rather than letting copy through that would fail at send time.
   */
  const refreshPreview = useCallback(
    (nextSubject: string, nextBody: string) => {
      setPreviewing(true);
      previewTemplate(emailKey, nextSubject, nextBody)
        .then((res) => setPreview(res))
        .catch((err: unknown) =>
          setPreview({
            ok: false,
            error:
              err instanceof Error
                ? err.message
                : "The preview could not be rendered.",
          }),
        )
        .finally(() => setPreviewing(false));
    },
    [emailKey],
  );

  useEffect(() => {
    const t = setTimeout(
      () => refreshPreview(subject, body),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [subject, body, refreshPreview]);

  /** Insert {name} at the cursor in whichever field was last focused. */
  const insertPlaceholder = (name: string) => {
    const token = `{${name}}`;
    setSaved(false);
    if (lastFocused.current === "subject") {
      const el = subjectRef.current;
      const at = el?.selectionStart ?? subject.length;
      const next = subject.slice(0, at) + token + subject.slice(at);
      setSubject(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at + token.length, at + token.length);
      });
      return;
    }
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    const next = body.slice(0, at) + token + body.slice(at);
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const save = () => {
    setSaveError(null);
    setSaved(false);
    setTestResult(null);
    startTransition(async () => {
      const res = await saveTemplate(emailKey, subject, body);
      if (res?.error) {
        setSaveError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  const reset = () => {
    if (
      !window.confirm(
        "Reset this email to the default wording? Your edited subject and body will be discarded.",
      )
    ) {
      return;
    }
    setSaveError(null);
    setSaved(false);
    setTestResult(null);
    startTransition(async () => {
      const res = await resetTemplate(emailKey);
      if (res?.error) {
        setSaveError(res.error);
        return;
      }
      setSubject(defaultSubject);
      setBody(defaultBody);
      setSaved(true);
      router.refresh();
    });
  };

  const sendTest = () => {
    setTestResult(null);
    setTestFailed(false);
    startTransition(async () => {
      const res = await sendTestEmail(emailKey);
      if (res.error) {
        setTestFailed(true);
        setTestResult(res.error);
        return;
      }
      const text =
        OUTCOME_TEXT[res.outcome ?? ""] ?? `Outcome: ${res.outcome}.`;
      setTestResult(res.to ? `${text} (to ${res.to})` : text);
      router.refresh();
    });
  };

  const previewFailed = preview != null && !preview.ok;

  return (
    <div className="flex flex-col gap-5">
      {/* Placeholders */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Placeholders
        </span>
        <div className="flex flex-wrap gap-2">
          {allowedPlaceholders.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => insertPlaceholder(p)}
              className="font-mono text-xs border border-line bg-sunken px-2 py-1 rounded-sm hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`Insert {${p}} at the cursor`}
            >
              {`{${p}}`}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Click to insert at the cursor. Only these are allowed — anything else
          blocks saving.
        </p>
      </div>

      {/* Editor */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email-subject">Subject</Label>
        <Input
          id="email-subject"
          ref={subjectRef}
          value={subject}
          onFocus={() => {
            lastFocused.current = "subject";
          }}
          onChange={(e) => {
            setSubject(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email-body">Body</Label>
        <textarea
          id="email-body"
          ref={bodyRef}
          className="border rounded-md p-2 text-sm min-h-56 bg-background font-mono"
          value={body}
          onFocus={() => {
            lastFocused.current = "body";
          }}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
        />
      </div>

      {/* Preview */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Preview {previewing && <span className="font-normal">(updating…)</span>}
        </span>
        {preview == null ? (
          <p className="text-sm text-muted-foreground">Rendering…</p>
        ) : preview.ok ? (
          <div className="border rounded-md p-3 flex flex-col gap-2 bg-sunken">
            <div className="text-sm font-medium">{preview.subject}</div>
            <pre className="text-sm whitespace-pre-wrap font-sans">
              {preview.bodyText}
            </pre>
            <p className="text-xs text-muted-foreground">
              Shown with this type&apos;s sample values.
            </p>
          </div>
        ) : (
          <div className="border border-destructive/50 bg-destructive/5 rounded-md p-3">
            <p className="text-sm font-medium text-destructive">
              This wording can&apos;t be sent
            </p>
            <p className="text-sm mt-1">{preview.error}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {saveError && <p className="text-sm text-destructive">{saveError}</p>}
      {saved && !dirty && (
        <p className="text-sm text-muted-foreground">
          Saved.{" "}
          {matchesDefault
            ? "This type is back to the default wording."
            : "This type now uses your wording."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={isPending || previewFailed || !dirty}
          title={
            previewFailed
              ? "Fix the error above before saving"
              : !dirty
                ? "No changes to save"
                : undefined
          }
        >
          {isPending ? "Working…" : "Save wording"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={reset}
          disabled={isPending}
        >
          Reset to default
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={sendTest}
          disabled={isPending || !testAddress}
          title={
            testAddress
              ? `Send the saved wording to ${testAddress}`
              : "Your account has no email address"
          }
        >
          Send test to me
        </Button>
      </div>
      {dirty && (
        <p className="text-xs text-muted-foreground">
          A test sends the <strong>saved</strong> wording, not your unsaved
          edits.
        </p>
      )}
      {testResult && (
        <p
          className={
            "text-sm " + (testFailed ? "text-destructive" : "text-muted-foreground")
          }
        >
          {testResult}
        </p>
      )}
    </div>
  );
}
