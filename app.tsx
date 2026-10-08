import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, EnvSummary } from "./server";
import {
  ENV_GRANT_RENDERER_ID,
  ENV_REQUEST_RENDERER_ID,
  envGrantPayloadSchema,
  envRequestPayloadSchema,
  envRequestResponseSchema,
  type EnvGrantDecision,
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

function useEnvCatalog() {
  const rpc = useRpc<typeof rpcContract>();
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
  const [importingMachineEnv, setImportingMachineEnv] = useState(false);

  const handleImportMachineEnv = async () => {
    setImportingMachineEnv(true);
    try {
      await rpc.call("env_import_machine_env", null);
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setImportingMachineEnv(false);
    }
  };

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
            <div className="grid w-full grid-cols-3 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportMachineEnv}
                disabled={importingMachineEnv}
                aria-label={t("syncEnv")}
                className="h-9 w-full px-2 text-xs font-normal"
              >
                <Icon name="FolderSync" className="mr-1 size-3.5 shrink-0" />
                <span className="truncate">{importingMachineEnv ? t("syncing") : t("syncEnv")}</span>
              </Button>
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
          <GrantsSection />
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

interface GrantListResult {
  grants: Array<{ id: string; name: string; scope: "thread" | "project"; scopeId: string; label: string | null; grantedAt: string }>;
  pending: Array<{ id: string; name: string; threadId: string; threadTitle: string | null; projectName: string | null; purpose: string | null; createdAt: string }>;
}

const OUTCOME_LABEL = {
  issued: "journalIssued",
  denied: "journalDenied",
  timeout: "journalTimeout",
  cancelled: "journalCancelled",
} as const;

function GrantButtons({
  busy,
  hasProject,
  onPick,
}: {
  busy: boolean;
  hasProject: boolean;
  onPick: (decision: EnvGrantDecision) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
      <Button type="button" size="sm" disabled={busy} onClick={() => onPick("once")}>
        {t("grantOnce")}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !hasProject} onClick={() => onPick("project")}>
        {t("grantProject")}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onPick("thread")}>
        {t("grantThread")}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onPick("deny")}>
        {t("grantDeny")}
      </Button>
    </div>
  );
}

// The owner's access view: pending questions (a fallback when the form is out of sight),
// standing grants with revoke, and the issuance journal. Owner-only RPCs: when core refuses
// the caller the error is shown instead of the lists.
function GrantsSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<GrantListResult | null>(null);
  const [journal, setJournal] = useState<Array<{ id: number; at: string; name: string; outcome: keyof typeof OUTCOME_LABEL; via: string | null; grantKind: string | null; threadId: string | null; threadTitle: string | null; projectName: string | null; purpose: string | null; caller: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addName, setAddName] = useState("");
  const [addScope, setAddScope] = useState<"thread" | "project">("project");
  const [addScopeId, setAddScopeId] = useState("");

  const refetch = useCallback(() => {
    Promise.all([rpc.call("grant_list", null), rpc.call("journal_list", { limit: 50, name: null })])
      .then(([list, log]) => {
        setData(list);
        setJournal(log.entries as never);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime(ENV_CATALOG_CHANGED, refetch);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 space-y-5" aria-label={t("grantsTitle")}>
      <div>
        <h2 className="text-base font-semibold tracking-tight">{t("grantsTitle")}</h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{t("grantsHint")}</p>
      </div>
      {error ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {data && data.pending.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("grantPendingTitle")}</h3>
          {data.pending.map((p) => (
            <div key={p.id} className="space-y-2 rounded-md border border-border px-3 py-2">
              <div className="text-sm">
                <span className="font-mono font-medium">{p.name}</span> → {p.threadTitle ?? p.threadId}
                {p.projectName ? <span className="text-muted-foreground"> ({p.projectName})</span> : null}
              </div>
              {p.purpose ? <div className="text-xs text-muted-foreground">{p.purpose}</div> : null}
              <GrantButtons
                busy={busy}
                hasProject
                onPick={(decision) => void run(() => rpc.call("grant_decide", { requestId: p.id, decision }))}
              />
            </div>
          ))}
        </div>
      ) : null}

      {data && data.grants.length === 0 ? <p className="text-xs text-muted-foreground">{t("grantsNone")}</p> : null}
      {data && data.grants.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {data.grants.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
              <span className="font-mono font-medium">{g.name}</span>
              <span className="text-xs text-muted-foreground">
                {g.scope === "project" ? t("grantScopeProject") : t("grantScopeThread")}: {g.label ?? g.scopeId}
              </span>
              <span className="text-xs text-muted-foreground">{new Date(g.grantedAt).toLocaleString()}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={busy}
                onClick={() => void run(() => rpc.call("grant_revoke", { id: g.id }))}
              >
                {t("grantRevoke")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (!addName.trim() || !addScopeId.trim()) return;
          void run(async () => {
            await rpc.call("grant_create", { name: addName.trim(), scope: addScope, scopeId: addScopeId.trim(), label: null });
            setAddName("");
            setAddScopeId("");
          });
        }}
      >
        <span className="text-xs font-medium sm:w-40">{t("grantAddTitle")}</span>
        <Input placeholder="NAME" value={addName} onChange={(e) => setAddName(e.target.value)} className="sm:max-w-[200px]" />
        <select
          value={addScope}
          onChange={(e) => setAddScope(e.target.value === "thread" ? "thread" : "project")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="project">{t("grantScopeProject")}</option>
          <option value="thread">{t("grantScopeThread")}</option>
        </select>
        <Input placeholder={t("grantAddScopeId")} value={addScopeId} onChange={(e) => setAddScopeId(e.target.value)} className="sm:max-w-[220px]" />
        <Button type="submit" size="sm" disabled={busy || !addName.trim() || !addScopeId.trim()}>
          {t("grantAddAction")}
        </Button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t("journalTitle")}</h3>
        {journal.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("journalNone")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border text-xs">
            {journal.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-1.5">
                <span className="text-muted-foreground">{new Date(j.at).toLocaleString()}</span>
                <span className="font-mono font-medium">{j.name}</span>
                <span>{t(OUTCOME_LABEL[j.outcome] ?? "journalCancelled")}</span>
                <span className="text-muted-foreground">
                  {[j.via, j.grantKind, j.threadTitle ?? j.threadId ?? j.caller, j.projectName].filter(Boolean).join(" · ")}
                </span>
                {j.purpose ? <span className="text-muted-foreground">{j.purpose}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EnvCatalogGrantInteraction({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const parsed = useMemo(() => envGrantPayloadSchema.safeParse(interaction.payload), [interaction.payload]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!parsed.success) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm font-medium text-destructive">{t("grantInvalid")}</p>
        <Button variant="outline" size="sm" onClick={() => void cancel().catch(() => undefined)}>
          {t("dismiss")}
        </Button>
      </div>
    );
  }
  const payload = parsed.data;

  // The answer is recorded by the owner-only grant_decide RPC first; the form's own submit
  // value only closes the interaction. A refused RPC (caller is not the owner) stops here.
  const pick = async (decision: EnvGrantDecision) => {
    setBusy(true);
    setFormError(null);
    try {
      await rpc.call("grant_decide", { requestId: payload.requestId, decision });
      await submit({ requestId: payload.requestId, decision });
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded bg-primary/10 text-primary">
          <Icon name="Lock" className="size-3.5" />
        </div>
        <h3 className="text-sm font-semibold">
          {t("grantFormTitle", { name: payload.name, thread: payload.threadTitle ?? payload.threadId })}
        </h3>
      </div>
      <div className="space-y-0.5 text-xs text-muted-foreground">
        {payload.projectName ? <p>{t("grantFormProject", { project: payload.projectName })}</p> : null}
        {payload.purpose ? <p className="text-foreground">{t("grantFormPurpose", { purpose: payload.purpose })}</p> : null}
        {payload.source ? <p>{t("grantFormVia", { via: payload.source })}</p> : null}
        <p>{t("grantFormNoteLabel")}</p>
      </div>
      {formError ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {formError}
        </div>
      ) : null}
      <GrantButtons busy={busy} hasProject={Boolean(payload.projectId)} onPick={(d) => void pick(d)} />
    </div>
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
    component: EnvCatalogPage,
  });

  app.slots.pendingInteraction({
    id: ENV_REQUEST_RENDERER_ID,
    component: EnvCatalogRequestInteraction,
  });

  app.slots.pendingInteraction({
    id: ENV_GRANT_RENDERER_ID,
    component: EnvCatalogGrantInteraction,
  });
});
