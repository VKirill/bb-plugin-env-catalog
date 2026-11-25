import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, EnvSummary } from "./server";
import {
  ENV_CATALOG_LOCK_CHANGED,
  ENV_REQUEST_RENDERER_ID,
  LOCK_LIMITS,
  LOCKED_MESSAGE,
  passcodeProblem,
  type LockKind,
  envRequestPayloadSchema,
  envRequestResponseSchema,
} from "./contracts.js";
import { t } from "./i18n";
import {
  CREDENTIAL_KINDS,
  MAX_SECRET_BYTES,
  defaultPort,
  type CredentialKind,
  type FtpAccess,
  type LoginAccess,
  type SshAccess,
} from "./kinds.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ENV_CATALOG_CHANGED = "env-catalog:changed";

const KIND_LABEL: Record<CredentialKind, "kindSecret" | "kindFtp" | "kindSsh" | "kindLogin"> = {
  secret: "kindSecret",
  ftp: "kindFtp",
  ssh: "kindSsh",
  login: "kindLogin",
};

interface SecretFormData {
  name: string;
  kind: CredentialKind;
  value: string;
  service: string;
  description: string;
  protocol: "ftp" | "ftps" | "sftp";
  host: string;
  port: string;
  username: string;
  password: string;
  root: string;
  fingerprint: string;
  privateKey: string;
  passphrase: string;
  url: string;
}

function blankForm(kind: CredentialKind = "secret"): SecretFormData {
  return {
    name: "",
    kind,
    value: "",
    service: "",
    description: "",
    protocol: "ftps",
    host: "",
    port: String(defaultPort(kind, "ftps")),
    username: "",
    password: "",
    root: "/",
    fingerprint: "",
    privateKey: "",
    passphrase: "",
    url: "",
  };
}

function formFromRecord(full: {
  name: string;
  kind?: CredentialKind | null;
  value?: string | null;
  access?: unknown;
  service?: string | null;
  description?: string | null;
}): SecretFormData {
  const kind = full.kind ?? "secret";
  const next = blankForm(kind);
  next.name = full.name;
  next.service = full.service ?? "";
  next.description = full.description ?? "";
  next.value = full.value ?? "";
  const access = (full.access ?? {}) as Record<string, unknown>;
  if (kind === "ftp") {
    const a = access as Partial<FtpAccess>;
    next.protocol = a.protocol ?? "ftps";
    next.host = a.host ?? "";
    next.port = String(a.port ?? defaultPort("ftp", a.protocol));
    next.username = a.username ?? "";
    next.password = a.password ?? "";
    next.root = a.root ?? "/";
    next.fingerprint = a.fingerprint ?? "";
  } else if (kind === "ssh") {
    const a = access as Partial<SshAccess>;
    next.host = a.host ?? "";
    next.port = String(a.port ?? 22);
    next.username = a.username ?? "";
    next.privateKey = a.privateKey ?? "";
    next.passphrase = a.passphrase ?? "";
    next.fingerprint = a.fingerprint ?? "";
  } else if (kind === "login") {
    const a = access as Partial<LoginAccess>;
    next.url = a.url ?? "";
    next.host = a.host ?? "";
    next.username = a.username ?? "";
    next.password = a.password ?? "";
  }
  return next;
}

function accessFromForm(form: SecretFormData): Record<string, unknown> | null {
  if (form.kind === "secret") return null;
  if (form.kind === "ftp") {
    return {
      protocol: form.protocol,
      host: form.host.trim(),
      port: Number(form.port) || defaultPort("ftp", form.protocol),
      username: form.username.trim(),
      password: form.password,
      root: form.root.trim() || undefined,
      fingerprint: form.fingerprint.trim() || undefined,
    };
  }
  if (form.kind === "ssh") {
    return {
      host: form.host.trim(),
      port: Number(form.port) || 22,
      username: form.username.trim(),
      privateKey: form.privateKey,
      passphrase: form.passphrase || undefined,
      fingerprint: form.fingerprint.trim() || undefined,
    };
  }
  return {
    url: form.url.trim() || undefined,
    host: form.host.trim() || undefined,
    username: form.username.trim(),
    password: form.password,
  };
}

function fieldClass(extra = "") {
  return cn(
    "w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
    extra,
  );
}

function KindFields({
  form,
  setForm,
  nameLocked,
  passwordOptional,
}: {
  form: SecretFormData;
  setForm: (next: SecretFormData) => void;
  nameLocked: boolean;
  passwordOptional?: boolean;
}) {
  const set = (patch: Partial<SecretFormData>) => setForm({ ...form, ...patch });
  return (
    <div className="grid max-h-[60vh] gap-4 overflow-y-auto py-4">
      <div className="grid gap-1.5">
        <label className="text-xs font-medium">{t("kind")}</label>
        <select
          className={fieldClass()}
          value={form.kind}
          onChange={(e) => {
            const kind = e.target.value as CredentialKind;
            setForm({
              ...form,
              kind,
              port: String(defaultPort(kind, form.protocol)),
            });
          }}
        >
          {CREDENTIAL_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t(KIND_LABEL[kind])}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label className="text-xs font-medium">{t("name")}</label>
        <Input
          required
          placeholder={t("namePlaceholder")}
          value={form.name}
          disabled={nameLocked}
          onChange={(e) => set({ name: e.target.value })}
          className="font-mono text-sm uppercase"
        />
      </div>
      {form.kind === "secret" ? (
        <div className="grid gap-1.5">
          <label className="text-xs font-medium">{t("value")}</label>
          <textarea
            required
            rows={4}
            placeholder={t("valuePlaceholder")}
            value={form.value}
            onChange={(e) => set({ value: e.target.value })}
            className={fieldClass()}
          />
        </div>
      ) : null}
      {form.kind === "ftp" ? (
        <>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium">{t("protocol")}</label>
            <select
              className={fieldClass()}
              value={form.protocol}
              onChange={(e) => {
                const protocol = e.target.value as SecretFormData["protocol"];
                set({ protocol, port: String(defaultPort("ftp", protocol)) });
              }}
            >
              <option value="ftps">FTPS</option>
              <option value="sftp">SFTP</option>
              <option value="ftp">FTP</option>
            </select>
          </div>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1 text-xs font-medium">
              {t("host")}
              <Input required value={form.host} onChange={(e) => set({ host: e.target.value })} className="mt-1" />
            </label>
            <label className="w-24 text-xs font-medium">
              {t("port")}
              <Input required value={form.port} onChange={(e) => set({ port: e.target.value })} className="mt-1" />
            </label>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("username")}
            <Input required value={form.username} onChange={(e) => set({ username: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {passwordOptional ? t("passwordKeep") : t("password")}
            <Input
              type="password"
              autoComplete="new-password"
              required={!passwordOptional}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("root")}
            <Input value={form.root} onChange={(e) => set({ root: e.target.value })} />
          </label>
          {form.protocol === "sftp" ? (
            <label className="grid gap-1.5 text-xs font-medium">
              {t("fingerprint")}
              <Input value={form.fingerprint} onChange={(e) => set({ fingerprint: e.target.value })} />
            </label>
          ) : null}
        </>
      ) : null}
      {form.kind === "ssh" ? (
        <>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1 text-xs font-medium">
              {t("host")}
              <Input required value={form.host} onChange={(e) => set({ host: e.target.value })} className="mt-1" />
            </label>
            <label className="w-24 text-xs font-medium">
              {t("port")}
              <Input required value={form.port} onChange={(e) => set({ port: e.target.value })} className="mt-1" />
            </label>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("username")}
            <Input required value={form.username} onChange={(e) => set({ username: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("privateKey")}
            <textarea
              required
              rows={8}
              placeholder={t("privateKeyPlaceholder")}
              value={form.privateKey}
              onChange={(e) => set({ privateKey: e.target.value })}
              className={fieldClass()}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("passphrase")}
            <Input
              type="password"
              autoComplete="new-password"
              value={form.passphrase}
              onChange={(e) => set({ passphrase: e.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("fingerprint")}
            <Input value={form.fingerprint} onChange={(e) => set({ fingerprint: e.target.value })} />
          </label>
        </>
      ) : null}
      {form.kind === "login" ? (
        <>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("url")}
            <Input
              required={!form.host.trim()}
              placeholder={t("urlPlaceholder")}
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("host")}
            <Input value={form.host} onChange={(e) => set({ host: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("username")}
            <Input required value={form.username} onChange={(e) => set({ username: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {passwordOptional ? t("passwordKeep") : t("password")}
            <Input
              type="password"
              autoComplete="new-password"
              required={!passwordOptional}
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </label>
        </>
      ) : null}
      <label className="grid gap-1.5 text-xs font-medium">
        {t("service")}
        <Input placeholder={t("servicePlaceholder")} value={form.service} onChange={(e) => set({ service: e.target.value })} />
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        {t("description")}
        <Input
          placeholder={t("descriptionPlaceholder")}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
    </div>
  );
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

interface LockSession {
  /** Sent with every page RPC; null while no PIN is set. */
  token: string | null;
  enabled: boolean;
  /** Kind of the stored passcode, and of the next one the settings ask for. */
  kind: LockKind;
  newKind: LockKind;
  autoLockMs: number;
  /** Ends this page's session and shows the lock screen. */
  relock: () => void;
  /** A new session after the PIN was set or changed. */
  opened: (token: string) => void;
  /** Reads the lock state again, after the PIN was removed. */
  refresh: () => void;
}

const noop = () => undefined;
const LockContext = createContext<LockSession>({
  token: null,
  enabled: false,
  kind: "pin",
  newKind: "pin",
  autoLockMs: LOCK_LIMITS.autoLockMinutes.default * 60_000,
  relock: noop,
  opened: noop,
  refresh: noop,
});

/** Page RPCs with this page's unlock token; a "locked" answer shows the lock screen. */
function useCatalogRpc() {
  const rpc = useRpc<typeof rpcContract>();
  const { token, relock } = useContext(LockContext);
  return useMemo(() => {
    const raw = rpc.call as (method: string, input: Record<string, unknown>) => Promise<unknown>;
    const call = async (method: string, input: Record<string, unknown>) => {
      try {
        return await raw(method, { ...input, unlockToken: token });
      } catch (cause) {
        if (errorText(cause).includes(LOCKED_MESSAGE)) relock();
        throw cause;
      }
    };
    return { call: call as typeof rpc.call };
  }, [rpc, token, relock]);
}

function LockScreen({
  kind,
  retryAfterMs,
  onUnlocked,
}: {
  kind: LockKind;
  retryAfterMs: number;
  onUnlocked: (token: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    retryAfterMs > 0 ? t("lockRetry", { s: Math.ceil(retryAfterMs / 1000) }) : null,
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passcode) return;
    setBusy(true);
    setError(null);
    try {
      const { unlockToken } = await rpc.call("lock_unlock", { passcode });
      onUnlocked(unlockToken);
    } catch (cause) {
      setError(errorText(cause));
      setPasscode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto bg-background px-4 py-12 text-foreground">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 rounded-lg border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Icon name="Lock" className="size-5 text-muted-foreground" />
          </div>
          <h1 className="text-base font-semibold tracking-tight">{t("lockedTitle")}</h1>
          <p className="text-xs text-muted-foreground">
            {kind === "pin" ? t("lockedHintPin") : t("lockedHintPassword")}
          </p>
        </div>
        <Input
          type="password"
          autoFocus
          autoComplete="off"
          inputMode={kind === "pin" ? "numeric" : undefined}
          aria-label={kind === "pin" ? t("wordPin") : t("wordPassword")}
          placeholder={kind === "pin" ? t("wordPin") : t("wordPassword")}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="h-10 text-center"
        />
        {error ? (
          <p role="alert" className="text-center text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="h-9 w-full" disabled={busy || !passcode}>
          {t("lockUnlock")}
        </Button>
      </form>
    </div>
  );
}

function LockSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const { enabled, kind, newKind, autoLockMs, opened, refresh } = useContext(LockContext);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }, [open]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const problem = passcodeProblem(newKind, next);
    if (problem === "pinDigits") return setError(t("lockPinRule", LOCK_LIMITS.pinDigits));
    if (problem === "passwordLength") return setError(t("lockPasswordRule", LOCK_LIMITS.passwordLength));
    if (next !== confirm) return setError(t("lockMismatch"));
    void run(async () => {
      const { unlockToken } = await rpc.call("lock_set", { currentPasscode: enabled ? current : null, passcode: next });
      opened(unlockToken);
      refresh();
    });
  };

  const remove = () =>
    void run(async () => {
      await rpc.call("lock_disable", { passcode: current });
      refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {enabled ? t("lockChangeTitle") : newKind === "pin" ? t("lockSetTitlePin") : t("lockSetTitlePassword")}
            </DialogTitle>
            <DialogDescription>{t("lockSetHint", { m: Math.round(autoLockMs / 60_000) })}</DialogDescription>
          </DialogHeader>
          {enabled ? (
            <label className="grid gap-1.5 text-xs font-medium">
              {t("lockCurrent")}
              <Input
                type="password"
                autoComplete="off"
                inputMode={kind === "pin" ? "numeric" : undefined}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
          ) : null}
          <label className="grid gap-1.5 text-xs font-medium">
            {newKind === "pin" ? t("lockNewPin") : t("lockNewPassword")}
            <Input
              type="password"
              autoComplete="new-password"
              inputMode={newKind === "pin" ? "numeric" : undefined}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("lockConfirm")}
            <Input
              type="password"
              autoComplete="new-password"
              inputMode={newKind === "pin" ? "numeric" : undefined}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="mt-2 gap-2">
            {enabled ? (
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:mr-auto sm:w-auto"
                disabled={busy || !current}
                onClick={remove}
              >
                {t("lockRemove")}
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={busy || !next || !confirm || (enabled && !current)}
            >
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface LockShape {
  kind: LockKind;
  newKind: LockKind;
  autoLockMs: number;
}

type LockPhase =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "locked"; retryAfterMs: number }
  | { phase: "open"; enabled: boolean; token: string | null };

/** The navigation page: asks for the PIN when one is set, then shows the catalog. */
function EnvCatalogNavPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<LockPhase>({ phase: "loading" });
  const [shape, setShape] = useState<LockShape>({
    kind: "pin",
    newKind: "pin",
    autoLockMs: LOCK_LIMITS.autoLockMinutes.default * 60_000,
  });
  const autoLockMs = useRef(shape.autoLockMs);
  autoLockMs.current = shape.autoLockMs;
  const tokenRef = useRef<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const endSession = useCallback(() => {
    clearTimeout(idleTimer.current);
    const token = tokenRef.current;
    tokenRef.current = null;
    if (token) void rpc.call("lock_lock", { unlockToken: token }).catch(noop);
  }, [rpc]);

  const relock = useCallback(() => {
    endSession();
    setState({ phase: "locked", retryAfterMs: 0 });
  }, [endSession]);

  const lastPing = useRef(0);

  /** User input on the page: restarts the idle timer and keeps the server session alive. */
  const touch = useCallback(() => {
    const token = tokenRef.current;
    if (!token) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(relock, autoLockMs.current);
    if (Date.now() - lastPing.current < 60_000) return;
    lastPing.current = Date.now();
    void rpc.call("lock_status", { unlockToken: token }).catch(noop);
  }, [rpc, relock]);

  const opened = useCallback(
    (token: string) => {
      tokenRef.current = token;
      lastPing.current = Date.now();
      setState({ phase: "open", enabled: true, token });
      touch();
    },
    [touch],
  );

  const refresh = useCallback(() => {
    const asked = tokenRef.current;
    rpc
      .call("lock_status", { unlockToken: asked })
      .then((status) => {
        if (tokenRef.current !== asked) return;
        autoLockMs.current = status.autoLockMs;
        setShape({ kind: status.kind, newKind: status.newKind, autoLockMs: status.autoLockMs });
        if (!status.unlocked) {
          tokenRef.current = null;
          setState({ phase: "locked", retryAfterMs: status.retryAfterMs });
        } else if (!status.enabled) {
          endSession();
          setState({ phase: "open", enabled: false, token: null });
        } else {
          setState({ phase: "open", enabled: true, token: asked });
          if (asked) touch();
        }
      })
      .catch((cause) => setState({ phase: "error", message: errorText(cause) }));
  }, [rpc, endSession, touch]);

  useEffect(() => {
    refresh();
    return endSession;
  }, [refresh, endSession]);
  useRealtime(ENV_CATALOG_LOCK_CHANGED, refresh);

  const session = useMemo<LockSession>(
    () => ({
      token: state.phase === "open" ? state.token : null,
      enabled: state.phase === "open" && state.enabled,
      ...shape,
      relock,
      opened,
      refresh,
    }),
    [state, shape, relock, opened, refresh],
  );

  if (state.phase === "loading") return <EmptyState>{t("loading")}</EmptyState>;
  if (state.phase === "error") {
    return (
      <div role="alert" className="m-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.message}
      </div>
    );
  }
  if (state.phase === "locked") return <LockScreen kind={shape.kind} retryAfterMs={state.retryAfterMs} onUnlocked={opened} />;
  return (
    <LockContext.Provider value={session}>
      <div className="contents" onPointerDownCapture={touch} onKeyDownCapture={touch} onWheelCapture={touch}>
        <EnvCatalogPage />
      </div>
    </LockContext.Provider>
  );
}

function useEnvCatalog() {
  const rpc = useCatalogRpc();
  const [variables, setVariables] = useState<EnvSummary[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const refetch = useCallback(() => {
    rpc
      .call("env_list", { query: searchQuery.trim() ? searchQuery.trim() : null, kind: null })
      .then((res) => {
        setVariables(res.variables);
        setError(null);
      })
      .catch(report)
      .finally(() => setLoading(false));
  }, [rpc, searchQuery, report]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useRealtime(ENV_CATALOG_CHANGED, refetch);

  return { rpc, variables, searchQuery, setSearchQuery, error, loading, refetch, report };
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function EnvCatalogPage() {
  const { rpc, variables, searchQuery, setSearchQuery, error, loading, refetch, report } = useEnvCatalog();
  const [kindFilter, setKindFilter] = useState<CredentialKind | "all">("all");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportContent, setExportContent] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingNames, setRevealingNames] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [formData, setFormData] = useState<SecretFormData>(blankForm());
  const [formPending, setFormPending] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPending, setImportPending] = useState(false);
  const [lockSettingsOpen, setLockSettingsOpen] = useState(false);
  const lock = useContext(LockContext);

  const openAddModal = () => {
    setEditingName(null);
    setFormData(blankForm());
    setAddModalOpen(true);
  };

  const openEditModal = async (name: string) => {
    try {
      const full = await rpc.call("env_get_value", { name });
      setEditingName(name);
      setFormData(formFromRecord(full));
      setAddModalOpen(true);
    } catch (cause) {
      report(cause);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setFormPending(true);
    try {
      const kind = formData.kind;
      await rpc.call("env_save", {
        name: formData.name.trim(),
        kind,
        value: kind === "secret" ? formData.value : null,
        access: accessFromForm(formData),
        service: formData.service.trim() || null,
        description: formData.description.trim() || null,
        tags: null,
      });
      setAddModalOpen(false);
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setFormPending(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await rpc.call("env_delete", { name });
      setDeleteConfirmItem(null);
      refetch();
    } catch (cause) {
      report(cause);
    }
  };

  const toggleReveal = async (name: string) => {
    if (name in revealed) {
      setRevealed((prev) => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
      return;
    }
    setRevealingNames((prev) => ({ ...prev, [name]: true }));
    try {
      const full = await rpc.call("env_get_value", { name });
      setRevealed((prev) => ({ ...prev, [name]: full.reveal }));
    } catch (cause) {
      report(cause);
    } finally {
      setRevealingNames((prev) => ({ ...prev, [name]: false }));
    }
  };

  const copyToClipboard = async (text: string, keyIdentifier: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyIdentifier);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      report(t("copyFailed"));
    }
  };

  const handleExport = async (format: "env" | "json") => {
    try {
      const res = await rpc.call("env_export", { format });
      setExportContent(res.content);
      setExportModalOpen(true);
    } catch (cause) {
      report(cause);
    }
  };

  const handleImport = async (e: FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;
    setImportPending(true);
    try {
      const isJson = importText.trim().startsWith("[");
      await rpc.call("env_import", {
        content: importText,
        format: isJson ? "json" : "env",
        overwrite: true,
      });
      setImportModalOpen(false);
      setImportText("");
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setImportPending(false);
    }
  };

  const filtered = useMemo(() => {
    const rows = variables ?? [];
    if (kindFilter === "all") return rows;
    return rows.filter((row) => row.kind === kindFilter);
  }, [variables, kindFilter]);

  const countLabel =
    filtered.length === 1 ? t("secretCountOne") : t("secretCountMany", { n: filtered.length });

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto box-border w-full max-w-5xl px-4 pb-12 pt-6 md:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {countLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>

          <div className="flex w-full shrink-0 flex-col gap-2 sm:ml-auto sm:w-[360px]">
            <div className={cn("grid w-full gap-2", lock.enabled ? "grid-cols-4" : "grid-cols-3")}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("env")}
                aria-label={t("export")}
                className="h-9 w-full px-2 text-xs font-normal"
              >
                <Icon name="Download" className="mr-1 size-3.5 shrink-0" />
                <span>{t("export")}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportModalOpen(true)}
                aria-label={t("import")}
                className="h-9 w-full px-2 text-xs font-normal"
              >
                <Icon name="FolderExport" className="mr-1 size-3.5 shrink-0" />
                <span>{t("import")}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLockSettingsOpen(true)}
                className="h-9 w-full px-2 text-xs font-normal"
              >
                <Icon name="SecurityCheck" className="mr-1 size-3.5 shrink-0" />
                <span>
                  {lock.enabled
                    ? lock.kind === "pin"
                      ? t("wordPin")
                      : t("wordPassword")
                    : lock.newKind === "pin"
                      ? t("lockSetPin")
                      : t("lockSetPassword")}
                </span>
              </Button>
              {lock.enabled ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={lock.relock}
                  className="h-9 w-full px-2 text-xs font-normal"
                >
                  <Icon name="Lock" className="mr-1 size-3.5 shrink-0" />
                  <span>{t("lockNow")}</span>
                </Button>
              ) : null}
            </div>
            <Button size="default" onClick={openAddModal} className="h-9 w-full font-medium shadow-xs">
              <Icon name="Plus" className="mr-1.5 size-4" />
              {t("add")}
            </Button>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <div className="relative flex-1">
            <Icon name="Search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-10 pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={kindFilter === "all" ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setKindFilter("all")}
            >
              {t("filterAll")}
            </Button>
            {CREDENTIAL_KINDS.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={kindFilter === kind ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setKindFilter(kind)}
              >
                {t(KIND_LABEL[kind])}
              </Button>
            ))}
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-6">
          {loading && variables === null ? (
            <EmptyState>{t("loading")}</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState>
              {searchQuery ? t("emptySearch", { q: searchQuery }) : t("empty")}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
              <div className="hidden items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[220px_1fr_260px_72px]">
                <div>{t("colName")}</div>
                <div>{t("colMeta")}</div>
                <div>{t("colValue")}</div>
                <div className="text-right">{t("colActions")}</div>
              </div>
              <ul className="divide-y divide-border">
                {filtered.map((item) => {
                  const isRevealed = item.name in revealed;
                  const displayValue = isRevealed ? revealed[item.name] : item.maskedValue;
                  const isRevealing = Boolean(revealingNames[item.name]);
                  return (
                    <li
                      key={item.name}
                      className="px-4 py-3 transition-colors hover:bg-muted/20 md:grid md:grid-cols-[220px_1fr_260px_72px] md:items-center md:gap-4"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm font-semibold" title={item.name}>
                          {item.name}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="inline-block rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                            {t(KIND_LABEL[item.kind ?? "secret"])}
                          </span>
                          {item.service ? (
                            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {item.service}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-1.5 min-w-0 md:mt-0">
                        {item.description ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground" title={item.description}>
                            {item.description}
                          </p>
                        ) : (
                          <span className="text-xs italic text-muted-foreground/50">{t("noDescription")}</span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-1.5 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 font-mono text-xs md:mt-0">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            isRevealed ? "select-all font-medium" : "tracking-widest text-muted-foreground",
                          )}
                        >
                          {displayValue || "••••••••"}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground"
                            onClick={() => toggleReveal(item.name)}
                            disabled={isRevealing}
                            aria-label={isRevealed ? t("hide") : t("reveal")}
                          >
                            <Icon name={isRevealed ? "EyeOff" : "Eye"} className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "size-7 transition-colors",
                              copiedKey === item.name
                                ? "text-emerald-500 hover:text-emerald-600"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            onClick={async () => {
                              if (isRevealed) {
                                void copyToClipboard(revealed[item.name], item.name);
                                return;
                              }
                              try {
                                const full = await rpc.call("env_get_value", { name: item.name });
                                void copyToClipboard(full.reveal, item.name);
                              } catch (err) {
                                report(err);
                              }
                            }}
                            aria-label={t("copy")}
                          >
                            <Icon name={copiedKey === item.name ? "Check" : "Copy"} className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-1 md:mt-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditModal(item.name)}
                          aria-label={t("edit")}
                        >
                          <Icon name="Edit" className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteConfirmItem(item.name)}
                          aria-label={t("delete")}
                        >
                          <Icon name="Trash2" className="size-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <JournalSection />
        </div>
      </div>

      <Dialog
        open={addModalOpen}
        onOpenChange={(open) => {
          setAddModalOpen(open);
          if (!open) {
            setEditingName(null);
            setFormData(blankForm());
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>{editingName ? t("editTitle") : t("addTitle")}</DialogTitle>
              <DialogDescription>{t("addHint")}</DialogDescription>
            </DialogHeader>
            <KindFields form={formData} setForm={setFormData} nameLocked={Boolean(editingName)} passwordOptional={Boolean(editingName)} />
            <DialogFooter className="mt-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="w-full sm:w-auto">
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={formPending || !formData.name.trim()}
                className="w-full sm:w-auto sm:min-w-[130px]"
              >
                {editingName ? t("saveChanges") : t("add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmItem !== null} onOpenChange={(open) => !open && setDeleteConfirmItem(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteBody", { name: deleteConfirmItem ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirmItem(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => deleteConfirmItem && handleDelete(deleteConfirmItem)}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleImport}>
            <DialogHeader>
              <DialogTitle>{t("importTitle")}</DialogTitle>
              <DialogDescription>{t("importHint")}</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <textarea
                required
                rows={8}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"# Example\nOPENAI_API_KEY=sk-...\nOVH_SSH=..."}
                className={fieldClass("p-3 text-xs")}
              />
            </div>
            <DialogFooter className="mt-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setImportModalOpen(false)} className="w-full sm:w-auto">
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={importPending || !importText.trim()}
                className="w-full sm:w-auto sm:min-w-[140px]"
              >
                {importPending ? t("importing") : t("importAction")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LockSettingsDialog open={lockSettingsOpen} onOpenChange={setLockSettingsOpen} />

      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("exportTitle")}</DialogTitle>
            <DialogDescription>{t("exportHint")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <textarea readOnly rows={8} value={exportContent} className={fieldClass("bg-muted p-3 text-xs")} />
          </div>
          <DialogFooter className="mt-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setExportModalOpen(false)} className="w-full sm:w-auto">
              {t("close")}
            </Button>
            <Button
              type="button"
              onClick={() => copyToClipboard(exportContent, "export")}
              className="w-full sm:w-auto sm:min-w-[170px]"
            >
              <Icon name={copiedKey === "export" ? "Check" : "Copy"} className="mr-1.5 size-4" />
              {copiedKey === "export" ? t("copied") : t("copyClipboard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const OUTCOME_LABEL: Record<string, "journalIssued" | "journalSaved" | "journalDeleted" | "journalDenied" | "journalTimeout" | "journalCancelled"> = {
  issued: "journalIssued",
  saved: "journalSaved",
  deleted: "journalDeleted",
  denied: "journalDenied",
  timeout: "journalTimeout",
  cancelled: "journalCancelled",
};

// «Журнал выдачи»: who read, saved or deleted what, from which thread and when. Never the value.
function JournalSection() {
  const rpc = useCatalogRpc();
  const [journal, setJournal] = useState<
    Array<{ id: number; at: string; name: string; outcome: string; via: string | null; threadId: string | null; threadTitle: string | null; projectName: string | null; purpose: string | null }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    rpc
      .call("journal_list", { limit: 50, name: null })
      .then((log) => {
        setJournal(log.entries);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(ENV_CATALOG_CHANGED, refetch);

  return (
    <section className="mt-10 space-y-3" aria-label={t("journalTitle")}>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{t("journalTitle")}</h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t("journalHint")}</p>
      </div>
      {error ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {journal.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("journalNone")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-xs">
          {journal.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-1.5">
              <span className="text-muted-foreground">{new Date(j.at).toLocaleString()}</span>
              <span className="font-mono font-medium">{j.name}</span>
              <span>{t(OUTCOME_LABEL[j.outcome] ?? "journalIssued")}</span>
              <span className="text-muted-foreground">
                {[j.via, j.threadTitle ?? j.threadId, j.projectName].filter(Boolean).join(" · ")}
              </span>
              {j.purpose ? <span className="text-muted-foreground">{j.purpose}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EnvCatalogRequestInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => envRequestPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [forms, setForms] = useState<Record<string, SecretFormData>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!parsed.success) return;
    const next: Record<string, SecretFormData> = {};
    for (const field of parsed.data.fields) {
      const kind = field.kind ?? "secret";
      next[field.name] = { ...blankForm(kind), name: field.name, service: field.service ?? "", description: field.description ?? "" };
    }
    setForms(next);
  }, [parsed]);

  if (!parsed.success) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm font-medium text-destructive">{t("requestInvalid")}</p>
        <Button variant="outline" size="sm" onClick={() => void cancel().catch(() => undefined)}>
          {t("dismiss")}
        </Button>
      </div>
    );
  }

  const payload = parsed.data;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const entries = [];
    for (const field of payload.fields) {
      const form = forms[field.name];
      if (!form) {
        setFormError(t("requestNeedValue", { name: field.name }));
        return;
      }
      const kind = form.kind;
      if (kind === "secret") {
        const val = form.value.trim();
        if (!val) {
          setFormError(t("requestNeedValue", { name: field.name }));
          return;
        }
        if (new TextEncoder().encode(val).length > MAX_SECRET_BYTES) {
          setFormError(t("requestTooBig", { name: field.name }));
          return;
        }
        entries.push({ name: field.name, kind, value: val, service: form.service || null, description: form.description || null });
      } else {
        entries.push({
          name: field.name,
          kind,
          access: (accessFromForm(form) ?? undefined) as {
            protocol?: "ftp" | "ftps" | "sftp";
            host?: string;
            port?: number;
            username?: string;
            password?: string;
            privateKey?: string;
            passphrase?: string;
            fingerprint?: string;
            root?: string;
            url?: string;
          },
          service: form.service || null,
          description: form.description || null,
        });
      }
    }
    const validated = envRequestResponseSchema.safeParse({ entries });
    if (!validated.success) {
      setFormError(t("requestInvalidValues"));
      return;
    }
    setBusy(true);
    try {
      await submit(validated.data);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-xs" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded bg-primary/10 text-primary">
            <Icon name="Zap" className="size-3.5" />
          </div>
          <h3 className="text-sm font-semibold">{interaction.title || t("requestTitle")}</h3>
        </div>
        {payload.purpose ? <p className="text-pretty text-xs leading-relaxed">{payload.purpose}</p> : null}
        <p className="text-[11px] text-muted-foreground">{t("requestAes")}</p>
      </div>
      {payload.fields.map((field) => {
        const form = forms[field.name] ?? blankForm(field.kind ?? "secret");
        return (
          <div key={field.name} className="rounded-md border border-border/70 px-3">
            <KindFields
              form={form}
              nameLocked
              setForm={(next) => setForms((prev) => ({ ...prev, [field.name]: { ...next, name: field.name } }))}
            />
          </div>
        );
      })}
      {formError ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {formError}
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-end">
        <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" disabled={busy} onClick={() => void cancel()}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="sm" className="w-full sm:w-auto" disabled={busy}>
          {busy ? <Icon name="Spinner" className="mr-1.5 size-3.5 animate-spin" /> : <Icon name="Check" className="mr-1.5 size-3.5" />}
          {t("saveCatalog")}
        </Button>
      </div>
    </form>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "env-catalog",
    title: t("title"),
    icon: "Lock",
    path: "env-catalog",
    component: EnvCatalogNavPage,
  });

  app.slots.pendingInteraction({
    id: ENV_REQUEST_RENDERER_ID,
    component: EnvCatalogRequestInteraction,
  });
});
