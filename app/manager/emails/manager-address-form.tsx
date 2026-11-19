"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveManagerAddress } from "./actions";

export function ManagerAddressForm({ current }: { current: string }) {
  const router = useRouter();
  const [address, setAddress] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirty = address.trim() !== current.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveManagerAddress(address);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-2 max-w-md">
        <Label htmlFor="manager-address">Notification address</Label>
        <Input
          id="manager-address"
          type="email"
          required
          value={address}
          placeholder="manager@washingtonwine.org"
          onChange={(e) => {
            setAddress(e.target.value);
            setSaved(false);
          }}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !dirty && (
        <p className="text-sm text-muted-foreground">Saved.</p>
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={isPending || !dirty}
      >
        {isPending ? "Saving…" : "Save address"}
      </Button>
    </form>
  );
}
