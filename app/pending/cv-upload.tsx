"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function CvUpload({
  userId,
  initialCvPath,
}: {
  userId: string;
  initialCvPath: string | null;
}) {
  const [cvPath, setCvPath] = useState<string | null>(initialCvPath);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF file first.");
      return;
    }
    if (file.type !== "application/pdf") {
      setError("CV must be a PDF file.");
      return;
    }

    setIsUploading(true);
    try {
      const supabase = createClient();
      // First path segment MUST equal the user's id, or storage RLS rejects it.
      const path = `${userId}/cv.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("cvs")
        .upload(path, file, { upsert: true, contentType: "application/pdf" });
      if (uploadError) throw uploadError;

      // Own-row update — allowed by RLS; the self-elevation guard only blocks
      // role/status changes.
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ cv_path: path })
        .eq("id", userId);
      if (updateError) throw updateError;

      setCvPath(path);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form onSubmit={handleUpload} className="flex flex-col gap-3">
      <p className="text-sm">
        {cvPath ? (
          <span className="text-foreground">
            A CV is on file. You can replace it below.
          </span>
        ) : (
          <span className="text-muted-foreground">No CV uploaded yet.</span>
        )}
      </p>
      <div className="grid gap-2">
        <Label htmlFor="cv">{cvPath ? "Replace CV (PDF)" : "Upload CV (PDF)"}</Label>
        <Input
          id="cv"
          ref={inputRef}
          type="file"
          accept="application/pdf"
          required
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <Button type="submit" disabled={isUploading} className="w-fit">
        {isUploading ? "Uploading..." : cvPath ? "Replace CV" : "Upload CV"}
      </Button>
    </form>
  );
}
