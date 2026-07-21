# Research Proposal Portal — Project Context

## What this is
A web portal for the **Washington State Wine Commission — Research Advisory Committee**. Researchers register and submit research proposals; committee members review and score them; a program manager runs an annual funding cycle and recommends projects to the Commission. Full specification is in `docs/scope.md` — read it when working on any feature; this file is only the quick standing brief.

## Roles (three sign in; a fourth is output-only)
- **Researcher** — self-registers, then must be approved by the Manager before doing anything. Account and history persist across years.
- **Committee Member** — invited by the Manager (no self-registration). Reviews and scores. Reviews are siloed: a member never sees another member's scores or comments.
- **Program Manager** — runs everything: approves researchers, builds each annual cycle, invites committee members, advances proposals, runs the allocation meeting, records funding, sets report deadlines.
- **Commission** — NOT a system user. Receives a generated report only.

## Stack
- Next.js (App Router, Turbopack) on Vercel
- Supabase: Postgres, Auth (cookie-based, already wired via the with-supabase starter), Storage
- Resend for email (later phase)
- Node 24 LTS

## Locked decisions
- Two data layers: **persistent** (researcher accounts, profiles, CV, full proposal/report history across all years) and **per-cycle** (calendar, total budget, review question sets, document requirements — the Manager rebuilds these each year).
- Proposals are **uploaded documents**, not authored in-app. Each stage has Manager-defined document slots (name, required/optional, file type), configurable per cycle.
- Multi-year projects require a **fresh resubmission each year**, funded from that year's pool.
- Full/off-cycle proposals carry a **per-year budget breakdown as structured data** (feeds the allocation and projection tools), separate from any uploaded budget document.
- The allocation tool is **Manager-only**, shown on a screen in the deliberation meeting — no real-time multi-user sync needed.
- Reviews are **siloed** — no reviewer sees another's scores/comments.
- Off-cycle funding comes from a **separate source, outside the annual pool**.
- Proposal submission is **soft-locked**: the Manager can reopen a submission before the deadline.
- All committee members review and score every proposal in a stage (no per-member assignment). Total and average scores are computed across all members.
- **`cacheComponents` (partial prerendering) is intentionally disabled** in `next.config.ts`. Every route is auth-gated — each page reads the per-request session and `redirect()`s on it — so there is no cacheable static shell to prerender. Leaving it on broke `next build` ("Uncached data accessed outside `<Suspense>`") for no benefit; standard dynamic SSR is the right fit.

## Working rules
- Build one vertical slice at a time and verify it end to end before starting the next. Don't build breadth ahead of need.
- Enforce role boundaries with Postgres Row Level Security, not just UI checks.
- Keep auth standard; extend the starter rather than reworking it.
- Confirm email is currently OFF for seeding initial users; it must go ON before real researcher self-signup. Design registration flows to work with confirmation ON.

## Backlog (deferred, not yet built)
- Manager editing of researcher profiles: the Manager needs to update details on a researcher's profile (name, institution, CV, etc.), not just approve/reject. The data layer currently allows only own-row updates plus the approve_researcher / reject_researcher RPCs; add a manager-update path (RLS policy or dedicated RPC, with the self-elevation guard still respected) when this is built.
