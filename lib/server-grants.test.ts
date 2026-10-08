// End-to-end over server.ts with a hand-made `bb`: the grant flow of env_get / bb env-catalog get,
// the owner-only answer, the journal and the page RPCs. (The SDK's fake host needs cron-parser,
// which this repo does not install.)
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import plugin from "../server.ts";

type Handler = (input: any, ctx?: any) => Promise<any>;

interface Form {
  request: any;
  resolve: (r: { outcome: "submitted"; value: unknown } | { outcome: "cancelled"; reason: string }) => void;
}

async function boot() {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, (input: any, ctx: any) => Promise<string>>();
  let cli: { run: (argv: string[], ctx: any) => Promise<any> } | undefined;
  const forms: Form[] = [];
  const published: any[] = [];
  const db = new Database(":memory:");
  const bb: any = {
    pluginId: "env-catalog",
    log: { info() {}, warn() {}, error() {}, debug() {} },
    server: { experimental_dataDir: mkdtempSync(join(tmpdir(), "ec-test-")) },
    storage: {
      database: () => db,
      migrate: (d: Database.Database, statements: string[]) => statements.forEach((s) => d.exec(s)),
    },
    rpc: { register: (_c: unknown, h: Record<string, Handler>) => Object.entries(h).forEach(([k, v]) => handlers.set(k, v)) },
    realtime: { publish: (...args: unknown[]) => published.push(args) },
    agents: {
      registerTool: (t: any) => tools.set(t.name, t.execute),
      contributeInstructions() {},
    },
    cli: { register: (c: any) => (cli = c) },
    ui: {
      requestInput: (request: any, options?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          forms.push({ request, resolve: resolve as Form["resolve"] });
          options?.signal?.addEventListener("abort", () => resolve({ outcome: "cancelled", reason: "request-aborted" }));
        }),
    },
    sdk: {
      threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, title: `Title of ${threadId}`, titleFallback: null, projectId: "proj_1" }) },
      projects: { get: async () => ({ name: "Shorts" }) },
    },
    onDispose() {},
  };
  await plugin(bb);
  const owner = { experimental_vkCaller: { kind: "owner-ui", evidence: "owner-session" } };
  const call = (method: string, input: unknown, ctx: unknown = owner) => handlers.get(method)!(input, ctx);
  await call("env_save", { name: "VASTAI_API_KEY", value: "sekret-value-1" });
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const getTool = (threadId = "thr_a", extra: Record<string, unknown> = {}) =>
    tools.get("env_get")!({ name: "VASTAI_API_KEY", ...extra }, { threadId, projectId: "proj_1", signal: new AbortController().signal });
  return { call, tools, cli: () => cli!, forms, tick, getTool, published };
}

const parse = (s: string) => JSON.parse(s);

test("no grant: the tool posts a form, waits, and returns the value only after the owner answers", async () => {
  const h = await boot();
  const pending = h.getTool("thr_a", { purpose: "rent a GPU" });
  await h.tick();
  assert.equal(h.forms.length, 1);
  assert.equal(h.forms[0].request.rendererId, "env-catalog-grant");
  assert.equal(h.forms[0].request.threadId, "thr_a");
  assert.match(h.forms[0].request.title, /VASTAI_API_KEY/);
  assert.equal(h.forms[0].request.payload.purpose, "rent a GPU");
  assert.equal(h.forms[0].request.payload.projectName, "Shorts");
  assert.doesNotMatch(JSON.stringify(h.forms[0].request), /sekret-value-1/);

  const reqId = h.forms[0].request.payload.requestId;
  await h.call("grant_decide", { requestId: reqId, decision: "once" });
  h.forms[0].resolve({ outcome: "submitted", value: { requestId: reqId, decision: "once" } });
  const out = parse(await pending);
  assert.equal(out.granted, true);
  assert.equal(out.value, "sekret-value-1");
  assert.equal(out.grant, "once");

  // "once" is spent: the next call asks again.
  const again = h.getTool("thr_a");
  await h.tick();
  assert.equal(h.forms.length, 2);
  h.forms[1].resolve({ outcome: "cancelled", reason: "timeout" });
  assert.equal(parse(await again).granted, false);
});

test("a forged form response without the owner-only RPC grants nothing", async () => {
  const h = await boot();
  const pending = h.getTool();
  await h.tick();
  h.forms[0].resolve({ outcome: "submitted", value: { requestId: h.forms[0].request.payload.requestId, decision: "project" } });
  const out = parse(await pending);
  assert.equal(out.granted, false);
  assert.equal(out.value, undefined);
  assert.match(out.message, /NOT given/);
  const j = (await h.call("journal_list", {})).entries;
  assert.equal(j[0].outcome, "timeout");
});

test("the agent cannot answer its own form", async () => {
  const h = await boot();
  const pending = h.getTool();
  await h.tick();
  const reqId = h.forms[0].request.payload.requestId;
  const agent = { experimental_vkCaller: { kind: "agent-thread", threadId: "thr_a", evidence: "thread-token" } };
  await assert.rejects(h.call("grant_decide", { requestId: reqId, decision: "once" }, agent), /only the owner/);
  const forged = { experimental_vkCaller: { kind: "unverified-owner", evidence: "cli-header" } };
  await assert.rejects(h.call("grant_decide", { requestId: reqId, decision: "once" }, forged), /Refused/);
  h.forms[0].resolve({ outcome: "cancelled", reason: "user" });
  assert.equal(parse(await pending).granted, false);
});

test("Always for this project: later calls from other threads of the project return at once; journal has no value", async () => {
  const h = await boot();
  const first = h.getTool("thr_a");
  await h.tick();
  const reqId = h.forms[0].request.payload.requestId;
  await h.call("grant_decide", { requestId: reqId, decision: "project" });
  h.forms[0].resolve({ outcome: "submitted", value: {} });
  assert.equal(parse(await first).grant, "project");

  const second = parse(await h.getTool("thr_b"));
  assert.equal(second.granted, true);
  assert.equal(second.value, "sekret-value-1");
  assert.equal(h.forms.length, 1);

  const { grants } = await h.call("grant_list", null);
  assert.equal(grants.length, 1);
  assert.equal(grants[0].scope, "project");
  assert.equal(grants[0].scopeId, "proj_1");

  const { entries } = await h.call("journal_list", {});
  assert.equal(entries.length, 2);
  assert.equal(entries[0].threadId, "thr_b");
  assert.equal(entries[0].grantKind, "project");
  assert.doesNotMatch(JSON.stringify(entries), /sekret-value-1/);

  await h.call("grant_revoke", { id: grants[0].id });
  const afterRevoke = h.getTool("thr_c");
  await h.tick();
  assert.equal(h.forms.length, 2);
  h.forms[1].resolve({ outcome: "cancelled", reason: "timeout" });
  await afterRevoke;
});

test("No: the agent is told not to retry or work around", async () => {
  const h = await boot();
  const pending = h.getTool();
  await h.tick();
  await h.call("grant_decide", { requestId: h.forms[0].request.payload.requestId, decision: "deny" });
  h.forms[0].resolve({ outcome: "submitted", value: {} });
  const out = parse(await pending);
  assert.equal(out.granted, false);
  assert.equal(out.reason, "denied");
  assert.match(out.message, /Do not retry/);
});

test("the owner can answer on the page: the waiting call returns and the form closes", async () => {
  const h = await boot();
  const pending = h.getTool("thr_p");
  await h.tick();
  const { pending: list } = await h.call("grant_list", null);
  assert.equal(list.length, 1);
  await h.call("grant_decide", { requestId: list[0].id, decision: "thread" });
  const out = parse(await pending);
  assert.equal(out.grant, "thread");
  assert.equal((await h.call("grant_list", null)).pending.length, 0);
});

test("a missing name is answered without a form", async () => {
  const h = await boot();
  const out = parse(await h.tools.get("env_get")!({ name: "NOPE" }, { threadId: "thr_a", projectId: "proj_1", signal: new AbortController().signal }));
  assert.equal(out.found, false);
  assert.equal(h.forms.length, 0);
});

test("bb env-catalog get from an agent session goes through the same grant flow", async () => {
  const h = await boot();
  const agent = { experimental_vkCaller: { kind: "agent-thread", threadId: "thr_cli", evidence: "thread-token" }, projectId: "proj_1" };
  const pending = h.cli().run(["get", "VASTAI_API_KEY", "--raw", "--purpose", "vast"], agent);
  await h.tick();
  assert.equal(h.forms.length, 1);
  assert.equal(h.forms[0].request.threadId, "thr_cli");
  assert.equal(h.forms[0].request.payload.source, "cli");
  await h.call("grant_decide", { requestId: h.forms[0].request.payload.requestId, decision: "thread" });
  h.forms[0].resolve({ outcome: "submitted", value: {} });
  const res = await pending;
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "sekret-value-1");
  // Standing grant: the next call is immediate.
  const again = await h.cli().run(["get", "VASTAI_API_KEY", "--raw"], agent);
  assert.equal(again.stdout, "sekret-value-1");
  assert.equal(h.forms.length, 1);
});

test("agent shell without a thread identity gets an instruction, not a bare refusal", async () => {
  const h = await boot();
  const res = await h.cli().run(["get", "VASTAI_API_KEY", "--raw"], { experimental_vkCaller: { kind: "agent-thread", evidence: "cli-header" } });
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr, /env_get/);
  assert.match(res.stderr, /form/);
});

test("agents still cannot set, delete or export; every refusal says what to do", async () => {
  const h = await boot();
  const agent = { experimental_vkCaller: { kind: "agent-thread", threadId: "thr_a", evidence: "thread-token" } };
  for (const argv of [["set", "X", "y"], ["delete", "VASTAI_API_KEY"], ["export"]]) {
    const res = await h.cli().run(argv, agent);
    assert.equal(res.exitCode, 1, argv[0]);
    assert.match(res.stderr, /env_request|Env Catalog page/, argv[0]);
  }
  await assert.rejects(h.call("env_get_value", { name: "VASTAI_API_KEY" }, agent), /env_get/);
  const deleted = parse(await h.tools.get("env_delete")!({ name: "VASTAI_API_KEY" }, { threadId: "thr_a" }));
  assert.equal(deleted.refused, true);
});

test("owner page and owner terminal keep working while owner login is off (unverified-owner)", async () => {
  const h = await boot();
  const page = { experimental_vkCaller: { kind: "unverified-owner", evidence: "browser-headers" } };
  const term = { experimental_vkCaller: { kind: "unverified-owner", evidence: "cli-header" } };
  assert.equal((await h.call("env_get_value", { name: "VASTAI_API_KEY" }, page)).value, "sekret-value-1");
  await h.call("env_save", { name: "B", value: "2" }, page);
  assert.equal((await h.call("grant_list", null, page)).grants.length, 0);
  assert.equal((await h.cli().run(["get", "VASTAI_API_KEY", "--raw"], term)).stdout, "sekret-value-1");
  // The terminal claim is not the page's, and the page claim is not the terminal's.
  await assert.rejects(h.call("env_get_value", { name: "VASTAI_API_KEY" }, term), /Refused/);
  assert.equal((await h.cli().run(["get", "VASTAI_API_KEY", "--raw"], page)).exitCode, 1);
});

test("a plugin read is journalled with the plugin id", async () => {
  const h = await boot();
  const lp = { experimental_vkCaller: { kind: "plugin", pluginId: "lane-pilot", evidence: "plugin-token" } };
  assert.equal((await h.call("env_get_value", { name: "VASTAI_API_KEY" }, lp)).value, "sekret-value-1");
  const { entries } = await h.call("journal_list", { name: "VASTAI_API_KEY" });
  assert.equal(entries[0].via, "plugin");
  assert.equal(entries[0].caller, "plugin:lane-pilot");
});

test("deleting a secret drops its grants", async () => {
  const h = await boot();
  await h.call("grant_create", { name: "VASTAI_API_KEY", scope: "project", scopeId: "proj_1" });
  assert.equal((await h.call("grant_list", null)).grants.length, 1);
  await h.call("env_delete", { name: "VASTAI_API_KEY" });
  assert.equal((await h.call("grant_list", null)).grants.length, 0);
});
