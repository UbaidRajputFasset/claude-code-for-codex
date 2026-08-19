# Claude Code for Codex: primary-source research

Research date: 2026-08-19

## Recommendation

Build a local, skills-first Codex plugin with a small typed companion program that invokes the user's existing `claude` executable. Do not add an MCP server, proxy Anthropic traffic, store credentials, or build a second background-job system.

Claude Code already provides the required primitives:

- foreground non-interactive execution through `claude -p`
- JSON results containing the response and full session ID
- continuation through `--continue` and `--resume`
- detached background sessions through `claude --bg`
- machine-readable background status through `claude agents --json --all`
- recent output through `claude logs <id>`
- cancellation through `claude stop <id>`
- reconnection through `claude attach <id>` and `claude respawn <id>`

Anthropic documents these commands in the [CLI reference](https://code.claude.com/docs/en/cli-usage), [programmatic-use guide](https://code.claude.com/docs/en/headless), and [agent-view guide](https://code.claude.com/docs/en/agent-view).

The companion should only normalize arguments, parse documented JSON, turn failures into clear messages, and render consistent output for the Codex skills. It should spawn `claude` directly with an argument array, never interpolate the prompt into a shell command.

## Proposed v1 command contract

| Plugin workflow | Claude CLI primitive | Required behavior |
| --- | --- | --- |
| Setup | `claude --version`, then `claude auth status --json` | Report installed/authenticated/provider state. Offer an official installer only when missing. Launch `claude auth login` only with the user's approval. |
| Foreground query | `claude -p <prompt> --output-format json` | Print `.result`; retain and display `.session_id` so the user can continue it. |
| Foreground code delegation | `claude -p <prompt> --output-format json --permission-mode acceptEdits` | Use only after the user explicitly asks Claude to modify the checkout. Surface the exact permission mode. Do not add `--dangerously-skip-permissions`. |
| Start background work | `claude --bg <prompt>` | Return the native short background ID. Do not combine `--bg` with `-p`; Anthropic explicitly rejects that combination. |
| Background status | `claude agents --json --all --cwd <cwd>` | Render native states and show both the short `id` and full `sessionId` when present. |
| Background result | `claude logs <id>` | First confirm the native state. For `done`, return the recent output containing the session's final report. Be precise that this is native recent terminal output, not a separate immutable result artifact. |
| Cancel | `claude stop <id>` | Stop work while preserving the conversation. Never map cancel to `claude rm`, which can remove the agent-view record and may remove a worktree. |
| Resume foreground | `claude -p <prompt> --resume <session-id> --output-format json` | Continue the exact saved conversation and return its next result. |
| Reopen background work | `claude attach <id>` or `claude respawn <id>` | Attach when interactive input is needed; respawn a stopped process with its conversation intact. |

`--output-format json` is documented to return the text in `result` plus session metadata, including `session_id`; Anthropic's continuation example captures that ID and passes it to `--resume` ([programmatic-use guide](https://code.claude.com/docs/en/headless#continue-conversations)). Background entries expose `state`, the short `id`, and the full `sessionId`; the documented states are `working`, `blocked`, `done`, `failed`, and `stopped` ([agent-view JSON reference](https://code.claude.com/docs/en/agent-view#list-sessions-as-json)).

## Why native background sessions should own job state

Claude Code's background supervisor is already a per-user durable process. It owns each Claude process, keeps conversation state on disk, reconnects after supervisor restarts, and exposes its lifecycle through supported CLI commands. Each background session is a full Claude Code conversation, not a redirected one-shot process ([agent-view architecture](https://code.claude.com/docs/en/agent-view#how-background-sessions-are-hosted)).

Using it avoids a plugin-owned PID registry, log directory, cancellation protocol, session-ID mapping, and process-tree cleanup. It also avoids duplicating behavior Anthropic can evolve together with Claude Code.

Native background support is currently a research preview. The published guide identifies agent view as requiring Claude Code 2.1.139 or later and notes that administrators can disable it. The plugin should therefore feature-detect `--bg` and `claude agents --json` during setup, fail clearly when unavailable, and tell the user to update Claude Code or contact their administrator. It should not silently fall back to a second job implementation ([agent-view guide](https://code.claude.com/docs/en/agent-view)).

Native background sessions also isolate code edits. A session starts in the requested working directory and moves into `.claude/worktrees/` before editing a Git repository, unless isolation is disabled or the directory is not an isolatable Git checkout. The final report identifies the path, branch, pull request, or answer ([worktree behavior](https://code.claude.com/docs/en/agent-view#how-file-edits-are-isolated)). This is safer for concurrent Codex and Claude work than editing one checkout from two agents.

## Installation and authentication

### Detect installation

Run `claude --version`. The official installation guide says `claude doctor` provides a deeper read-only installation/configuration check ([Claude Code installation](https://code.claude.com/docs/en/installation)).

Prefer Anthropic's native installers:

- macOS, Linux, WSL: `curl -fsSL https://claude.ai/install.sh | bash`
- Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- Windows CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`
- Homebrew: `brew install --cask claude-code`
- WinGet: `winget install Anthropic.ClaudeCode`

These commands and supported platforms come from Anthropic's [quickstart](https://code.claude.com/docs/en/quickstart) and [advanced installation guide](https://code.claude.com/docs/en/installation). The npm package remains documented as an alternative requiring Node.js 18 or later, but Anthropic's repository now labels npm installation deprecated. A new plugin should prefer the native method and avoid imposing Node merely to install Claude Code ([Anthropic Claude Code repository](https://github.com/anthropics/claude-code)).

Never run a remote installer automatically. Detect the platform, present the exact official command, and require user approval.

### Detect authentication

Use:

```sh
claude auth status --json
```

Anthropic documents that this prints JSON, exits `0` when logged in, and exits `1` when logged out. Therefore, exit code `1` is an expected unauthenticated result, not a command failure. Parse stdout when available and treat other non-zero outcomes as errors ([CLI authentication commands](https://code.claude.com/docs/en/cli-usage#cli-commands)).

On the locally installed Claude Code 2.1.220, the JSON object has `loggedIn`, `authMethod`, and `apiProvider`. These are suitable for a setup report, but the plugin should require only the documented login outcome and validate optional fields before displaying them.

### Start login

Use:

```sh
claude auth login
```

The default is a Claude subscription login. Current CLI help also exposes `--console`, `--sso`, and `--email`. The browser flow belongs entirely to Claude Code; the plugin must not request, receive, print, or persist credentials.

Anthropic supports Claude.ai subscriptions, Teams/Enterprise, Console accounts, Bedrock, Google Cloud's Agent Platform, Microsoft Foundry, and corporate gateways. First launch opens a browser; WSL2, SSH, and containers may instead require copying the login URL and pasting a returned code ([authentication guide](https://code.claude.com/docs/en/authentication#log-in-to-claude-code)).

Do not use `--bare` for normal plugin calls. Bare mode explicitly skips OAuth and keychain reads, so it breaks the stated goal of reusing an existing Claude login. If a user wants to ignore repository customizations while retaining authentication, `--safe-mode` is the appropriate explicit option: Anthropic documents that it disables CLAUDE.md, skills, plugins, hooks, MCP, agents, and memory while keeping authentication, built-in tools, model selection, and permissions ([CLI `--safe-mode`](https://code.claude.com/docs/en/cli-usage)).

## Foreground invocation and permissions

`claude -p` is the supported non-interactive interface. It exits `0` on success and non-zero on failure. With `--output-format json`, `.result` contains the response and the payload also includes session and usage metadata ([programmatic-use guide](https://code.claude.com/docs/en/headless)).

Keep read-only queries and code-writing delegation separate:

- Queries should use a restrictive tool set or `dontAsk` policy appropriate to the requested analysis.
- Code-writing delegation should be an explicit workflow. Anthropic documents `--permission-mode acceptEdits` for file edits; other shell commands and network requests can still require `--allowedTools` rules or block for approval.
- Never use `--dangerously-skip-permissions` in the plugin.

Anthropic's documented writing example is `claude -p "Apply the lint fixes" --permission-mode acceptEdits`, and its broader example allows `Bash,Read,Edit` explicitly ([non-interactive permissions](https://code.claude.com/docs/en/headless#auto-approve-tools)). The plugin should show the chosen permissions rather than hide them behind a generic command.

Regular `-p` loads project and user hooks, skills, plugins, MCP servers, auto-memory, and CLAUDE.md. It also skips the workspace trust dialog. This is useful for matching the user's direct Claude workflow, but unsafe for an untrusted checkout. The plugin documentation should tell users to use the safe-mode option for repositories they have not reviewed ([bare-mode warning](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)).

## Background lifecycle details

Start:

```sh
claude --bg --name "codex-<unique-id>" "investigate the flaky test"
```

Claude prints human-readable output containing a short ID and the corresponding `agents`, `attach`, `logs`, and `stop` commands ([background dispatch](https://code.claude.com/docs/en/agent-view#from-your-shell)). Do not combine `--bg` with `-p`; the CLI rejects it ([CLI flags](https://code.claude.com/docs/en/cli-usage#cli-flags)). `--output-format json` is a print-mode contract, not a background-launch contract.

Because agent view is a research preview, the companion should not parse the human launch text as its source of truth. Generate a unique `--name`, wait for an exact name match in `claude agents --json --all --cwd <cwd>`, and return that entry's documented `id` and `sessionId`. This also removes ambiguity when several jobs start close together.

Status:

```sh
claude agents --json --all --cwd "$PWD"
```

`--json` includes active sessions; `--all` adds completed background sessions; `--cwd` scopes by launch directory. Native JSON provides the short management ID and, when known, the full resumable session UUID ([agent-view JSON reference](https://code.claude.com/docs/en/agent-view#list-sessions-as-json)).

Result and intervention:

```sh
claude logs <id>
claude attach <id>
```

`logs` prints recent terminal output. `attach` is the supported path for a blocked permission prompt or question and resumes the full interactive conversation ([session-management commands](https://code.claude.com/docs/en/agent-view#manage-sessions-from-the-shell)). A v1 `$claude-result` workflow can reliably report the native state and recent final report, but should not claim to expose a separate durable result object because Anthropic does not document one.

Treat successful `logs` output as opaque text. It has no documented JSON schema. Treat a non-zero exit as failure and surface stderr; do not attempt to classify errors from their prose.

Cancel and resume:

```sh
claude stop <id>
claude respawn <id>
claude -p "continue the task" --resume <session-id> --output-format json
```

`stop` preserves the conversation. `respawn` restarts it with conversation intact. `claude rm` is removal, not cancellation; its worktree behavior depends on whether changes are committed or pushed ([session management](https://code.claude.com/docs/en/agent-view#manage-sessions-from-the-shell), [deletion behavior](https://code.claude.com/docs/en/agent-view#what-deleting-a-session-removes)).

`stop` also has no documented JSON response. After it exits successfully, query `claude agents --json --all --cwd <cwd>` again and verify that the matching entry reports `state: "stopped"`. This makes the observable state transition, rather than success prose, the cancellation contract.

### Locally verified process I/O

Claude Code 2.1.220 produced these exact process-level results without starting a model turn:

- `claude --bg -p --output-format json noop`: exit `1`, empty stdout, conflict diagnostic on stderr.
- `claude agents --json --all --cwd <absolute-path>` with no sessions: exit `0`, stdout `[]\n`, empty stderr.
- `claude logs 00000000`: exit `1`, empty stdout, “No job matching” diagnostic on stderr.
- `claude stop 00000000`: exit `1`, empty stdout, “No job matching” diagnostic on stderr.

The wrapper should rely on these channel boundaries and documented JSON state, not exact diagnostic wording.

## Codex plugin package and GitHub installation

Codex plugins require `.codex-plugin/plugin.json` and may package skills, scripts, assets, hooks, or MCP configuration. A skills-only plugin is explicitly supported, and manifest paths are relative to the plugin root ([OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)).

The intended repository layout is:

```text
.agents/plugins/marketplace.json
plugins/claude-code/
  .codex-plugin/plugin.json
  skills/
  scripts/
```

For a published GitHub repository, the user-facing installation should be two commands followed by a new Codex session:

```sh
codex plugin marketplace add OWNER/claude-code-for-codex
codex plugin add claude-code@claude-code-for-codex
```

OpenAI documents GitHub shorthand for `codex plugin marketplace add` and marketplace maintenance commands in the [plugin packaging guide](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli). OpenAI's plugin-creator source documents `codex plugin add <plugin-name>@<marketplace-name>` for installation ([installing and updating reference](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/plugin-creator/references/installing-and-updating.md)). Locally, Codex CLI 0.148.0 confirms this exact `plugin add` syntax.

Codex and ChatGPT share the public plugin directory, but local/repository marketplaces are separate authoring and distribution sources. Codex CLI supports a plugin browser through `/plugins`; the IDE extension does not support plugins ([OpenAI plugin usage](https://learn.chatgpt.com/docs/plugins)). This v1 should be described as a local Codex CLI/desktop workflow because it depends on the `claude` executable and the user's machine-local authentication.

## Lessons from `openai/codex-plugin-cc`

The reverse-direction reference plugin is a useful product pattern, not an architecture to mirror exactly:

- Its setup command runs a deterministic companion check, offers installation only when the CLI is absent, reruns the check, and directs unauthenticated users to the official login command ([setup command at commit `db52e28`](https://github.com/openai/codex-plugin-cc/blob/db52e28f4d9ded852ab3942cea316258ae4ef346/plugins/codex/commands/setup.md)).
- It verifies both the CLI and the advanced runtime before declaring readiness and asks Codex's app server for auth state ([companion source at commit `db52e28`](https://github.com/openai/codex-plugin-cc/blob/db52e28f4d9ded852ab3942cea316258ae4ef346/plugins/codex/scripts/lib/codex.mjs#L817-L957)).
- It has an explicit marketplace file, plugin manifest, version checks, tests, and an Apache-2.0 license ([repository](https://github.com/openai/codex-plugin-cc)).

That plugin needs Codex's app-server protocol to capture rich turns and manage jobs. Claude Code now exposes the v1 requirements directly through supported CLI commands, so an app-server-style broker would add complexity without a consumer need.

## Platform and operational caveats

- Claude Code supports macOS 13+, Windows 10 1809+/Server 2019+, Ubuntu 20.04+, Debian 10+, Alpine 3.19+, x64 and ARM64, with 4 GB RAM and internet access. Native Windows does not support Claude Code sandboxing; WSL2 does ([installation requirements](https://code.claude.com/docs/en/installation)).
- Native background sessions are a research preview and can be disabled by administrators through `disableAgentView`. Fail fast if the feature is unavailable ([agent-view guide](https://code.claude.com/docs/en/agent-view)).
- Background work uses the same Claude credentials and quota as interactive work and can continue without Codex attached. Starting it must be an explicit user request, and status output should make running/blocked work visible.
- Background sessions isolate edits only in suitable Git repositories. Outside Git, parallel sessions can edit the same directory, so the plugin should warn before launching multiple writers ([worktree behavior](https://code.claude.com/docs/en/agent-view#how-file-edits-are-isolated)).
- `claude -p` accepts at most 10 MB from piped stdin. Prefer prompt arguments or file paths for larger inputs ([programmatic-use guide](https://code.claude.com/docs/en/headless#pipe-data-through-claude)).
- Existing provider configuration matters. `ANTHROPIC_API_KEY`, Console login, Claude subscription login, Bedrock, Google Cloud, Foundry, and gateways can produce different auth/provider states. The plugin should report the chosen provider, not assume Claude.ai.

## Licensing and naming

The plugin can be open-sourced under Apache-2.0 or MIT because it can be written independently and merely invokes an external executable. Apache-2.0 aligns with OpenAI's reference plugin and is the safer choice if any Apache-licensed source is adapted.

Claude Code itself is not licensed as open source: Anthropic's repository license says “All rights reserved” and makes use subject to Anthropic's Commercial Terms ([Claude Code license](https://github.com/anthropics/claude-code/blob/main/LICENSE.md)). Therefore:

- do not vendor, modify, or redistribute the Claude Code binary or proprietary source
- declare Claude Code as a separately installed external dependency
- send users to Anthropic's official installer and authentication flow
- do not copy Claude Code assets or logos into the plugin

OpenAI's reference plugin is Apache-2.0. If its source is copied or adapted, retain the license, copyright/attribution notices, changed-file notices, and applicable NOTICE content; Apache-2.0 does not grant trademark rights ([reference license](https://github.com/openai/codex-plugin-cc/blob/main/LICENSE)). An independent implementation avoids those derivative-work obligations while still benefiting from the public design example.

Use “Claude Code” only to identify compatibility, choose a repository/plugin name that does not imply Anthropic ownership, and include a short notice such as: “Unofficial community integration. Not affiliated with or endorsed by Anthropic or OpenAI.” This is a prudent naming recommendation, not a substitute for legal review.

## Verified local CLI evidence

The development machine currently has:

- Claude Code 2.1.220
- Codex CLI 0.148.0

Local help confirms:

- `claude auth login|logout|status`
- `claude --bg` / `--background`
- `claude agents --json --all --cwd`
- `claude attach`, `logs`, `stop`, `respawn`, and `rm`
- `claude -p`, `--output-format json`, `--continue`, `--resume`, `--fork-session`, `--permission-mode`, and `--safe-mode`
- `codex plugin marketplace add` and `codex plugin add PLUGIN@MARKETPLACE`

These checks match the linked official documentation. The plugin should still probe capabilities at runtime because both Codex plugins and Claude agent view are evolving surfaces.
