# Claude Code for Codex

Use Claude Code from inside Codex for second opinions, code delegation, background work, and resumable sessions.

This is an unofficial community integration. It is not affiliated with or endorsed by Anthropic or OpenAI.

## What you get

- Read-only Claude reviews and second opinions
- Claude code-writing delegation with edit permissions, never permission bypasses
- Native Claude background jobs with status, logs, and cancellation
- Resumable Claude conversations across Codex tasks
- Claude installation and authentication checks without handling credentials

## Requirements

- Codex CLI or Codex desktop with plugin support
- Node.js 18.18 or later
- Claude Code with a supported Claude subscription, Anthropic Console account, or configured enterprise provider

Install Claude Code with Anthropic's native installer if it is not already available:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

Homebrew and WinGet are also supported:

```sh
brew install --cask claude-code
winget install Anthropic.ClaudeCode
```

## Install in Codex

After this repository is published, add its marketplace and install the plugin:

```sh
codex plugin marketplace add UbaidRajputFasset/claude-code-for-codex
codex plugin add claude-code@claude-code-for-codex
```

Start a new Codex task after installation so the skill is loaded.

## Use

Ask naturally or invoke `$claude-code` explicitly:

- “Ask Claude to review the current diff.”
- “Delegate this fix to Claude.”
- “Run Claude in the background to investigate this failure.”
- “Check Claude job `7c5dcf5d`.”
- “Show the result from Claude job `7c5dcf5d`.”
- “Cancel Claude job `7c5dcf5d`.”
- “Resume Claude job `7c5dcf5d` and finish the fix.”

On first use, the plugin checks `claude --version` and `claude auth status --json`. If Claude is logged out, it starts Claude's official browser login. Credentials remain owned by Claude Code.

Background jobs use Claude Code's native agent supervisor. Background writers may move into an isolated worktree under `.claude/worktrees/`; inspect the job output before integrating changes.

## Security

The plugin invokes the local `claude` executable directly with argument arrays. It does not proxy Anthropic traffic, store credentials, or use `--dangerously-skip-permissions`.

Regular Claude print mode loads the current repository's Claude configuration. Use this plugin only in repositories you trust.

## Development

```sh
npm install
npm test
```

The test command compiles the strict TypeScript companion and exercises setup, login, foreground delegation, background lifecycle, cancellation, and resume behavior against a deterministic fake Claude CLI.

Primary-source design research is recorded in [`docs/research.md`](docs/research.md).

## License

MIT
