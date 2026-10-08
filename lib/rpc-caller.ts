// Who is calling an RPC / CLI method (VK core function `vk.rpcCallerPolicy`).
//
// BB's HTTP API has no login, so an agent can post to /api/v1/plugins/env-catalog/rpc/*
// with curl or python and the shell guard never sees it. A VK core marks each call
// (`experimental_vkCaller`); the methods that read, change or move secrets accept
// only the owner's app and the owner's CLI. Agents use the env_get / env_list /
// env_request tools; the changing tools env_set / env_delete refuse an agent outright
// (a tool call is an agent-thread call by definition; the owner changes the catalog on the
// page or answers an env_request form).
//
// `owner-ui` and `owner-cli` are client-asserted marks: they stop scripts that carry
// none (curl, python, node fetch are `unknown`) and the bb CLI inside an agent
// session (`agent-thread`), not a client that forges them on purpose.
//
// Fallback: on a core without the function the mark is absent (undefined). The plugin
// cannot tell the caller then and keeps the old behaviour (allow); the shell guard and
// the roles of the agent tools stay the only protection until the core is deployed.

// `unverified-owner`: a core that no longer trusts the client marks reports an owner
// claim it could not verify (forged or unprovable `owner-*`). It is refused like the
// others, with its own message, until the owner is logged in on the page.
export type VkCallerKind =
  | "owner-ui"
  | "owner-cli"
  | "unverified-owner"
  | "agent-thread"
  | "plugin"
  | "unknown";

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
  | "cli_import_machine_env"
  // Agent tools that change the catalog (server.ts passes an agent-thread caller).
  | "tool_env_set"
  | "tool_env_delete";

const KINDS: readonly string[] = [
  "owner-ui",
  "owner-cli",
  "unverified-owner",
  "agent-thread",
  "plugin",
  "unknown",
];

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

const REFUSED_FOR_OWNER_LOGIN =
  "Refused: the owner's session is not verified, so this Env Catalog action is not available from here. " +
  "Open the Env Catalog page after the owner has signed in " +
  "(открой страницу Env Catalog после входа владельца) and do it there.";

const REFUSED_TOOL =
  "Refused: agents cannot change the Env Catalog with this tool. Ask the owner to enter the value " +
  "through the env_request form (it saves the credential without showing it in the chat), " +
  "or to change it on the Env Catalog page.";

const REFUSED_DEFAULT =
  "Refused: this Env Catalog action is available only from the Env Catalog page and the owner's " +
  "bb CLI. Agents use the env_get, env_list and env_request tools.";

/** A refusal message when this caller must not run the method, otherwise null. */
export function callerRefusal(caller: VkCaller | undefined, method: GuardedMethod): string | null {
  // The changing agent tools have no stock caller mark: whoever calls a tool is an agent.
  if (method === "tool_env_set" || method === "tool_env_delete") return REFUSED_TOOL;
  if (caller === undefined) return null;
  if (caller.kind === "owner-ui" || caller.kind === "owner-cli") return null;
  if (caller.kind === "plugin" && PLUGIN_ALLOWED.has(method)) return null;
  if (caller.kind === "unverified-owner") return REFUSED_FOR_OWNER_LOGIN;
  return REFUSED_DEFAULT;
}
