import { displaySerial } from "@/lib/proposals";

/**
 * Compact monospaced identifier tag for a proposal's serial number (e.g. 27-001,
 * or 27-001F when funded). A proposal with no serial yet (draft/not submitted)
 * renders a subtle placeholder rather than an empty box.
 */
export function SerialTag({
  serialNumber,
  outcome,
  className,
}: {
  serialNumber: string | null | undefined;
  outcome: string | null | undefined;
  className?: string;
}) {
  const serial = displaySerial(serialNumber, outcome);
  if (!serial) {
    return (
      <span
        className={"text-xs text-muted-foreground " + (className ?? "")}
        title="No serial until submitted"
      >
        —
      </span>
    );
  }
  return (
    <span
      className={
        "num inline-flex items-center rounded-none border border-line bg-sunken px-1.5 py-0.5 text-xs font-medium leading-none " +
        (className ?? "")
      }
    >
      {serial}
    </span>
  );
}
