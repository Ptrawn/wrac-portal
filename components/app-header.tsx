import { LogoutButton } from "@/components/logout-button";

export function AppHeader({ email }: { email?: string | null }) {
  return (
    <nav className="w-full border-b border-b-foreground/10 h-16">
      <div className="w-full max-w-5xl mx-auto flex justify-between items-center p-3 px-5 text-sm">
        <span className="font-semibold">Research Proposal Portal</span>
        <div className="flex items-center gap-4">
          {email && (
            <span className="text-muted-foreground hidden sm:inline">
              {email}
            </span>
          )}
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
