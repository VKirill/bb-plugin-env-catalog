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

// `unverified-owner`: owner login is OFF (or in its grace period), and the request carries
// what the Env Catalog page (`evidence: "browser-headers"`) or the owner's `bb` (`"cli-header"`)
// normally sends. It is a claim any script can forge, so it is a distinct kind. Until the owner
// login is ON the owner must still be able to use the page, so the page's own RPCs accept the
// browser claim and the CLI methods accept the CLI claim; nothing else. With login ON core stops
// emitting this kind (headers alone become `unknown`) and the owner arrives as a verified
// `owner-ui` / `owner-cli`: no flag is needed here, the kinds carry it.
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
  // The page's grant management and the answer to a grant form (owner only).
  | "grant_decide"
  | "grant_create"
  | "grant_list"
  | "grant_revoke"
  | "journal_list"
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

const CLI_METHODS: ReadonlySet<GuardedMethod> = new Set([
  "cli_get",
  "cli_set",
  "cli_delete",
  "cli_export",
  "cli_import_machine_env",
]);

// Every refusal says what to do next (owner rule 2026-10-08: never a bare "Refused").
const ASK_FOR_VALUE =
  "To use a stored credential ask for it with the env_get tool (or `bb env-catalog get NAME --raw` in the shell): " +
  "the owner gets a form by itself («Выдать NAME треду…? Один раз / Всегда для этого проекта / Нет»), " +
  "the call waits for the answer (up to 10 minutes) and then returns the value. Do not look for a workaround.";
const ASK_FOR_CHANGE =
  "Ask the owner to change it on the Env Catalog page, or call env_request with the name " +
  "(`bb env-catalog request NAME`): the owner types the value into a masked form and it is saved without showing it in the chat.";

const REFUSED_FOR_OWNER_LOGIN =
  "Refused: this Env Catalog action is for the owner's own page or terminal, and the request did not carry a verified owner session. " +
  "Open the Env Catalog page after the owner has signed in " +
  "(открой страницу Env Catalog после входа владельца) and do it there.";

const REFUSED_TOOL =
  "Refused: agents cannot change the Env Catalog with this tool. " + ASK_FOR_CHANGE;

function agentRefusal(method: GuardedMethod): string {
  switch (method) {
    case "env_get_value":
    case "cli_get":
      return method === "cli_get"
        ? "Refused: no grant check could run for this shell call (the session carries no thread identity). " + ASK_FOR_VALUE
        : "Refused: agents do not read the catalog through this RPC. " + ASK_FOR_VALUE;
    case "grant_decide":
    case "grant_create":
    case "grant_list":
    case "grant_revoke":
    case "journal_list":
      return (
        "Refused: only the owner answers a grant form or manages grants, on the Env Catalog page or in the form itself. " +
        "Do not retry: call env_get again and wait, the owner already has the form."
      );
    default:
      return "Refused: this Env Catalog action is the owner's alone (page or own terminal). " + ASK_FOR_CHANGE + " " + ASK_FOR_VALUE;
  }
}

/** A refusal message when this caller must not run the method, otherwise null. */
export function callerRefusal(caller: VkCaller | undefined, method: GuardedMethod): string | null {
  // The changing agent tools have no stock caller mark: whoever calls a tool is an agent.
  if (method === "tool_env_set" || method === "tool_env_delete") return REFUSED_TOOL;
  if (caller === undefined) return null;
  if (caller.kind === "owner-ui" || caller.kind === "owner-cli") return null;
  if (caller.kind === "plugin" && PLUGIN_ALLOWED.has(method)) return null;
  if (caller.kind === "unverified-owner") {
    // Owner login is off: keep the owner's page and terminal working (see the header).
    const fromPage = caller.evidence === "browser-headers" && !CLI_METHODS.has(method);
    const fromTerminal = caller.evidence === "cli-header" && CLI_METHODS.has(method);
    return fromPage || fromTerminal ? null : REFUSED_FOR_OWNER_LOGIN;
  }
  if (caller.kind === "agent-thread") return agentRefusal(method);
  return (
    "Refused: the call did not identify itself as the owner's page, the owner's terminal or an agent session. " +
    "Use the Env Catalog page as the owner, or from an agent session the env_get / env_request tools. " +
    agentRefusal(method).replace(/^Refused: /, "")
  );
}
