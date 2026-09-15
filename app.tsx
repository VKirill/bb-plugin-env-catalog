import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, EnvSummary } from "./server";
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
      .call("env_list", { query: searchQuery.trim() ? searchQuery.trim() : null })
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

  return {
    rpc,
    variables,
    searchQuery,
    setSearchQuery,
    error,
    loading,
    refetch,
    report,
  };
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

interface SecretFormData {
  name: string;
  value: string;
  service: string;
  description: string;
}

function EnvCatalogPage() {
  const {
    rpc,
    variables,
    searchQuery,
    setSearchQuery,
    error,
    loading,
    refetch,
    report,
  } = useEnvCatalog();

  // Dialog states
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SecretFormData | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportContent, setExportContent] = useState("");

  // Revealed plain values: Map of name -> plain string
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingNames, setRevealingNames] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Form inputs for Add / Edit
  const [formData, setFormData] = useState<SecretFormData>({
    name: "",
    value: "",
    service: "",
    description: "",
  });
  const [formPending, setFormPending] = useState(false);

  // Import form state
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
    setEditingItem(null);
    setFormData({ name: "", value: "", service: "", description: "" });
    setAddModalOpen(true);
  };

  const openEditModal = async (name: string) => {
    try {
      const full = await rpc.call("env_get_value", { name });
      setEditingItem({
        name: full.name,
        value: full.value,
        service: full.service ?? "",
        description: full.description ?? "",
      });
      setFormData({
        name: full.name,
        value: full.value,
        service: full.service ?? "",
        description: full.description ?? "",
      });
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
      await rpc.call("env_save", {
        name: formData.name.trim(),
        value: formData.value,
        service: formData.service.trim() || undefined,
        description: formData.description.trim() || undefined,
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
    if (revealed[name]) {
      // Hide
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
      setRevealed((prev) => ({ ...prev, [name]: full.value }));
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
    } catch (err) {
      report("Failed to copy to clipboard");
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

  const filtered = useMemo(() => variables ?? [], [variables]);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto box-border w-full max-w-5xl px-4 pb-12 pt-6 md:px-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">Env Catalog</h1>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {filtered.length} {filtered.length === 1 ? "secret" : "secrets"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Encrypted API keys and secrets. Synchronized across all BB sessions and machines.
            </p>
          </div>

          {/* Right-aligned action buttons cluster */}
          <div className="flex flex-col gap-2 w-full sm:w-[360px] shrink-0 sm:ml-auto">
            {/* Row 1: The three secondary actions */}
            <div className="grid grid-cols-3 gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                onClick={handleImportMachineEnv}
                disabled={importingMachineEnv}
                aria-label="Import from BB Machine Environment"
                className="w-full h-9 px-2 text-xs font-normal"
              >
                <Icon name="FolderSync" className="mr-1 size-3.5 shrink-0" />
                <span className="truncate">{importingMachineEnv ? "Syncing…" : "Sync Env"}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("env")}
                aria-label="Export as .env format"
                className="w-full h-9 px-2 text-xs font-normal"
              >
                <Icon name="Download" className="mr-1 size-3.5 shrink-0" />
                <span>Export</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportModalOpen(true)}
                aria-label="Import .env or JSON"
                className="w-full h-9 px-2 text-xs font-normal"
              >
                <Icon name="FolderExport" className="mr-1 size-3.5 shrink-0" />
                <span>Import</span>
              </Button>
            </div>

            {/* Row 2: Add Secret button spanning the full width of the three buttons */}
            <Button
              size="default"
              onClick={openAddModal}
              className="w-full h-9 font-medium shadow-xs"
            >
              <Icon name="Plus" className="mr-1.5 size-4" />
              Add Secret
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mt-6 flex items-center gap-3">
          <div className="relative flex-1">
            <Icon
              name="Search"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by variable name, service, or description..."
              className="h-10 pl-9"
            />
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {/* Secret List */}
        <div className="mt-6">
          {loading && variables === null ? (
            <EmptyState>Loading secrets from Env Catalog…</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState>
              {searchQuery ? (
                <>No secrets match &ldquo;{searchQuery}&rdquo;.</>
              ) : (
                <>
                  No secrets stored yet. Click <strong>Add Secret</strong> above or ask BB
                  in chat to save an API key with <code>env_set</code>.
                </>
              )}
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
              {/* Desktop Table Header */}
              <div className="hidden md:grid md:grid-cols-[220px_1fr_260px_72px] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div>Variable</div>
                <div>Description / Service</div>
                <div>Value</div>
                <div className="text-right">Actions</div>
              </div>

              <ul className="divide-y divide-border">
                {filtered.map((item) => {
                  const isRevealed = Boolean(revealed[item.name]);
                  const displayValue = isRevealed
                    ? revealed[item.name]
                    : item.maskedValue;
                  const isRevealing = Boolean(revealingNames[item.name]);

                  return (
                    <li
                      key={item.name}
                      className="px-4 py-3 transition-colors hover:bg-muted/20 md:grid md:grid-cols-[220px_1fr_260px_72px] md:items-center md:gap-4"
                    >
                      {/* Column 1: Key name & service */}
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-semibold text-foreground truncate" title={item.name}>
                          {item.name}
                        </div>
                        {item.service && (
                          <div className="mt-1">
                            <span className="inline-block rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                              {item.service}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Column 2: Description */}
                      <div className="mt-1.5 md:mt-0 min-w-0">
                        {item.description ? (
                          <p className="text-xs text-muted-foreground line-clamp-2" title={item.description}>
                            {item.description}
                          </p>
                        ) : (
                          <span className="text-xs italic text-muted-foreground/50">
                            No description
                          </span>
                        )}
                      </div>

                      {/* Column 3: Stretched Value Container */}
                      <div className="mt-2 md:mt-0 flex items-center justify-between gap-1.5 rounded-md border border-input bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate",
                            isRevealed
                              ? "font-medium text-foreground select-all"
                              : "text-muted-foreground tracking-widest"
                          )}
                        >
                          {displayValue || "••••••••"}
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground"
                            onClick={() => toggleReveal(item.name)}
                            disabled={isRevealing}
                            aria-label={isRevealed ? "Hide secret" : "Reveal secret"}
                          >
                            <Icon
                              name={isRevealed ? "EyeOff" : "Eye"}
                              className="size-3.5"
                            />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "size-7 transition-colors",
                              copiedKey === item.name
                                ? "text-emerald-500 hover:text-emerald-600"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            onClick={async () => {
                              if (isRevealed) {
                                copyToClipboard(revealed[item.name], item.name);
                              } else {
                                try {
                                  const full = await rpc.call("env_get_value", {
                                    name: item.name,
                                  });
                                  copyToClipboard(full.value, item.name);
                                } catch (err) {
                                  report(err);
                                }
                              }
                            }}
                            aria-label="Copy value"
                          >
                            <Icon
                              name={copiedKey === item.name ? "Check" : "Copy"}
                              className="size-3.5"
                            />
                          </Button>
                        </div>
                      </div>

                      {/* Column 4: Actions */}
                      <div className="mt-2 md:mt-0 flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditModal(item.name)}
                          aria-label="Edit secret"
                        >
                          <Icon name="Edit" className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteConfirmItem(item.name)}
                          aria-label="Delete secret"
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
        </div>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>
                {editingItem ? "Edit Secret" : "Add Secret"}
              </DialogTitle>
              <DialogDescription>
                Secrets are encrypted with AES-256-GCM and stored securely on the BB server.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  Variable Name *
                </label>
                <Input
                  required
                  placeholder="e.g. OPENAI_API_KEY"
                  value={formData.name}
                  disabled={Boolean(editingItem)}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="font-mono text-sm uppercase"
                />
              </div>

              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  Secret Value *
                </label>
                <Input
                  required
                  type="password"
                  placeholder="Paste key, token, or connection string"
                  value={formData.value}
                  onChange={(e) =>
                    setFormData({ ...formData, value: e.target.value })
                  }
                  className="font-mono text-sm"
                />
              </div>

              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  Service / Provider (optional)
                </label>
                <Input
                  placeholder="e.g. OpenAI, Stripe, Tavily, Supabase"
                  value={formData.service}
                  onChange={(e) =>
                    setFormData({ ...formData, service: e.target.value })
                  }
                />
              </div>

              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-foreground">
                  Description (optional)
                </label>
                <Input
                  placeholder="Short note about purpose or usage"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </div>
            </div>

            <DialogFooter className="mt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddModalOpen(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={formPending || !formData.name.trim()}
                className="w-full sm:w-auto sm:min-w-[130px]"
              >
                {editingItem ? "Save Changes" : "Add Secret"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmItem !== null}
        onOpenChange={(open) => !open && setDeleteConfirmItem(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Secret</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong className="font-mono text-foreground">
                {deleteConfirmItem}
              </strong>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmItem(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmItem && handleDelete(deleteConfirmItem)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Modal */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleImport}>
            <DialogHeader>
              <DialogTitle>Import Secrets</DialogTitle>
              <DialogDescription>
                Paste lines in standard <code>.env</code> format (e.g. <code>KEY=value</code>)
                or a JSON export array. Comments starting with <code>#</code> will be saved as descriptions.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <textarea
                required
                rows={8}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"# Example\nOPENAI_API_KEY=sk-...\nTAVILY_API_KEY=tvly-..."}
                className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <DialogFooter className="mt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setImportModalOpen(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={importPending || !importText.trim()}
                className="w-full sm:w-auto sm:min-w-[140px]"
              >
                {importPending ? "Importing…" : "Import Secrets"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Export Modal */}
      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Exported Secrets</DialogTitle>
            <DialogDescription>
              Copy this <code>.env</code> file content to your clipboard or save it to your local project.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <textarea
              readOnly
              rows={8}
              value={exportContent}
              className="w-full rounded-md border border-input bg-muted p-3 font-mono text-xs text-foreground focus:outline-none"
            />
          </div>

          <DialogFooter className="mt-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setExportModalOpen(false)}
              className="w-full sm:w-auto"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => copyToClipboard(exportContent, "export")}
              className="w-full sm:w-auto sm:min-w-[170px]"
            >
              <Icon
                name={copiedKey === "export" ? "Check" : "Copy"}
                className="mr-1.5 size-4"
              />
              {copiedKey === "export" ? "Copied!" : "Copy to Clipboard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "env-catalog",
    title: "Env Catalog",
    icon: "Lock",
    path: "env-catalog",
    component: EnvCatalogPage,
  });
});
