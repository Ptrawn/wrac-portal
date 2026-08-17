"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field with a show/hide toggle. Always starts hidden. The toggle is
 * a real <button>, so it's keyboard reachable and announces its state; it's
 * excluded from the tab order only in the sense that it follows the field
 * naturally.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false);
  const fallbackId = useId();
  const inputId = props.id ?? fallbackId;

  return (
    <div className="relative">
      <Input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        // Room for the toggle so long values don't run underneath it.
        className={cn("pr-16", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={inputId}
        title={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center gap-1 px-3 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-r-md"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
        <span aria-hidden="true">{visible ? "Hide" : "Show"}</span>
      </button>
    </div>
  );
}
