"use client";

import { useState } from "react";

import { getProposalFileUrl } from "../actions";

type Doc = { id: string; file_name: string; file_path: string };

export function ManagerDocs({
  documents,
  cvSnapshotPath,
}: {
  documents: Doc[];
  cvSnapshotPath: string | null;
}) {
  const [error, setError] = useState<string | null>(null);

  const view = async (path: string) => {
    setError(null);
    const res = await getProposalFileUrl(path);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const hasAny = documents.length > 0 || Boolean(cvSnapshotPath);

  return (
    <div className="text-sm">
      <div className="font-medium mb-1">Documents</div>
      {!hasAny ? (
        <p className="text-muted-foreground">No documents uploaded.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground truncate">
                {d.file_name}
              </span>
              <button
                type="button"
                onClick={() => view(d.file_path)}
                className="underline underline-offset-4 shrink-0"
              >
                View
              </button>
            </li>
          ))}
          {cvSnapshotPath && (
            <li className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground truncate">
                CV (snapshot at submission)
              </span>
              <button
                type="button"
                onClick={() => view(cvSnapshotPath)}
                className="underline underline-offset-4 shrink-0"
              >
                View
              </button>
            </li>
          )}
        </ul>
      )}
      {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
    </div>
  );
}
