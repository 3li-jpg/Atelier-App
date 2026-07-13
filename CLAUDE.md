# Atelier — agent conventions

## Orchestrator + GLM 5.2 subagents

The main Claude session is the orchestrator only: it plans, splits work, reviews diffs. Delegated implementation work runs on GLM 5.2 via the umans CLI (auth already saved in `~/.umans/config.json`).

Spawn a worker with Bash (`run_in_background: true`), **max 3 concurrent**:

```bash
umans claude --model umans-glm-5.2 --dangerously-skip-permissions -p "<self-contained task>"
```

Rules:
- Each task prompt must be self-contained: file paths, context, and acceptance criteria. Workers share no conversation state.
- Give parallel workers disjoint file scopes so they never edit the same file.
- Orchestrator reviews every worker's diff (git diff) before committing; workers never commit.
- More than 3 units of work → run in waves of ≤3.
