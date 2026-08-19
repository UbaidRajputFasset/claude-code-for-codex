import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

type Invocation = {
  status: number | null;
  stderr: string;
  stdout: string;
};

async function createFakeClaude(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "claude-code-for-codex-"));
  const bin = join(root, "bin");
  await mkdir(bin);
  const executable = join(bin, "claude");
  await writeFile(executable, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(executable, 0o755);
  return bin;
}

function invoke(
  arguments_: string[],
  bin: string,
  environment: Record<string, string> = {},
): Invocation {
  const result = spawnSync(
    process.execPath,
    ["plugins/claude-code/scripts/claude-companion.mjs", ...arguments_],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

test("doctor reports the installed Claude version and authenticated account", async () => {
  const bin = await createFakeClaude(`
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.220 (Claude Code)'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'
  exit 0
fi
if [ "$1" = "agents" ] && [ "$2" = "--json" ] && [ "$3" = "--all" ] && [ "$4" = "--cwd" ]; then
  printf '%s\\n' '[]'
  exit 0
fi
exit 64
`);

  const result = invoke(["doctor"], bin);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    installed: true,
    authenticated: true,
    backgroundJobs: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    version: "2.1.220 (Claude Code)",
  });
});

test("doctor reports a logged-out Claude account without treating it as a CLI failure", async () => {
  const bin = await createFakeClaude(`
if [ "$1" = "--version" ]; then
  printf '%s\\n' '2.1.220 (Claude Code)'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'
  exit 1
fi
if [ "$1" = "agents" ] && [ "$2" = "--json" ] && [ "$3" = "--all" ] && [ "$4" = "--cwd" ]; then
  printf '%s\\n' '[]'
  exit 0
fi
exit 64
`);

  const result = invoke(["doctor"], bin);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    installed: true,
    authenticated: false,
    backgroundJobs: true,
    authMethod: "none",
    apiProvider: "firstParty",
    version: "2.1.220 (Claude Code)",
  });
});

test("login starts Claude's subscription authentication flow", async () => {
  const bin = await createFakeClaude(`
if [ "$1" = "auth" ] && [ "$2" = "login" ] && [ "$3" = "--claudeai" ]; then
  printf '%s\\n' 'login started'
  exit 0
fi
exit 64
`);

  const result = invoke(["login"], bin);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "login started\n");
});

test("ask returns a read-only Claude result", async () => {
  const bin = await createFakeClaude(`
if [ "$1" = "-p" ] && [ "$2" = "--output-format" ] && [ "$3" = "json" ] && [ "$4" = "--permission-mode" ] && [ "$5" = "plan" ] && [ "$6" = "Review this change" ]; then
  printf '%s\\n' '{"type":"result","result":"Looks good","session_id":"session-1"}'
  exit 0
fi
exit 64
`);

  const result = invoke(["ask", "Review this change"], bin);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    type: "result",
    result: "Looks good",
    session_id: "session-1",
  });
});

test("delegate lets Claude edit without bypassing other permissions", async () => {
  const bin = await createFakeClaude(`
if [ "$1" = "-p" ] && [ "$2" = "--output-format" ] && [ "$3" = "json" ] && [ "$4" = "--permission-mode" ] && [ "$5" = "acceptEdits" ] && [ "$6" = "Fix the failing test" ]; then
  printf '%s\\n' '{"type":"result","result":"Fixed","session_id":"session-2"}'
  exit 0
fi
exit 64
`);

  const result = invoke(["delegate", "Fix the failing test"], bin);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    type: "result",
    result: "Fixed",
    session_id: "session-2",
  });
});

test("background jobs use Claude's supervisor and expose status and logs", async () => {
  const fakeState = join(await mkdtemp(join(tmpdir(), "claude-agent-state-")), "name");
  const bin = await createFakeClaude(`
if [ "$1" = "--bg" ] && [ "$2" = "--name" ] && [ "$4" = "--permission-mode" ] && [ "$5" = "plan" ] && [ "$6" = "Investigate the bug" ]; then
  printf '%s' "$3" > "$FAKE_STATE_FILE"
  printf '%s\\n' "backgrounded · 7c5dcf5d · $3"
  printf '%s\\n' '  claude agents'
  printf '%s\\n' '  claude logs 7c5dcf5d'
  exit 0
fi
if [ "$1" = "agents" ] && [ "$2" = "--json" ] && [ "$3" = "--all" ] && [ "$4" = "--cwd" ]; then
  job_name=$(cat "$FAKE_STATE_FILE")
  printf '[{"id":"7c5dcf5d","sessionId":"7c5dcf5d-1111-2222-3333-444444444444","name":"%s","state":"done","cwd":"%s","kind":"background","startedAt":"2026-08-19T00:00:00.000Z"}]\\n' "$job_name" "$5"
  exit 0
fi
if [ "$1" = "logs" ] && [ "$2" = "7c5dcf5d" ]; then
  printf '%s\\n' 'Found it'
  exit 0
fi
exit 64
`);
  const environment = { FAKE_STATE_FILE: fakeState };

  const started = invoke(["start", "Investigate the bug"], bin, environment);

  assert.equal(started.status, 0, started.stderr);
  const startResult = JSON.parse(started.stdout) as Record<string, unknown>;
  assert.equal(startResult.jobId, "7c5dcf5d");
  assert.equal(startResult.sessionId, "7c5dcf5d-1111-2222-3333-444444444444");
  const jobId = String(startResult.jobId);

  const status = invoke(["status", jobId], bin, environment);
  assert.equal(status.status, 0, status.stderr);
  const completed = JSON.parse(status.stdout) as Record<string, unknown>;
  assert.equal(completed.state, "done");
  assert.equal(completed.id, "7c5dcf5d");

  const result = invoke(["result", jobId], bin, environment);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Found it\n");
});

test("cancel stops a background job while preserving its Claude session", async () => {
  const bin = await createFakeClaude(`
if [ "$1" = "stop" ] && [ "$2" = "7c5dcf5d" ]; then
  printf '%s' 'stopped' > "$FAKE_STATE_FILE"
  exit 0
fi
if [ "$1" = "agents" ] && [ "$2" = "--json" ] && [ "$3" = "--all" ] && [ "$4" = "--cwd" ]; then
  state=$(cat "$FAKE_STATE_FILE")
  printf '[{"id":"7c5dcf5d","sessionId":"7c5dcf5d-1111-2222-3333-444444444444","name":"codex-job","state":"%s","cwd":"%s","kind":"background","startedAt":"2026-08-19T00:00:00.000Z"}]\\n' "$state" "$5"
  exit 0
fi
exit 64
`);
  const fakeState = join(await mkdtemp(join(tmpdir(), "claude-agent-state-")), "state");
  await writeFile(fakeState, "working", "utf8");

  const result = invoke(["cancel", "7c5dcf5d"], bin, {
    FAKE_STATE_FILE: fakeState,
  });

  assert.equal(result.status, 0, result.stderr);
  const cancelled = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(cancelled.id, "7c5dcf5d");
  assert.equal(cancelled.state, "stopped");
  assert.equal(cancelled.sessionId, "7c5dcf5d-1111-2222-3333-444444444444");
});

test("background write jobs allow edits without bypassing permissions", async () => {
  const fakeState = join(await mkdtemp(join(tmpdir(), "claude-agent-state-")), "name");
  const bin = await createFakeClaude(`
if [ "$1" = "--bg" ] && [ "$2" = "--name" ] && [ "$4" = "--permission-mode" ] && [ "$5" = "acceptEdits" ] && [ "$6" = "Implement the fix" ]; then
  printf '%s' "$3" > "$FAKE_STATE_FILE"
  exit 0
fi
if [ "$1" = "agents" ] && [ "$2" = "--json" ] && [ "$3" = "--all" ] && [ "$4" = "--cwd" ]; then
  job_name=$(cat "$FAKE_STATE_FILE")
  printf '[{"id":"writejob","sessionId":"write-session","name":"%s","state":"working","cwd":"%s","kind":"background","startedAt":"2026-08-19T00:00:00.000Z"}]\\n' "$job_name" "$5"
  exit 0
fi
exit 64
`);

  const result = invoke(["start", "--write", "Implement the fix"], bin, {
    FAKE_STATE_FILE: fakeState,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).jobId, "writejob");
});

test("resume continues a background job's Claude session in write mode", async () => {
  const bin = await createFakeClaude(`
if [ "$1" = "agents" ] && [ "$2" = "--json" ] && [ "$3" = "--all" ] && [ "$4" = "--cwd" ]; then
  printf '%s\\n' '[{"id":"7c5dcf5d","sessionId":"7c5dcf5d-1111-2222-3333-444444444444","name":"codex-job","state":"stopped","cwd":"project","kind":"background","startedAt":"2026-08-19T00:00:00.000Z"}]'
  exit 0
fi
if [ "$1" = "--resume" ] && [ "$2" = "7c5dcf5d-1111-2222-3333-444444444444" ] && [ "$3" = "-p" ] && [ "$4" = "--output-format" ] && [ "$5" = "json" ] && [ "$6" = "--permission-mode" ] && [ "$7" = "acceptEdits" ] && [ "$8" = "Finish the fix" ]; then
  printf '%s\\n' '{"type":"result","result":"Finished","session_id":"7c5dcf5d-1111-2222-3333-444444444444"}'
  exit 0
fi
exit 64
`);

  const result = invoke(["resume", "--write", "7c5dcf5d", "Finish the fix"], bin);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result, "Finished");
});
