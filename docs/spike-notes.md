# Phase 0 spike notes

## Resume latency (2026-07-05, region sjc, shared 2 vCPU / 4 GB, runner-v0 image)

Idle machine (`sleep`), measured via Machines API `/wait?state=started`:

| Path | Runs | Latency |
|---|---|---|
| suspend → start | 3 | 0.80 s, 0.76 s, 0.71 s |
| stop → start | 1 | 1.59 s |

**Policy conclusion (answers PRD Open Question #1):** stop→start is only ~0.8 s
slower than suspend→start and costs $0.15/GB/mo rootfs instead of held RAM.
Hibernation policy for T4: suspend on `awaiting_user` (instant resume for
quick replies), demote to **stop after 2 min** suspended (not the guide's
10 min — resume is cheap enough that holding RAM longer buys nothing).
Caveat: idle-machine numbers; a machine with a hot node process + big
workspace may resume slower from stop. Re-measure once real sessions run.

## Still open (needs Umans key + GitHub PAT)
- End-to-end agent run → real PR (T1.3)
- Model variance across 5–10 runs (T1.5)
