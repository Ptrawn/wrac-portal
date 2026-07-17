"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReviewQuestion, ReviewStage } from "@/lib/cycles";
import {
  addQuestion,
  copyQuestionsFromCycle,
  deactivateQuestion,
  moveQuestion,
  updateQuestion,
} from "./question-actions";

type OtherCycle = { id: string; name: string; year: number };

export function QuestionSets({
  cycleId,
  preQuestions,
  fullQuestions,
  otherCycles,
}: {
  cycleId: string;
  preQuestions: ReviewQuestion[];
  fullQuestions: ReviewQuestion[];
  otherCycles: OtherCycle[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <CopyFromCycle
        cycleId={cycleId}
        otherCycles={otherCycles}
        existingCount={preQuestions.length + fullQuestions.length}
      />
      <StageSection
        cycleId={cycleId}
        stage="pre"
        title="Pre-Proposal Questions"
        questions={preQuestions}
      />
      <StageSection
        cycleId={cycleId}
        stage="full"
        title="Full-Proposal Questions"
        questions={fullQuestions}
      />
    </div>
  );
}

function StageSection({
  cycleId,
  stage,
  title,
  questions,
}: {
  cycleId: string;
  stage: ReviewStage;
  title: string;
  questions: ReviewQuestion[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">{title}</h3>
      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {questions.map((q, i) => (
            <QuestionRow
              key={q.id}
              question={q}
              cycleId={cycleId}
              stage={stage}
              isFirst={i === 0}
              isLast={i === questions.length - 1}
            />
          ))}
        </ul>
      )}
      <AddQuestionForm cycleId={cycleId} stage={stage} />
    </div>
  );
}

function QuestionRow({
  question,
  cycleId,
  stage,
  isFirst,
  isLast,
}: {
  question: ReviewQuestion;
  cycleId: string;
  stage: ReviewStage;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [scoreMin, setScoreMin] = useState(String(question.score_min));
  const [scoreMax, setScoreMax] = useState(String(question.score_max));
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
    setPrompt(question.prompt);
    setScoreMin(String(question.score_min));
    setScoreMax(String(question.score_max));
    setError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="border rounded-md p-3 flex flex-col gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Prompt</Label>
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
          />
        </div>
        <div className="flex gap-2">
          <div className="grid gap-1">
            <Label className="text-xs">Min</Label>
            <Input
              type="number"
              className="w-20"
              value={scoreMin}
              onChange={(e) => setScoreMin(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Max</Label>
            <Input
              type="number"
              className="w-20"
              value={scoreMax}
              onChange={(e) => setScoreMax(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={isPending}
            onClick={() =>
              run(
                () =>
                  updateQuestion(question.id, cycleId, {
                    prompt: prompt.trim(),
                    score_min: Number(scoreMin),
                    score_max: Number(scoreMax),
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
          {question.prompt}{" "}
          <span className="text-muted-foreground">
            ({question.score_min}–{question.score_max})
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Move up"
            disabled={isFirst || isPending}
            onClick={() =>
              run(() => moveQuestion(question.id, cycleId, stage, "up"))
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
              run(() => moveQuestion(question.id, cycleId, stage, "down"))
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
              run(() => deactivateQuestion(question.id, cycleId))
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

function AddQuestionForm({
  cycleId,
  stage,
}: {
  cycleId: string;
  stage: ReviewStage;
}) {
  const [prompt, setPrompt] = useState("");
  const [scoreMin, setScoreMin] = useState("0");
  const [scoreMax, setScoreMax] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addQuestion(cycleId, stage, {
        prompt: prompt.trim(),
        score_min: Number(scoreMin),
        score_max: Number(scoreMax),
      });
      if (res?.error) {
        setError(res.error);
      } else {
        setPrompt("");
        setScoreMin("0");
        setScoreMax("10");
      }
    });
  };

  return (
    <form onSubmit={submit} className="border-t pt-3 flex flex-col gap-2">
      <Label className="text-xs">Add a question</Label>
      <Input
        placeholder="Question prompt"
        required
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="flex gap-2 items-end">
        <div className="grid gap-1">
          <Label className="text-xs">Min</Label>
          <Input
            type="number"
            className="w-20"
            value={scoreMin}
            onChange={(e) => setScoreMin(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Max</Label>
          <Input
            type="number"
            className="w-20"
            value={scoreMax}
            onChange={(e) => setScoreMax(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={isPending}>
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
      const res = await copyQuestionsFromCycle(cycleId, sourceId);
      if (res?.error) {
        setError(res.error);
      } else {
        setMessage(`Copied ${res.copied ?? 0} question(s).`);
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
      <Label className="text-xs">Copy questions from another cycle</Label>
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
            This cycle already has {existingCount} question(s); copied questions
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
