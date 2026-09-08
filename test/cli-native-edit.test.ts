import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createWorkspaceFixture } from "./workspace-fixture.js";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(projectRoot, "src/cli.ts");

test("native file edit and file patch preserve UTF-8 without handwritten JSON", async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "dpai-cli-native-edit-"));
  t.after(() => rm(workspace, { force: true, recursive: true }));
  await createWorkspaceFixture(workspace);

  const oldTextPath = resolve(workspace, "old.txt");
  const newTextPath = resolve(workspace, "new.txt");
  await writeFile(oldTextPath, "<h1>Home</h1>", "utf8");
  await writeFile(newTextPath, "<h1>Katalog • Mobil</h1>", "utf8");

  const first = await runCli([
    "file", "edit",
    "--workspace", workspace,
    "--path", "src/pages/home.page.html",
    "--replace-file", oldTextPath,
    "--content-file", newTextPath,
  ]);
  assert.equal(first.stderr, "");
  assert.equal(typeof JSON.parse(first.stdout).revision, "string");
  assert.match(
    await readFile(resolve(workspace, "src/pages/home.page.html"), "utf8"),
    /Katalog • Mobil/,
  );

  const patchPath = resolve(workspace, "catalog.diff");
  await writeFile(patchPath, `--- a/src/pages/home.page.html
+++ b/src/pages/home.page.html
@@ -2,3 +2,3 @@
   <main data-node-id="home">
-    <h1>Katalog • Mobil</h1>
+    <h1>Katalog Warna</h1>
     <!-- agent:page-sections -->
`, "utf8");

  const second = await runCli([
    "file", "patch",
    "--workspace", workspace,
    "--path", "src/pages/home.page.html",
    "--patch-file", patchPath,
  ]);
  assert.equal(second.stderr, "");
  assert.equal(typeof JSON.parse(second.stdout).revision, "string");
  assert.match(
    await readFile(resolve(workspace, "src/pages/home.page.html"), "utf8"),
    /<h1>Katalog Warna<\/h1>/,
  );

  const third = await runCli([
    "file", "edit",
    "--workspace", workspace,
    "--path", "src/pages/home.page.html",
    "--replace", "<h1>Katalog Warna</h1>",
    "--content", "<h1>Katalog Cerah</h1>",
  ]);
  assert.equal(third.stderr, "");
  assert.match(
    await readFile(resolve(workspace, "src/pages/home.page.html"), "utf8"),
    /<h1>Katalog Cerah<\/h1>/,
  );

  const deleteTextPath = resolve(workspace, "delete.txt");
  await writeFile(deleteTextPath, "<h1>Katalog Cerah</h1>", "utf8");
  const fourth = await runCli([
    "file", "edit",
    "--workspace", workspace,
    "--path", "src/pages/home.page.html",
    "--delete-file", deleteTextPath,
  ]);
  assert.equal(fourth.stderr, "");
  assert.doesNotMatch(
    await readFile(resolve(workspace, "src/pages/home.page.html"), "utf8"),
    /Katalog Cerah/,
  );
});

function runCli(args: string[]) {
  return execFileAsync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}
