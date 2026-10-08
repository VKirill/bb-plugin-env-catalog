// End-to-end over server.ts with a hand-made `bb`: agents read, save and delete at once with no
// grant, no form and no wait; every action lands in the issuance journal, never with the value.
// (The SDK's fake host needs cron-parser, which this repo does not install.)
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import plugin from "../server.ts";

type Handler = (input: any, ctx?: any) => Promise<any>;

async function boot() {
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, (input: any, ctx: any) => Promise<string>>();
  const registered: Array<{ name: string; description: string; parameters: unknown }> = [];
  let cli: { run: (argv: string[], ctx: any) => Promise<any> } | undefined;
  let instructions = "";
  const forms: unknown[] = [];
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
    realtime: { publish() {} },
    agents: {
      registerTool: (t: any) => {
        tools.set(t.name, t.execute);
        registered.push(t);
      },
      contributeInstructions: (fn: () => string) => (instructions = fn()),
    },
    cli: { register: (c: any) => (cli = c) },
    ui: { requestInput: (request: unknown) => (forms.push(request), new Promise(() => {})) },
    sdk: {
      threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, title: `Title of ${threadId}`, titleFallback: null, projectId: "proj_1" }) },
      projects: { get: async () => ({ name: "Shorts" }) },
    },
    onDispose() {},
  };
  await plugin(bb);
  const call = (method: string, input: unknown, ctx?: unknown) => handlers.get(method)!(input, ctx);
  await call("env_save", { name: "VASTAI_API_KEY", value: "sekret-value-1" });
  const tick = () => new Promise((r) => setTimeout(r, 20));
  const agentCtx = (threadId = "thr_a") => ({ threadId, projectId: "proj_1", signal: new AbortController().signal });
  return { call, tools, registered, cli: () => cli!, forms, tick, agentCtx, instructions: () => instructions, handlers };
}

const parse = (s: string) => JSON.parse(s);

test("env_get returns the value at once: no form, no grant, journal gets the thread and purpose", async () => {
  const h = await boot();
  const out = parse(await h.tools.get("env_get")!({ name: "VASTAI_API_KEY", purpose: "rent a GPU" }, h.agentCtx("thr_a")));
  assert.equal(out.found, true);
  assert.equal(out.value, "sekret-value-1");
  assert.equal(h.forms.length, 0);
  await h.tick();
  const { entries } = await h.call("journal_list", {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].outcome, "issued");
  assert.equal(entries[0].via, "tool");
  assert.equal(entries[0].threadId, "thr_a");
  assert.equal(entries[0].threadTitle, "Title of thr_a");
  assert.equal(entries[0].projectName, "Shorts");
  assert.equal(entries[0].purpose, "rent a GPU");
  assert.doesNotMatch(JSON.stringify(entries), /sekret-value-1/);
});

test("a missing name is answered with a hint", async () => {
  const h = await boot();
  const out = parse(await h.tools.get("env_get")!({ name: "NOPE" }, h.agentCtx()));
  assert.equal(out.found, false);
  assert.match(out.message, /env_list/);
  await h.tick();
  assert.equal((await h.call("journal_list", {})).entries.length, 0);
});

test("bb env-catalog get --raw works from any session at once", async () => {
  const h = await boot();
  const agent = { threadId: "thr_cli", projectId: "proj_1" };
  const raw = await h.cli().run(["get", "VASTAI_API_KEY", "--raw", "--purpose", "vast"], agent);
  assert.equal(raw.exitCode, 0);
  assert.equal(raw.stdout, "sekret-value-1");
  const plain = await h.cli().run(["get", "VASTAI_API_KEY"], {});
  assert.equal(plain.exitCode, 0);
  assert.match(plain.stdout, /sekret-value-1/);
  await h.tick();
  const { entries } = await h.call("journal_list", {});
  const viaCli = entries.find((e: any) => e.threadId === "thr_cli");
  assert.equal(viaCli.via, "cli");
  assert.equal(viaCli.purpose, "vast");
  assert.equal(h.forms.length, 0);
});

test("agents save and delete with env_set / env_delete and the journal records both", async () => {
  const h = await boot();
  const ctx = h.agentCtx("thr_b");
  const saved = parse(await h.tools.get("env_set")!({ name: "PASTED_KEY", kind: "secret", value: "k-123" }, ctx));
  assert.equal(saved.success, true);
  assert.equal(parse(await h.tools.get("env_get")!({ name: "PASTED_KEY" }, ctx)).value, "k-123");
  const deleted = parse(await h.tools.get("env_delete")!({ name: "PASTED_KEY" }, ctx));
  assert.equal(deleted.success, true);
  assert.equal(parse(await h.tools.get("env_get")!({ name: "PASTED_KEY" }, ctx)).found, false);
  await h.tick();
  const outcomes = (await h.call("journal_list", { name: "PASTED_KEY" })).entries.map((e: any) => e.outcome).sort();
  assert.deepEqual(outcomes, ["deleted", "issued", "saved"]);
  assert.doesNotMatch(JSON.stringify(await h.call("journal_list", {})), /k-123/);
});

test("CLI set, delete, export need no caller mark and are journalled", async () => {
  const h = await boot();
  const agent = { threadId: "thr_c" };
  assert.equal((await h.cli().run(["set", "CLI_KEY", "v1"], agent)).exitCode, 0);
  assert.match((await h.cli().run(["export"], agent)).stdout, /CLI_KEY/);
  assert.equal((await h.cli().run(["delete", "CLI_KEY"], agent)).exitCode, 0);
  await h.tick();
  const outcomes = (await h.call("journal_list", { name: "CLI_KEY" })).entries.map((e: any) => e.outcome).sort();
  assert.deepEqual(outcomes, ["deleted", "saved"]);
});

test("the page RPCs and plugin reads work with no caller mark (stock BB)", async () => {
  const h = await boot();
  assert.equal((await h.call("env_get_value", { name: "VASTAI_API_KEY" })).value, "sekret-value-1");
  assert.match((await h.call("env_export", { format: "env" })).content, /VASTAI_API_KEY/);
});

test("no grant machinery is left: no grant RPCs, no form, tool text does not promise a wait", async () => {
  const h = await boot();
  for (const m of ["grant_list", "grant_decide", "grant_create", "grant_revoke"]) assert.equal(h.handlers.has(m), false, m);
  assert.equal(h.handlers.has("journal_list"), true);
  for (const t of h.registered) assert.doesNotMatch(t.description, /grant|Refused|WAITS/i, t.name);
  assert.doesNotMatch(h.instructions(), /grant|cannot save|refuse/i);
  assert.match(h.instructions(), /env_set/);
});
