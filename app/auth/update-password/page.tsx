import { UpdatePasswordForm } from "@/components/update-password-form";

// Branded to match /auth/login -- this is where the emailed reset link lands.
export default function Page() {
  return (
    <div className="topo-dark flex min-h-svh w-full flex-col items-center justify-center gap-8 bg-wa-black p-6 md:p-10">
      {/* Official WA Wine logo — verbatim reversed variant on the dark screen. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-white.png"
        alt="Washington State Wine"
        className="h-24 w-auto"
      />
      <div className="w-full max-w-sm">
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
