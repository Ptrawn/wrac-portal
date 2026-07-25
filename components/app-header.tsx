import { LogoutButton } from "@/components/logout-button";

export function AppHeader({ email }: { email?: string | null }) {
  return (
    <nav className="topo-dark w-full border-b border-white/10 bg-wa-black text-wa-white">
      <div className="w-full max-w-5xl mx-auto flex justify-between items-center gap-4 px-5 h-16">
        <div className="flex items-center gap-3">
          {/* Official WA Wine logo — used verbatim, reversed variant on dark. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-white.png"
            alt="Washington State Wine"
            className="h-10 w-auto"
          />
          <span className="hidden sm:inline font-display uppercase tracking-[0.04em] text-xs text-white/70 border-l border-white/20 pl-3">
            Research Proposal Portal
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {email && (
            <span className="text-white/60 hidden sm:inline">{email}</span>
          )}
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
