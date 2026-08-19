#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
function readAuthStatus(output) {
    const value = JSON.parse(output);
    if (typeof value !== "object" ||
        value === null ||
        !("loggedIn" in value) ||
        typeof value.loggedIn !== "boolean" ||
        !("authMethod" in value) ||
        typeof value.authMethod !== "string" ||
        !("apiProvider" in value) ||
        typeof value.apiProvider !== "string") {
        throw new Error("Claude returned an invalid authentication status");
    }
    return {
        apiProvider: value.apiProvider,
        authMethod: value.authMethod,
        loggedIn: value.loggedIn,
    };
}
function doctor() {
    const version = spawnSync("claude", ["--version"], { encoding: "utf8" });
    if (version.error && "code" in version.error && version.error.code === "ENOENT") {
        return { installed: false, authenticated: false, backgroundJobs: false };
    }
    if (version.error) {
        throw version.error;
    }
    if (version.status !== 0) {
        throw new Error(version.stderr.trim() || "Claude version check failed");
    }
    const authentication = spawnSync("claude", ["auth", "status", "--json"], {
        encoding: "utf8",
    });
    if (authentication.error) {
        throw authentication.error;
    }
    const status = readAuthStatus(authentication.stdout);
    const loggedOut = authentication.status === 1 && !status.loggedIn;
    if (authentication.status !== 0 && !loggedOut) {
        throw new Error(authentication.stderr.trim() || "Claude authentication check failed");
    }
    const background = spawnSync("claude", ["agents", "--json", "--all", "--cwd", process.cwd()], { encoding: "utf8" });
    if (background.error) {
        throw background.error;
    }
    const backgroundJobs = background.status === 0;
    if (backgroundJobs) {
        readSessions(background.stdout);
    }
    return {
        installed: true,
        authenticated: status.loggedIn,
        backgroundJobs,
        authMethod: status.authMethod,
        apiProvider: status.apiProvider,
        version: version.stdout.trim(),
    };
}
function login() {
    const authentication = spawnSync("claude", ["auth", "login", "--claudeai"], {
        stdio: "inherit",
    });
    if (authentication.error) {
        throw authentication.error;
    }
    if (authentication.status !== 0) {
        throw new Error(`Claude login exited with status ${authentication.status ?? "unknown"}`);
    }
}
function ask(prompt) {
    const result = spawnSync("claude", ["-p", "--output-format", "json", "--permission-mode", "plan", prompt], { encoding: "utf8" });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `Claude exited with status ${result.status ?? "unknown"}`);
    }
    process.stdout.write(result.stdout);
}
function delegate(prompt) {
    const result = spawnSync("claude", ["-p", "--output-format", "json", "--permission-mode", "acceptEdits", prompt], { encoding: "utf8" });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `Claude exited with status ${result.status ?? "unknown"}`);
    }
    process.stdout.write(result.stdout);
}
function readSession(value) {
    if (typeof value !== "object" ||
        value === null ||
        !("cwd" in value) ||
        typeof value.cwd !== "string" ||
        !("kind" in value) ||
        (value.kind !== "interactive" && value.kind !== "background") ||
        !("startedAt" in value) ||
        typeof value.startedAt !== "number" ||
        ("name" in value && typeof value.name !== "string") ||
        ("sessionId" in value && typeof value.sessionId !== "string")) {
        throw new Error("Claude returned an invalid agent session");
    }
    if (value.kind === "background") {
        if (!("id" in value) ||
            typeof value.id !== "string" ||
            !("state" in value) ||
            !["working", "blocked", "done", "failed", "stopped"].includes(String(value.state))) {
            throw new Error("Claude returned an invalid background agent");
        }
        return value;
    }
    return value;
}
function readSessions(output) {
    const value = JSON.parse(output);
    if (!Array.isArray(value)) {
        throw new Error("Claude returned an invalid agent session list");
    }
    return value.map(readSession);
}
function readAgents(output) {
    return readSessions(output).filter((session) => session.kind === "background");
}
function agents() {
    const result = spawnSync("claude", ["agents", "--json", "--all", "--cwd", process.cwd()], { encoding: "utf8" });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "Claude background agent lookup failed");
    }
    return readAgents(result.stdout);
}
function start(prompt, permissionMode) {
    const name = `codex-${randomUUID()}`;
    const result = spawnSync("claude", ["--bg", "--name", name, "--permission-mode", permissionMode, prompt], { encoding: "utf8" });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "Claude background agent failed to start");
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const agent = agents().find((candidate) => candidate.name === name);
        if (agent) {
            return {
                jobId: agent.id,
                name,
                state: agent.state,
                ...(agent.sessionId ? { sessionId: agent.sessionId } : {}),
            };
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    throw new Error(`Claude started background agent ${name} but did not register it`);
}
function status(reference) {
    const agent = agents().find((candidate) => candidate.id === reference || candidate.sessionId === reference);
    if (!agent) {
        throw new Error(`Claude background job not found: ${reference}`);
    }
    return agent;
}
function result(reference) {
    const logs = spawnSync("claude", ["logs", reference], { encoding: "utf8" });
    if (logs.error) {
        throw logs.error;
    }
    if (logs.status !== 0) {
        throw new Error(logs.stderr.trim() || `Claude background job not found: ${reference}`);
    }
    process.stdout.write(logs.stdout);
}
function cancel(reference) {
    const stopped = spawnSync("claude", ["stop", reference], { encoding: "utf8" });
    if (stopped.error) {
        throw stopped.error;
    }
    if (stopped.status !== 0) {
        throw new Error(stopped.stderr.trim() || `Claude background job not found: ${reference}`);
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const agent = status(reference);
        if (agent.state === "stopped") {
            return agent;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    throw new Error(`Claude background job did not stop: ${reference}`);
}
function resume(reference, prompt, permissionMode) {
    const agent = status(reference);
    if (typeof agent.sessionId !== "string") {
        throw new Error(`Claude background job has no resumable session: ${reference}`);
    }
    const continued = spawnSync("claude", [
        "--resume",
        agent.sessionId,
        "-p",
        "--output-format",
        "json",
        "--permission-mode",
        permissionMode,
        prompt,
    ], { encoding: "utf8" });
    if (continued.error) {
        throw continued.error;
    }
    if (continued.status !== 0) {
        throw new Error(continued.stderr.trim() || "Claude session resume failed");
    }
    process.stdout.write(continued.stdout);
}
function main(arguments_) {
    const [command, ...operands] = arguments_;
    if (command === "doctor") {
        process.stdout.write(`${JSON.stringify(doctor())}\n`);
        return;
    }
    if (command === "login") {
        login();
        return;
    }
    if (command === "ask") {
        const prompt = operands.join(" ").trim();
        if (prompt.length === 0) {
            throw new Error("ask requires a prompt");
        }
        ask(prompt);
        return;
    }
    if (command === "delegate") {
        const prompt = operands.join(" ").trim();
        if (prompt.length === 0) {
            throw new Error("delegate requires a prompt");
        }
        delegate(prompt);
        return;
    }
    if (command === "start") {
        const write = operands[0] === "--write";
        const prompt = operands.slice(write ? 1 : 0).join(" ").trim();
        if (prompt.length === 0) {
            throw new Error("start requires a prompt");
        }
        process.stdout.write(`${JSON.stringify(start(prompt, write ? "acceptEdits" : "plan"))}\n`);
        return;
    }
    if (command === "status") {
        const [reference] = operands;
        if (!reference) {
            throw new Error("status requires a job ID");
        }
        process.stdout.write(`${JSON.stringify(status(reference))}\n`);
        return;
    }
    if (command === "result") {
        const [reference] = operands;
        if (!reference) {
            throw new Error("result requires a job ID");
        }
        result(reference);
        return;
    }
    if (command === "cancel") {
        const [reference] = operands;
        if (!reference) {
            throw new Error("cancel requires a job ID");
        }
        process.stdout.write(`${JSON.stringify(cancel(reference))}\n`);
        return;
    }
    if (command === "resume") {
        const write = operands[0] === "--write";
        const remaining = operands.slice(write ? 1 : 0);
        const [reference, ...promptParts] = remaining;
        const prompt = promptParts.join(" ").trim();
        if (!reference || prompt.length === 0) {
            throw new Error("resume requires a job ID and prompt");
        }
        resume(reference, prompt, write ? "acceptEdits" : "plan");
        return;
    }
    throw new Error(`Unknown command: ${command ?? ""}`);
}
try {
    main(process.argv.slice(2));
}
catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
}
