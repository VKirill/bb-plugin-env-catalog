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
const RPC_AND_CLI = ALL;
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

test("unverified-owner is a known kind and is refused on every secret RPC and CLI method", () => {
  const caller = readVkCaller(ctx("unverified-owner"));
  assert.equal(caller?.kind, "unverified-owner");
  for (const method of RPC_AND_CLI) {
    const text = callerRefusal(caller, method) ?? "";
    assert.match(text, /Refused/, method);
    assert.match(text, /Env Catalog page/, method);
    assert.match(text, /входа владельца/, method);
  }
});

test("unverified-owner message does not hint at a way around the check", () => {
  const text = callerRefusal({ kind: "unverified-owner" }, "env_export") ?? "";
  assert.doesNotMatch(text, /header|origin|token|curl|forge/i);
});

test("a plugin may still read a value but unverified-owner may not", () => {
  assert.equal(callerRefusal({ kind: "plugin", pluginId: "lane-pilot" }, "env_get_value"), null);
  assert.match(callerRefusal({ kind: "unverified-owner" }, "env_get_value") ?? "", /Refused/);
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
