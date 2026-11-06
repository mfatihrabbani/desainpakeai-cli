import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertExportFolder, EXPORT_MARKER, exportFilePath, safeFolderName } from "../src/remote-export.js";

async function withFolder(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "dpai-remote-export-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("export files stay inside the target folder", () => {
  const folder = join(tmpdir(), "dpai-export-target");
  assert.equal(exportFilePath(folder, "src/pages/menu.page.jsx"), join(folder, "src", "pages", "menu.page.jsx"));
  for (const unsafe of ["../outside.txt", "src/../../outside.txt", "/etc/passwd", "C:/Windows/x", "C:\\Windows\\x", "..\\outside.txt", ""]) {
    assert.throws(() => exportFilePath(folder, unsafe), { code: "INVALID_EXPORT_PATH" }, unsafe);
  }
});

test("export folder names come from the project name", () => {
  assert.equal(safeFolderName("Toko Roti React"), "toko-roti-react");
  assert.equal(safeFolderName("../../.."), "prototype-app");
});

test("export never overwrites the linked code folder or foreign files by default", async () => {
  await withFolder(async (root) => {
    // The code folder itself.
    await assert.rejects(assertExportFolder(root, root, false), { code: "EXPORT_TARGET_IS_PROJECT_FOLDER" });
    // A missing or empty folder is fine.
    await assertExportFolder(join(root, "missing"), root, false);
    const empty = join(root, "empty");
    await mkdir(empty);
    await assertExportFolder(empty, root, false);
    // A folder with someone else's files is refused unless --overwrite.
    const foreign = join(root, "foreign");
    await mkdir(foreign);
    await writeFile(join(foreign, "package.json"), "{}");
    await assert.rejects(assertExportFolder(foreign, root, false), { code: "EXPORT_TARGET_NOT_EMPTY" });
    await assertExportFolder(foreign, root, true);
    // An earlier export may be replaced.
    const earlier = join(root, "earlier");
    await mkdir(earlier);
    await writeFile(join(earlier, "package.json"), "{}");
    await writeFile(join(earlier, EXPORT_MARKER), "{}");
    await assertExportFolder(earlier, root, false);
  });
});
