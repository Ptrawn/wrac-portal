"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBudget } from "@/lib/cycles";
import { magicFunds } from "@/lib/proposals";
import { formatAverage } from "@/lib/reviews";
import { SerialTag } from "@/components/serial-tag";
import { clearFundingDecision, setFundingDecision } from "./actions";
import { CommentsButton } from "./comments-button";

type Row = {
  proposal_id: string;
  title: string;
  serial_number: string | null;
  requested_amount: number | string | null;
  researcher_name: string | null;
  researcher_institution: string | null;
  outcome: string | null;
  funded_amount: number | string | null;
  total_score: number | string | null;
  average_score: number | string | null;
  reviews_submitted: number;
  declined_count: number;
  is_wsu: boolean;
  arc_amount: number | string | null;
  // The ARC-eligible ceiling: WSU SALARY only. The other three line items ride
  // along for context and for the magic calculation.
  arc_ceiling: number;
  wsu_salary: number | string | null;
  wsu_salary_benefits: number | string | null;
  wsu_wages: number | string | null;
  wsu_wage_benefits: number | string | null;
  funding_note: string | null;
};

export function DecisionRow({
  cycleId,
  row,
}: {
  cycleId: string;
  row: Row;
}) {
  const router = useRouter();
  const requested =
    row.requested_amount == null ? "" : String(row.requested_amount);
  const [amount, setAmount] = useState<string>(
    row.outcome === "funded" && row.funded_amount != null
      ? String(row.funded_amount)
      : requested,
  );
  // Amount to ARC (WSU only). Pre-fill from the saved decision if any, else 0 --
  // moving money to ARC is a deliberate act, so we don't auto-max it; the
  // ceiling is shown so the manager knows the maximum at a glance.
  const [arc, setArc] = useState<string>(
    row.is_wsu && row.arc_amount != null ? String(row.arc_amount) : "0",
  );
  // Manager's reasoning for the decision. Pre-filled from the saved note so a
  // re-decision doesn't silently drop it.
  const [note, setNote] = useState<string>(row.funding_note ?? "");
  const [showNote, setShowNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) setError(res.error);
      else router.refresh();
    });
  };

  const requestedNum =
    row.requested_amount == null ? null : Number(row.requested_amount);
  const fundedNum = row.funded_amount == null ? null : Number(row.funded_amount);
  const differs =
    row.outcome === "funded" &&
    fundedNum != null &&
    requestedNum != null &&
    fundedNum !== requestedNum;

  // Saved split (committed values), shown under the current decision. The pool
  // draw is funded_amount - arc_amount; magic is NOT subtracted — WSU pays it
  // outside the WRAC budget entirely.
  const savedArc = row.arc_amount == null ? 0 : Number(row.arc_amount);
  const savedPoolDraw =
    fundedNum == null ? 0 : Math.max(0, fundedNum - savedArc);
  const savedMagic = magicFunds({
    wsu_salary: row.wsu_salary,
    wsu_salary_benefits: row.wsu_salary_benefits,
    arc_amount: row.arc_amount,
  });

  // LIVE magic figure: what the ARC amount currently typed in the box would draw
  // from WSU magic funds. Benefit ratios differ by researcher, so the manager
  // needs this per project as she decides where the ARC money does most good.
  const typedArc = arc.trim() === "" ? 0 : Number(arc);
  const liveMagic = Number.isNaN(typedArc)
    ? 0
    : magicFunds({
        wsu_salary: row.wsu_salary,
        wsu_salary_benefits: row.wsu_salary_benefits,
        arc_amount: typedArc,
      });

  // The two helper lines under the inputs. Both are rendered as plain strings
  // as well as JSX so they can go in a title attribute — the lines are pinned to
  // one line (see HELPER_LINE below), so hover is the fallback if one is ever
  // clipped. Both put their dollar figure EARLY, since truncation eats the tail.
  const requestedLabel =
    row.requested_amount == null
      ? "No amount requested"
      : `of ${formatBudget(row.requested_amount)} requested`;
  const magicLabel =
    liveMagic > 0
      ? `Draws ${formatBudget(liveMagic)} from WSU magic funds`
      : "No WSU magic funds at this ARC amount";

  // Live check against what's typed in the amount box: when the manager is about
  // to fund below the request, the note is prompted (never hard-required).
  const typedAmount = amount.trim() === "" ? null : Number(amount);
  const wouldBeBelowRequest =
    typedAmount != null &&
    !Number.isNaN(typedAmount) &&
    requestedNum != null &&
    typedAmount < requestedNum;

  // The note field shows automatically for a below-request award or when one is
  // already saved; otherwise it's behind a small "add a note" toggle.
  const noteVisible = wouldBeBelowRequest || showNote || note !== "";

  // Shared classes for the two helper lines beneath the inputs. leading-[15px]
  // pins the line box explicitly (text-[10px] sets font-size ONLY, so without
  // this the height comes from Preflight's inherited line-height: 1.5), and
  // truncate keeps each to exactly one line whatever the text says. Identical on
  // both columns, so the columns stay the same height and — the container being
  // items-end — both inputs sit on one line.
  const HELPER_LINE =
    "text-[10px] leading-[15px] text-muted-foreground truncate";

  const fund = () =>
    run(() =>
      setFundingDecision(
        cycleId,
        row.proposal_id,
        true,
        amount.trim() === "" ? null : Number(amount),
        row.is_wsu ? (arc.trim() === "" ? 0 : Number(arc)) : 0,
        note.trim() === "" ? null : note.trim(),
      ),
    );

  return (
    <div className="border rounded-md p-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium flex items-center gap-2">
            {row.serial_number && (
              <SerialTag
                serialNumber={row.serial_number}
                outcome={row.outcome}
              />
            )}
            <span>{row.title}</span>
          </div>
          <div className="text-muted-foreground">
            {row.researcher_name ?? "Unknown"}
            {row.researcher_institution ? ` · ${row.researcher_institution}` : ""}
          </div>
        </div>
        <div className="text-right text-sm shrink-0">
          <div>Requested {formatBudget(row.requested_amount)}</div>
          <div className="text-muted-foreground text-xs">
            Score {row.total_score == null ? 0 : Number(row.total_score)} · avg{" "}
            {formatAverage(row.average_score)} · {row.reviews_submitted} reviews
            {row.declined_count > 0 && (
              <span className="text-status-review">
                {" "}
                · {row.declined_count} declined
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Current decision */}
      <div className="text-sm">
        {row.outcome === "funded" ? (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-status-funded">
              Funded {formatBudget(row.funded_amount)}
              {differs && (
                <span className="text-status-review">
                  {" "}
                  of {formatBudget(row.requested_amount)} requested
                </span>
              )}
            </span>
            {row.is_wsu && (
              <span className="text-xs text-muted-foreground">
                {savedArc > 0 ? (
                  <>
                    {formatBudget(savedArc)} from ARC ·{" "}
                    {formatBudget(savedPoolDraw)} from main pool
                    {savedMagic > 0 && (
                      <> · {formatBudget(savedMagic)} from WSU magic funds</>
                    )}
                  </>
                ) : (
                  <>All {formatBudget(savedPoolDraw)} from main pool (none to ARC)</>
                )}
              </span>
            )}
          </div>
        ) : row.outcome === "not_funded" ? (
          <span className="font-medium text-muted-foreground">Declined</span>
        ) : (
          <span className="text-muted-foreground">Undecided</span>
        )}
        {row.funding_note && (
          <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
            <span className="font-medium">Note:</span> {row.funding_note}
          </div>
        )}
      </div>

      {/* WSU budget detail. Only SALARY is ARC-eligible; the other three items
          are shown for context because they're part of how the researcher built
          the request, and salary benefits is what WSU magic funds cover. */}
      {row.is_wsu && (
        <div className="text-xs rounded-md border border-status-review/40 bg-status-review/5 p-2 flex flex-col gap-1">
          <div>
            <span className="font-medium text-status-review">WSU proposal.</span>{" "}
            Only WSU Salary is ARC-eligible — the rest is context.
          </div>
          <ul className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            <li className="font-medium">WSU Salary (ARC-eligible)</li>
            <li className="text-right font-semibold tabular-nums">
              {formatBudget(row.wsu_salary)}
            </li>
            <li className="text-muted-foreground">WSU Salary Benefits</li>
            <li className="text-right tabular-nums text-muted-foreground">
              {formatBudget(row.wsu_salary_benefits)}
            </li>
            <li className="text-muted-foreground">WSU Wages</li>
            <li className="text-right tabular-nums text-muted-foreground">
              {formatBudget(row.wsu_wages)}
            </li>
            <li className="text-muted-foreground">WSU Wage Benefits</li>
            <li className="text-right tabular-nums text-muted-foreground">
              {formatBudget(row.wsu_wage_benefits)}
            </li>
          </ul>
          <div className="text-muted-foreground">
            Salary benefits are covered by WSU magic funds in proportion to the
            salary you move to ARC.
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] uppercase text-muted-foreground">
            Funded amount
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            className="w-36"
            aria-label="Funded amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {/* Matches the ARC column's live-magic line so both columns are the
              same height and both inputs sit on one line. It also earns its
              place: the request is the figure she is deciding against. */}
          <span className={HELPER_LINE} title={requestedLabel}>
            {requestedLabel}
          </span>
        </div>
        {row.is_wsu && (
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] uppercase text-muted-foreground">
              Amount to ARC (max salary {formatBudget(row.arc_ceiling)})
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              max={Math.min(
                row.arc_ceiling,
                amount.trim() === "" ? row.arc_ceiling : Number(amount),
              )}
              className="w-36"
              aria-label="Amount to ARC"
              value={arc}
              onChange={(e) => setArc(e.target.value)}
            />
            {/* Live: what the typed ARC amount pulls in from WSU. Updates as she
                types, so she can see the effect per project while deciding. */}
            <span className={HELPER_LINE} title={magicLabel}>
              {liveMagic > 0 ? (
                <>
                  Draws{" "}
                  <span className="font-semibold">
                    {formatBudget(liveMagic)}
                  </span>{" "}
                  from WSU magic funds
                </>
              ) : (
                <>No WSU magic funds at this ARC amount</>
              )}
            </span>
          </div>
        )}
        <Button size="sm" disabled={isPending} onClick={fund}>
          Fund
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            run(() =>
              setFundingDecision(cycleId, row.proposal_id, false, null),
            )
          }
        >
          Decline
        </Button>
        {row.outcome && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => clearFundingDecision(cycleId, row.proposal_id))}
          >
            Clear
          </Button>
        )}
        <CommentsButton proposalId={row.proposal_id} proposalTitle={row.title} />
      </div>

      {/* Funding note. Always available; auto-revealed and emphasised when the
          typed amount is below the request. Never hard-required. */}
      {noteVisible ? (
        <div
          className={
            "flex flex-col gap-1 rounded-md p-2 " +
            (wouldBeBelowRequest
              ? "border border-status-review/40 bg-status-review/5"
              : "border")
          }
        >
          <label
            htmlFor={`note-${row.proposal_id}`}
            className={
              "text-xs " +
              (wouldBeBelowRequest
                ? "font-medium text-status-review"
                : "text-muted-foreground")
            }
          >
            {wouldBeBelowRequest
              ? "Why was this funded below the request?"
              : "Funding note (optional)"}
          </label>
          <textarea
            id={`note-${row.proposal_id}`}
            className="flex min-h-14 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder={
              wouldBeBelowRequest
                ? "e.g. Scaled to the available pool; equipment line deferred to year 2."
                : "Reasoning for this decision (optional)"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <span className="text-[10px] text-muted-foreground">
            Saved with the decision when you press Fund.
            {wouldBeBelowRequest
              ? " Expected for a below-request award, but not required."
              : ""}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-4 w-fit"
          onClick={() => setShowNote(true)}
        >
          Add a funding note (optional)
        </button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
