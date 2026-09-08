import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createWorkspaceFixture } from "./workspace-fixture.js";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(projectRoot, "src/cli.ts");

test("page create normalizes shell-safe and MSYS-converted routes", async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "dpai-cli-page-route-"));
  t.after(() => rm(workspace, { force: true, recursive: true }));
  await createWorkspaceFixture(workspace);

  await runCli([
    "page", "create",
    "--workspace", workspace,
    "--id", "activity",
    "--name", "Activity",
    "--route", "activity",
  ]);

  await runCli([
    "page", "create",
    "--workspace", workspace,
    "--id", "cal-landing",
    "--name", "Cal Landing",
    "--route", "C:/Program Files/Git/cal-landing/",
  ], {
    MINGW_PREFIX: "C:/Program Files/Git/mingw64",
    MSYSTEM: "MINGW64",
  });

  const manifest = JSON.parse(await readFile(resolve(workspace, "prototype.json"), "utf8")) as {
    pages: Array<{ id: string; route: string }>;
  };
  assert.equal(manifest.pages.find((page) => page.id === "activity")?.route, "/activity");
  assert.equal(manifest.pages.find((page) => page.id === "cal-landing")?.route, "/cal-landing/");
});

test("page create rejects a Windows path that cannot be safely recovered", async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "dpai-cli-page-route-error-"));
  t.after(() => rm(workspace, { force: true, recursive: true }));
  await createWorkspaceFixture(workspace);

  await assert.rejects(
    runCli([
      "page", "create",
      "--workspace", workspace,
      "--id", "unsafe-route",
      "--name", "Unsafe Route",
      "--route", "D:/unexpected/route",
    ]),
    (error: unknown) => {
      assert.ok(error && typeof error === "object" && "stderr" in error);
      const response = JSON.parse(String((error as { stderr: unknown }).stderr)) as {
        error: { code: string; suggestion?: string };
      };
      assert.equal(response.error.code, "WINDOWS_PATH_AS_ROUTE");
      assert.match(response.error.suggestion ?? "", /--route activity/);
      return true;
    },
  );
});

function runCli(args: string[], environment: NodeJS.ProcessEnv = {}) {
  return execFileAsync(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    maxBuffer: 1024 * 1024,
  });
}
