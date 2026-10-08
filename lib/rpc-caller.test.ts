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

const ctx = (kind: string) => ({ experimental_vkCaller: { kind, evidence: "x" } });

test("owner app and owner CLI may run every guarded method", () => {
  for (const kind of ["owner-ui", "owner-cli"]) {
    for (const method of ALL) assert.equal(callerRefusal(readVkCaller(ctx(kind)), method), null, `${kind} ${method}`);
  }
});

test("agent sessions and unmarked scripts are refused on every guarded method", () => {
  for (const kind of ["agent-thread", "unknown"]) {
    for (const method of ALL) {
      assert.match(callerRefusal(readVkCaller(ctx(kind)), method) ?? "", /Refused/, `${kind} ${method}`);
    }
  }
});

test("another plugin may read a value and nothing else", () => {
  const caller = readVkCaller({ experimental_vkCaller: { kind: "plugin", pluginId: "lane-pilot" } });
  assert.equal(callerRefusal(caller, "env_get_value"), null);
  for (const method of ALL.filter((m) => m !== "env_get_value")) {
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
  for (const method of ALL) assert.equal(callerRefusal(undefined, method), null);
});

test("the refusal does not say how to get past it", () => {
  const text = callerRefusal({ kind: "unknown" }, "env_get_value") ?? "";
  assert.doesNotMatch(text, /header|origin|token|curl/i);
});
