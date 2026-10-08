// Who is calling an RPC / CLI method (VK core function `vk.rpcCallerPolicy`).
//
// BB's HTTP API has no login, so an agent can post to /api/v1/plugins/env-catalog/rpc/*
// with curl or python and the shell guard never sees it. A VK core marks each call
// (`experimental_vkCaller`); the methods that read, change or move secrets accept
// only the owner's app and the owner's CLI. Agents use the env_get / env_list /
// env_request tools, which check their own role.
//
// `owner-ui` and `owner-cli` are client-asserted marks: they stop scripts that carry
// none (curl, python, node fetch are `unknown`) and the bb CLI inside an agent
// session (`agent-thread`), not a client that forges them on purpose.
//
// Fallback: on a core without the function the mark is absent (undefined). The plugin
// cannot tell the caller then and keeps the old behaviour (allow); the shell guard and
// the roles of the agent tools stay the only protection until the core is deployed.

export type VkCallerKind = "owner-ui" | "owner-cli" | "agent-thread" | "plugin" | "unknown";

export interface VkCaller {
  kind: VkCallerKind;
  threadId?: string;
  pluginId?: string;
  evidence?: string;
}

export type GuardedMethod =
  | "env_get_value"
  | "env_save"
  | "env_delete"
  | "env_export"
  | "env_import"
  | "env_import_machine_env"
  | "cli_get"
  | "cli_set"
  | "cli_delete"
  | "cli_export"
  | "cli_import_machine_env";

const KINDS: readonly string[] = ["owner-ui", "owner-cli", "agent-thread", "plugin", "unknown"];

/** The mark a VK core put on the call context, or undefined (stock core or no mark). */
export function readVkCaller(ctx: unknown): VkCaller | undefined {
  if (typeof ctx !== "object" || ctx === null) return undefined;
  const raw = (ctx as { experimental_vkCaller?: unknown }).experimental_vkCaller;
  if (typeof raw !== "object" || raw === null) return undefined;
  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== "string") return undefined;
  // A kind this plugin does not know is treated like no credentials.
  return KINDS.includes(kind) ? (raw as VkCaller) : { kind: "unknown" };
}

// Another plugin may read a value (Lane Pilot checks, Image Studio keys); it may not
// change or export the catalog.
const PLUGIN_ALLOWED: ReadonlySet<GuardedMethod> = new Set(["env_get_value"]);

/** A refusal message when this caller must not run the method, otherwise null. */
export function callerRefusal(caller: VkCaller | undefined, method: GuardedMethod): string | null {
  if (caller === undefined) return null;
  if (caller.kind === "owner-ui" || caller.kind === "owner-cli") return null;
  if (caller.kind === "plugin" && PLUGIN_ALLOWED.has(method)) return null;
  return (
    "Refused: this Env Catalog action is available only from the Env Catalog page and the owner's " +
    "bb CLI. Agents use the env_get, env_list and env_request tools."
  );
}
