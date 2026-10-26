import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { executeTool } from "../src/tool-registry.js";
import { createWorkspaceFixture } from "./workspace-fixture.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(projectRoot, "src/cli.ts");

const PAGE_SOURCE = "export default function Page() {\n  return <main>Katalog • Mobil</main>;\n}\n";
const LAYOUT_SOURCE = "export default function Layout({ children }) {\n  return <div>{children}</div>;\n}\n";
const COMPONENT_SOURCE = "export default function PriceTag({ label }) {\n  return <span>{label}</span>;\n}\n";

test("registry validates module bundle inputs with the server schemas", async (t) => {
  const workspace = await mkdtemp(resolve(tmpdir(), "dpai-cli-bundle-schema-"));
  t.after(() => rm(workspace, { force: true, recursive: true }));
  await createWorkspaceFixture(workspace);
  const options = { workspaceRoot: workspace };
  const page = {
    expectedRevision: "sha256-any",
    id: "activity",
    name: "Activity",
    route: "/activity",
    source: PAGE_SOURCE,
    viewport: { height: 960, width: 1440 },
  };

  const invalidInputs: Array<[string, unknown]> = [
    ["create_page_bundle", { ...page, viewport: undefined }],
    ["create_page_bundle", { ...page, source: "" }],
    ["create_page_bundle", { ...page, route: "activity" }],
    ["create_page_bundle", { ...page, viewport: { height: 960, width: 100 } }],
    ["create_page_bundle", { ...page, extra: true }],
    ["create_layout_bundle", { expectedRevision: "sha256-any", id: "Shell", source: LAYOUT_SOURCE }],
    ["create_layout_bundle", { expectedRevision: "sha256-any", id: "shell" }],
    ["create_component_bundle", {
      expectedRevision: "sha256-any",
      id: "price-tag",
      source: COMPONENT_SOURCE,
      tag: "price-tag",
    }],
  ];
  for (const [name, input] of invalidInputs) {
    await assert.rejects(executeTool(name, input, options), ZodError, `${name} ${JSON.stringify(input)}`);
  }

  const validInputs: Array<[string, unknown]> = [
    ["create_page_bundle", { ...page, layout: "app-shell" }],
    ["create_layout_bundle", { expectedRevision: "sha256-any", id: "app-shell", source: LAYOUT_SOURCE }],
    ["create_component_bundle", {
      defaults: { label: "Rp 0" },
      expectedRevision: "sha256-any",
      id: "price-tag",
      props: { label: "string" },
      source: COMPONENT_SOURCE,
      tag: "x-price-tag",
    }],
  ];
  for (const [name, input] of validInputs) {
    await assert.rejects(executeTool(name, input, options), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "UNSUPPORTED_RUNTIME");
      return true;
    });
  }

  const context = await executeTool("get_project_context", {}, options) as { authoring?: unknown };
  assert.deepEqual(context.authoring, {
    createComponent: "create_component",
    createLayout: "create_layout",
    createPage: "create_page",
    moduleExtension: ".html",
  });
});

test("native create-bundle commands and dpai call send complete modules to the remote project", async (t) => {
  const inputDirectory = await mkdtemp(resolve(tmpdir(), "dpai-cli-bundle-input-"));
  t.after(() => rm(inputDirectory, { force: true, recursive: true }));
  const pagePath = resolve(inputDirectory, "activity.page.jsx");
  const layoutPath = resolve(inputDirectory, "app-shell.layout.jsx");
  const callPath = resolve(inputDirectory, "call.json");
  await writeFile(pagePath, `﻿${PAGE_SOURCE}`, "utf8");
  await writeFile(layoutPath, LAYOUT_SOURCE, "utf8");
  const callInput = {
    expectedRevision: "sha256-explicit",
    id: "pricing",
    name: "Pricing",
    route: "/pricing",
    source: PAGE_SOURCE,
    viewport: { height: 844, width: 390 },
  };
  await writeFile(callPath, JSON.stringify(callInput), "utf8");

  const received: Array<{ input: Record<string, unknown>; operation: string }> = [];
  const server = createServer(async (request, response) => {
    const operation = (request.url ?? "").replace("/api/cli/workspace/", "");
    const body = JSON.parse(await new Promise<string>((accept) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => accept(Buffer.concat(chunks).toString("utf8")));
    })) as { input: Record<string, unknown> };
    response.setHeader("Content-Type", "application/json");
    if (operation === "get_project_context") {
      response.end(JSON.stringify({
        authoring: {
          createComponent: "create_component_bundle",
          createLayout: "create_layout_bundle",
          createPage: "create_page_bundle",
          moduleExtension: ".jsx",
        },
        manifest: { components: [], layouts: [], pages: [], runtime: "react-jsx@1", title: "JSX" },
        revision: "sha256-remote",
      }));
      return;
    }
    if (operation === "get_design_context") {
      response.end(JSON.stringify({ revision: "sha256-remote", sections: [] }));
      return;
    }
    received.push({ input: body.input, operation });
    response.end(JSON.stringify({ id: body.input.id, revision: "sha256-next" }));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  t.after(() => new Promise<void>((accept) => server.close(() => accept())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const environment = {
    DPAI_API_KEY: "dpai_bundle_key",
    DPAI_API_URL: `http://127.0.0.1:${address.port}`,
    DPAI_WORKSPACE: "",
  };

  const context = JSON.parse((await runCli(["context"], environment)).stdout) as {
    authoring?: { createPage?: string };
    prototype: { runtime: string };
  };
  assert.equal(context.prototype.runtime, "react-jsx@1");
  assert.equal(context.authoring?.createPage, "create_page_bundle");

  await runCli([
    "page", "create-bundle",
    "--id", "activity",
    "--name", "Activity",
    "--route", "activity",
    "--layout", "app-shell",
    "--source-file", pagePath,
  ], environment);
  await runCli([
    "page", "create-bundle",
    "--id", "mobile",
    "--name", "Mobile",
    "--route", "/mobile",
    "--width", "390",
    "--height", "844",
    "--source-file", "-",
  ], environment, `﻿${PAGE_SOURCE}`);
  await runCli([
    "layout", "create-bundle",
    "--id", "app-shell",
    "--source-file", layoutPath,
  ], environment);
  await runCli([
    "component", "create-bundle",
    "--id", "price-tag",
    "--tag", "x-price-tag",
    "--prop", "label=string",
    "--default", "label=Rp 0",
  ], environment, COMPONENT_SOURCE);
  await runCli(["call", "create_page_bundle", "--input", `@${callPath}`], environment);

  assert.deepEqual(received, [
    {
      input: {
        expectedRevision: "sha256-remote",
        id: "activity",
        layout: "app-shell",
        name: "Activity",
        route: "/activity",
        source: PAGE_SOURCE,
        viewport: { height: 960, width: 1440 },
      },
      operation: "create_page_bundle",
    },
    {
      input: {
        expectedRevision: "sha256-remote",
        id: "mobile",
        name: "Mobile",
        route: "/mobile",
        source: PAGE_SOURCE,
        viewport: { height: 844, width: 390 },
      },
      operation: "create_page_bundle",
    },
    {
      input: { expectedRevision: "sha256-remote", id: "app-shell", source: LAYOUT_SOURCE },
      operation: "create_layout_bundle",
    },
    {
      input: {
        defaults: { label: "Rp 0" },
        expectedRevision: "sha256-remote",
        id: "price-tag",
        props: { label: "string" },
        source: COMPONENT_SOURCE,
        tag: "x-price-tag",
      },
      operation: "create_component_bundle",
    },
    { input: callInput, operation: "create_page_bundle" },
  ]);

  await assert.rejects(
    runCli(["layout", "create-bundle", "--id", "empty"], environment, ""),
    (error: unknown) => {
      const response = JSON.parse((error as { stderr: string }).stderr) as { error: { code: string } };
      assert.equal(response.error.code, "SOURCE_REQUIRED");
      return true;
    },
  );
  await assert.rejects(
    runCli(["page", "create-bundle", "--id", "nameless", "--source-file", pagePath], environment),
    (error: unknown) => {
      const response = JSON.parse((error as { stderr: string }).stderr) as { error: { code: string } };
      assert.equal(response.error.code, "PAGE_FIELDS_REQUIRED");
      return true;
    },
  );
});

// Always closes stdin so commands that may read it never wait on an open pipe.
function runCli(args: string[], environment: NodeJS.ProcessEnv, stdin = "") {
  return new Promise<{ stderr: string; stdout: string }>((accept, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...environment },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) accept({ stderr, stdout });
      else reject(Object.assign(new Error(`dpai exited with ${code}`), { stderr, stdout }));
    });
    child.stdin.end(stdin, "utf8");
  });
}
