import assert from "node:assert/strict";
import { test } from "node:test";
import { callerRefusal, readVkCaller, type GuardedMethod } from "./rpc-caller.ts";

const ALL: GuardedMethod[] = [
  "env_get_value",
  "env_save",
  "env_delete",
  "env_export",
  "env_import",
  "env_import_machine_env",
  "cli_get",
  "cli_set",
  "cli_delete",
  "cli_export",
  "cli_import_machine_env",
];
const GRANTS: GuardedMethod[] = ["grant_decide", "grant_create", "grant_list", "grant_revoke", "journal_list"];
const RPC_AND_CLI: GuardedMethod[] = [...ALL, ...GRANTS];
const CLI_METHODS: GuardedMethod[] = ["cli_get", "cli_set", "cli_delete", "cli_export", "cli_import_machine_env"];
const PAGE_METHODS: GuardedMethod[] = [
  "env_get_value",
  "env_save",
  "env_delete",
  "env_export",
  "env_import",
  "env_import_machine_env",
  ...GRANTS,
];
const TOOLS: GuardedMethod[] = ["tool_env_set", "tool_env_delete"];

const ctx = (kind: string) => ({ experimental_vkCaller: { kind, evidence: "x" } });

test("owner app and owner CLI may run every guarded method", () => {
  for (const kind of ["owner-ui", "owner-cli"]) {
    for (const method of RPC_AND_CLI) assert.equal(callerRefusal(readVkCaller(ctx(kind)), method), null, `${kind} ${method}`);
  }
});

test("agent sessions and unmarked scripts are refused on every guarded method", () => {
  for (const kind of ["agent-thread", "unknown"]) {
    for (const method of RPC_AND_CLI) {
      assert.match(callerRefusal(readVkCaller(ctx(kind)), method) ?? "", /Refused/, `${kind} ${method}`);
    }
  }
});

test("another plugin may read a value and nothing else", () => {
  const caller = readVkCaller({ experimental_vkCaller: { kind: "plugin", pluginId: "lane-pilot" } });
  assert.equal(callerRefusal(caller, "env_get_value"), null);
  for (const method of RPC_AND_CLI.filter((m) => m !== "env_get_value")) {
    assert.match(callerRefusal(caller, method) ?? "", /Refused/, method);
  }
});

test("a kind this plugin does not know counts as unknown", () => {
  assert.equal(readVkCaller(ctx("root"))?.kind, "unknown");
  assert.match(callerRefusal(readVkCaller(ctx("root")), "env_save") ?? "", /Refused/);
});

test("fallback: no mark (stock core or older core) keeps the old behaviour", () => {
  assert.equal(readVkCaller(undefined), undefined);
  assert.equal(readVkCaller({}), undefined);
  assert.equal(readVkCaller({ experimental_vkCaller: "owner-ui" }), undefined);
  assert.equal(readVkCaller({ experimental_vkCaller: {} }), undefined);
  for (const method of RPC_AND_CLI) assert.equal(callerRefusal(undefined, method), null);
});

test("the refusal does not say how to get past it", () => {
  const text = callerRefusal({ kind: "unknown" }, "env_get_value") ?? "";
  assert.doesNotMatch(text, /header|origin|token|curl/i);
});

test("unverified-owner (owner login off): the page claim runs the page's RPCs, the terminal claim the CLI methods", () => {
  const page = { kind: "unverified-owner" as const, evidence: "browser-headers" };
  const term = { kind: "unverified-owner" as const, evidence: "cli-header" };
  assert.equal(readVkCaller(ctx("unverified-owner"))?.kind, "unverified-owner");
  for (const method of PAGE_METHODS) {
    assert.equal(callerRefusal(page, method), null, `page ${method}`);
    assert.match(callerRefusal(term, method) ?? "", /Refused/, `terminal ${method}`);
  }
  for (const method of CLI_METHODS) {
    assert.equal(callerRefusal(term, method), null, `terminal ${method}`);
    assert.match(callerRefusal(page, method) ?? "", /Refused/, `page ${method}`);
  }
});

test("unverified-owner without or with unknown evidence is refused with the owner-login message", () => {
  for (const evidence of [undefined, "x", "thread-token"]) {
    for (const method of [...PAGE_METHODS, ...CLI_METHODS]) {
      const text = callerRefusal({ kind: "unverified-owner", evidence }, method) ?? "";
      assert.match(text, /Refused/, method);
      assert.match(text, /Env Catalog page/, method);
      assert.match(text, /входа владельца/, method);
    }
  }
});

test("refusal messages do not hint at a way around the check", () => {
  for (const caller of [{ kind: "unverified-owner" as const }, { kind: "unknown" as const }, { kind: "agent-thread" as const }]) {
    for (const method of RPC_AND_CLI) {
      assert.doesNotMatch(callerRefusal(caller, method) ?? "", /header|origin|token|curl|forge/i, `${caller.kind} ${method}`);
    }
  }
});

test("a plugin may still read a value but nothing else, and never answers a grant form", () => {
  assert.equal(callerRefusal({ kind: "plugin", pluginId: "lane-pilot" }, "env_get_value"), null);
  for (const method of ["grant_decide", "grant_create", "grant_list", "grant_revoke", "journal_list"] as const) {
    assert.match(callerRefusal({ kind: "plugin", pluginId: "lane-pilot" }, method) ?? "", /Refused/);
  }
});

test("every refusal says what to do next (owner rule 2026-10-08: never a bare Refused)", () => {
  for (const caller of [{ kind: "agent-thread" as const, threadId: "thr_1" }, { kind: "unknown" as const }, { kind: "plugin" as const }]) {
    for (const method of RPC_AND_CLI) {
      const text = callerRefusal(caller, method);
      if (text === null) continue;
      assert.match(text, /env_get|env_request|Env Catalog page|owner/, `${caller.kind} ${method}`);
      assert.ok(text.length > 80, `${caller.kind} ${method} is more than a bare refusal`);
    }
  }
});

test("an agent reading is told how to ask: env_get, the form, the wait", () => {
  const text = callerRefusal({ kind: "agent-thread", threadId: "thr_1" }, "env_get_value") ?? "";
  assert.match(text, /env_get/);
  assert.match(text, /form/);
  assert.match(text, /10 minutes/);
});

test("env_set and env_delete tools refuse every caller and point to env_request", () => {
  for (const method of TOOLS) {
    for (const caller of [undefined, { kind: "agent-thread" as const, threadId: "thr_1" }, { kind: "unknown" as const }, { kind: "owner-ui" as const }]) {
      const text = callerRefusal(caller, method) ?? "";
      assert.match(text, /Refused/, `${method} ${caller?.kind}`);
      assert.match(text, /env_request/, `${method} ${caller?.kind}`);
    }
  }
});

test("server.ts routes both changing tools through the refusal before touching the catalog", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../server.ts", import.meta.url), "utf8");
  for (const [method, call] of [["tool_env_set", "saveVariable({"], ["tool_env_delete", "deleteVariable(name)"]] as const) {
    const guard = src.indexOf(`refuseAgentTool("${method}"`);
    assert.ok(guard > 0, `${method} guarded`);
    assert.ok(src.indexOf(call, guard) > guard, `${method} guard precedes ${call}`);
  }
});
