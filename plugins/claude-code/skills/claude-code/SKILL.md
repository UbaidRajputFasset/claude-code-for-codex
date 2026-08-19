---
name: claude-code
description: Use the locally installed Claude Code CLI from Codex for second opinions, reviews, implementation delegation, background jobs, job status and logs, cancellation, and resumable sessions. Trigger when the user asks to use, ask, consult, review with, delegate to, background, resume, or check work from Claude or Claude Code.
---

# Claude Code

Use the typed companion at `../../scripts/claude-companion.mjs`. Resolve that path from this skill directory to an absolute path before invoking it. Pass prompts as single process arguments; never build a shell command from prompt text.

## Readiness

Run `node <companion> doctor` before the first Claude operation in a turn.

- If `installed` is false, identify the platform and show the matching official installer. Run it only after the user approves:
  - macOS, Linux, or WSL: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
  - Windows CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`
- If `authenticated` is false, run `node <companion> login` in a TTY, let Claude Code own the browser flow, then rerun `doctor`. Stop if authentication remains false.
- If a background operation is requested while `backgroundJobs` is false, tell the user to update Claude Code or ask their administrator to enable agent view. Do not create a substitute job system.

Never request, print, or store Claude credentials.

## Route the request

- Consultation, explanation, review, or second opinion without edits: `node <companion> ask '<prompt>'`
- Explicit implementation, fix, or file-edit request: `node <companion> delegate '<prompt>'`
- Explicit background analysis: `node <companion> start '<prompt>'`
- Explicit background implementation: `node <companion> start --write '<prompt>'`
- Job state: `node <companion> status '<job-id>'`
- Recent job output: `node <companion> result '<job-id>'`
- Stop a job while preserving its conversation: `node <companion> cancel '<job-id>'`
- Continue a saved job read-only: `node <companion> resume '<job-id>' '<prompt>'`
- Continue a saved job with edits: `node <companion> resume --write '<job-id>' '<prompt>'`

Use foreground mode unless the user explicitly requests background execution. Use write mode only when the user explicitly asks Claude to change files. Never add bypass-permission flags.

## Return control to Codex

Foreground commands return Claude's JSON result. Report the `result` and retain the `session_id` when continuation may matter.

Background start returns the native Claude job ID and resumable session ID. Report both. Native states are `working`, `blocked`, `done`, `failed`, and `stopped`. `result` returns recent terminal output, not a separate immutable result artifact.

When a background writer uses Claude's isolated worktree, report the worktree or branch from its output. Do not merge, copy, or delete its changes without the user's request.

After any foreground write, inspect the diff and run relevant verification yourself. Treat Claude's changes as untrusted implementation output: own the final correctness and report any remaining failure.
