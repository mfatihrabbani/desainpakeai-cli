import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCliRequestHeaders } from "../src/client-metadata.js";
import { findProjectLink, linkedProjectIdFor, PROJECT_LINK_PATH, writeProjectLink } from "../src/project-link.js";

const projectId = "7d5a3c3e-8f9b-4a51-9d26-2b6a3c1f0e11";

async function withFolder(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "dpai-project-link-"));
  const previous = process.env.DPAI_PROJECT;
  delete process.env.DPAI_PROJECT;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.DPAI_PROJECT;
    else process.env.DPAI_PROJECT = previous;
    await rm(root, { force: true, recursive: true });
  }
}

test("a link written in a folder is found from any subfolder", async () => {
  await withFolder(async (root) => {
    const path = await writeProjectLink({ apiUrl: "https://desainpakeai.com/", project: { id: projectId, name: "Toko Kopi" } }, root);
    assert.equal(path, join(root, PROJECT_LINK_PATH));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      apiUrl: "https://desainpakeai.com",
      project: { id: projectId, name: "Toko Kopi" },
      version: 1,
    });
    const nested = join(root, "src", "components");
    await mkdir(nested, { recursive: true });
    assert.equal(findProjectLink(nested)?.path, path);
    assert.equal(linkedProjectIdFor("https://desainpakeai.com", nested), projectId);
  });
});

test("a link for another server is ignored, and DPAI_PROJECT overrides the file", async () => {
  await withFolder(async (root) => {
    await writeProjectLink({ apiUrl: "https://desainpakeai.com", project: { id: projectId, name: "Toko Kopi" } }, root);
    assert.equal(linkedProjectIdFor("http://localhost:3011", root), undefined);
    process.env.DPAI_PROJECT = "11111111-2222-4333-8444-555555555555";
    assert.equal(linkedProjectIdFor("http://localhost:3011", root), "11111111-2222-4333-8444-555555555555");
  });
});

test("an unlinked folder has no project", async () => {
  await withFolder(async (root) => {
    assert.equal(findProjectLink(root), null);
    assert.equal(linkedProjectIdFor("https://desainpakeai.com", root), undefined);
  });
});

test("a broken link file fails loudly instead of targeting the wrong design", async () => {
  await withFolder(async (root) => {
    await mkdir(join(root, ".dpai"));
    await writeFile(join(root, PROJECT_LINK_PATH), "{ not json", "utf8");
    assert.throws(() => findProjectLink(root), { code: "INVALID_PROJECT_LINK" });
  });
});

test("requests carry the project header only when a project applies", () => {
  assert.equal(createCliRequestHeaders("dpai_key", {}, { project: projectId })["X-DPAI-Project"], projectId);
  assert.equal(createCliRequestHeaders("dpai_key", {}, { project: null })["X-DPAI-Project"], undefined);
  assert.equal(createCliRequestHeaders("dpai_key")["X-DPAI-Project"], undefined);
});
