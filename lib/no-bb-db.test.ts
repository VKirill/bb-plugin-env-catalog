// BB's database belongs to BB: a second SQLite build inside the server process
// (this repo's better-sqlite3 next to the server's own) can drop the server's
// file locks on bb.db and corrupt it. The plugin keeps its data in
// bb.storage.database() and reaches BB only through bb.sdk.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("runtime code never opens BB's database or loads its own SQLite", () => {
  const root = resolve(import.meta.dirname, "..");
  const files = [
    ...readdirSync(root).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")),
    ...readdirSync(join(root, "lib"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => `lib/${f}`),
  ];
  // `import type` is erased at build time and stays allowed.
  const opensBbDb =
    /^\s*import\s+(?!type\b)[^;]*from\s+["'](?:better-sqlite3|node:sqlite)["']|DatabaseSync|["'`]bb\.db["'`]/m;
  const bad = files.filter((file) => opensBbDb.test(readFileSync(join(root, file), "utf8")));
  assert.deepEqual(bad, []);
});
