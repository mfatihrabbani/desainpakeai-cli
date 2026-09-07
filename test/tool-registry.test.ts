import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { authStatus, currentProject, login, logout } from "../src/auth-client.js";
import { shapeDesignContext } from "../src/output-shaping.js";
import { executeRemoteTool } from "../src/remote-workspace-client.js";
import { executeTool, TOOL_NAMES } from "../src/tool-registry.js";
import { createWorkspaceFixture } from "./workspace-fixture.js";

const execFileAsync = promisify(execFile);

test("exposes every MCP workspace operation", () => {
  assert.deepEqual(TOOL_NAMES, [
    "get_project_context",
    "get_review",
    "get_guide",
    "get_design_context",
    "lint_design",
    "get_tokens",
    "create_tokens",
    "set_tokens",
    "set_design_section",
    "update_design_system",
    "get_page_states",
    "list_files",
    "grep",
    "read_file",
    "write_file",
    "edit_file",
    "create_page",
    "create_layout",
    "set_page_layout",
    "create_component",
    "verify_preview",
    "finish_working_on_pages",
    "export_prototype",
  ]);
});

test("returns bundled on-demand authoring guides for explicit local work", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "dpai-cli-guide-"));
  await createWorkspaceFixture(root);
  const result = await executeTool("get_guide", {
    topic: "prototype-authoring",
  }, { workspaceRoot: root });
  assert.equal(typeof result, "string");
  assert.match(String(result), /dependency-free HTML, CSS, and JavaScript/i);

  const cli = await execFileAsync(process.execPath, [
    "--import",
    "tsx",
    resolve("src/cli.ts"),
    "guide",
    "get",
    "--topic",
    "design-quality",
    "--workspace",
    root,
    "--raw",
  ], {
    cwd: resolve("."),
    env: {
      ...process.env,
      DPAI_API_KEY: "",
      DPAI_API_URL: "",
      DPAI_WORKSPACE: "",
    },
  });
  assert.match(cli.stdout, /DesainPakeAI design quality/);
});

test("pulls the current guide from the remote application", async () => {
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer dpai_remote_guide");
    assert.equal(request.url, "/api/cli/workspace/get_guide");
    const body = JSON.parse(await new Promise<string>((accept) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => accept(Buffer.concat(chunks).toString("utf8")));
    })) as { input: unknown };
    assert.deepEqual(body.input, { topic: "prototype-authoring" });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify("# Current remote authoring guide"));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const cli = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      resolve("src/cli.ts"),
      "guide",
      "get",
      "--topic",
      "prototype-authoring",
      "--raw",
    ], {
      cwd: resolve("."),
      env: {
        ...process.env,
        DPAI_API_KEY: "dpai_remote_guide",
        DPAI_API_URL: `http://127.0.0.1:${address.port}`,
        DPAI_WORKSPACE: "",
      },
    });
    assert.equal(cli.stdout.trim(), "# Current remote authoring guide");
  } finally {
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  }
});

test("falls back to the bundled guide when an older app lacks the guide operation", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      error: {
        code: "UNKNOWN_CLI_OPERATION",
        message: "Unknown CLI workspace operation: get_guide",
      },
    }));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const guide = await executeRemoteTool("get_guide", {
      topic: "prototype-authoring",
    }, {
      apiKey: "dpai_legacy_app",
      apiUrl: `http://127.0.0.1:${address.port}`,
    });
    assert.match(String(guide), /dependency-free HTML, CSS, and JavaScript/i);
  } finally {
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  }
});

test("paginates requested design sections with an MCP-compatible cursor", () => {
  const context = {
    name: "Cursor system",
    revision: "sha256-cursor",
    sections: [{ heading: "Principles", content: "x".repeat(6_050) }],
  };
  const first = shapeDesignContext(context, { sections: ["Principles"] }) as {
    nextCursor: string;
    sections: Array<{ complete: boolean; returnedChars: number }>;
  };
  assert.equal(first.sections[0]?.complete, false);
  assert.equal(first.sections[0]?.returnedChars, 6_000);
  assert.ok(first.nextCursor);

  const second = shapeDesignContext(context, { cursor: first.nextCursor }) as {
    nextCursor: null;
    sections: Array<{ complete: boolean; returnedChars: number }>;
  };
  assert.equal(second.sections[0]?.complete, true);
  assert.equal(second.sections[0]?.returnedChars, 50);
  assert.equal(second.nextCursor, null);
});

test("runs create, edit, verify, finish, and export without MCP", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "dpai-cli-"));
  await createWorkspaceFixture(root);
  const options = { workspaceRoot: root };

  const initial = await executeTool("get_project_context", {}, options) as {
    revision: string;
  };
  const created = await executeTool("create_page", {
    expectedRevision: initial.revision,
    id: "reports",
    name: "Reports",
    route: "/reports",
  }, options) as { revision: string };

  const edited = await executeTool("edit_file", {
    edits: [{
      operation: "insert_before",
      anchor: "<!-- agent:page-sections -->",
      content: "<section data-node-id=\"reports.summary\"><h2>Summary</h2></section>\n    ",
    }],
    expectedRevision: created.revision,
    path: "src/pages/reports.page.html",
  }, options) as { revision: string };

  const verification = await executeTool("verify_preview", { pageId: "reports" }, options) as {
    pageCount: number;
    workingPageIds: string[];
  };
  assert.equal(verification.pageCount, 2);
  assert.deepEqual(verification.workingPageIds, ["reports"]);

  const finished = await executeTool("finish_working_on_pages", {
    pageIds: ["reports"],
  }, options) as { finishedPageIds: string[] };
  assert.deepEqual(finished.finishedPageIds, ["reports"]);

  const exported = await executeTool("export_prototype", {
    expectedRevision: edited.revision,
  }, options) as { outputPath: string; pageCount: number };
  assert.equal(exported.pageCount, 2);
  assert.match(await readFile(exported.outputPath, "utf8"), /Summary/);
});

test("preserves the revision guard", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "dpai-cli-revision-"));
  await createWorkspaceFixture(root);
  await assert.rejects(
    executeTool("create_layout", {
      expectedRevision: "sha256-stale",
      id: "app-shell",
    }, { workspaceRoot: root }),
    (error) => (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "REVISION_CONFLICT"
    ),
  );
});

test("downloads a visual review through ordinary HTTP", async () => {
  const projectId = randomUUID();
  const reviewId = randomUUID();
  const root = await mkdtemp(resolve(tmpdir(), "dpai-cli-review-"));
  const imagePath = resolve(root, "review.png");
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer dpai_test_key");
    if (!request.url?.endsWith("/image")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        commentCount: 1,
        comments: [{ kind: "rectangle", note: "Increase contrast", number: 1 }],
        createdAt: "2026-08-31T00:00:00.000Z",
        page: { id: "home", name: "Home", route: "/", viewportWidth: 1440 },
        project: { id: projectId, name: "Test project", role: "owner" },
        reviewId,
        revision: "sha256-review",
      }));
      return;
    }
    response.setHeader("Content-Type", "image/png");
    response.end(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await executeTool("get_review", {
      output: imagePath,
      reviewId,
    }, {
      apiUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "dpai_test_key",
      workspaceRoot: root,
    }) as { comments: Array<{ kind: string; note: string; number: number }>; imagePath: string };
    assert.equal(result.imagePath, imagePath);
    assert.deepEqual(result.comments, [{ kind: "rectangle", note: "Increase contrast", number: 1 }]);
    assert.deepEqual(
      [...await readFile(imagePath)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
  } finally {
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  }
});

test("logs in with an MCP API key and reports the live active project", async () => {
  const apiKeyId = randomUUID();
  const projectId = randomUUID();
  const configRoot = await mkdtemp(resolve(tmpdir(), "dpai-cli-auth-"));
  const previousConfigHome = process.env.DPAI_CONFIG_HOME;
  process.env.DPAI_CONFIG_HOME = configRoot;
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/cli/session");
    assert.equal(request.headers.authorization, "Bearer dpai_same_as_mcp");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      authenticated: true,
      apiKey: { id: apiKeyId },
      project: { id: projectId, name: "Active project", role: "editor" },
    }));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const apiUrl = `http://127.0.0.1:${address.port}`;
    const loggedIn = await login({ apiKey: "dpai_same_as_mcp", apiUrl });
    assert.equal(loggedIn.authenticated, true);
    assert.equal(loggedIn.project.id, projectId);
    assert.doesNotMatch(loggedIn.apiKey.masked, /same_as_mcp/);

    const status = await authStatus();
    assert.equal(status.authenticated, true);
    assert.equal("project" in status && status.project.name, "Active project");
    assert.deepEqual(await currentProject(), {
      apiUrl,
      project: { id: projectId, name: "Active project", role: "editor" },
    });

    const loggedOut = await logout();
    assert.equal(loggedOut.removed, true);
    assert.deepEqual(await authStatus(), {
      authenticated: false,
      credentialPath: resolve(configRoot, "credentials.json"),
    });
  } finally {
    if (previousConfigHome === undefined) delete process.env.DPAI_CONFIG_HOME;
    else process.env.DPAI_CONFIG_HOME = previousConfigHome;
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  }
});

test("CLI serializes an early usage error", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      "--import",
      "tsx",
      resolve("src/cli.ts"),
      "call",
      "missing_operation",
    ], { cwd: resolve(".") }),
    (error) => {
      if (!(error instanceof Error) || !("stderr" in error)) return false;
      const payload = JSON.parse(String(error.stderr)) as { error: { code: string } };
      return payload.error.code === "UNKNOWN_TOOL";
    },
  );
});

test("CLI native flags author a page without JSON or explicit revisions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "dpai-cli-native-"));
  await createWorkspaceFixture(root);
  const cli = ["--import", "tsx", resolve("src/cli.ts")];

  const created = JSON.parse(execFileSync(process.execPath, [
    ...cli,
    "page",
    "create",
    "--workspace",
    root,
    "--id",
    "activity",
    "--name",
    "Activity log",
    "--route",
    "/activity",
    "--width",
    "1200",
    "--height",
    "800",
  ], { encoding: "utf8" })) as { page: { id: string }; revision: string };
  assert.equal(created.page.id, "activity");
  assert.match(created.revision, /^sha256-/);

  const fragment = '<section data-node-id="activity.feed"><h2>Recent activity</h2></section>\n    ';
  const edited = JSON.parse(execFileSync(process.execPath, [
    ...cli,
    "file",
    "edit",
    "--workspace",
    root,
    "--path",
    "src/pages/activity.page.html",
    "--before",
    "<!-- agent:page-sections -->",
  ], { encoding: "utf8", input: fragment })) as { revision: string };
  assert.match(edited.revision, /^sha256-/);
  assert.match(await readFile(resolve(root, "src/pages/activity.page.html"), "utf8"), /Recent activity/);

  const verified = JSON.parse(execFileSync(process.execPath, [
    ...cli,
    "preview",
    "verify",
    "--workspace",
    root,
    "--page",
    "activity",
  ], { encoding: "utf8" })) as { pageCount: number };
  assert.equal(verified.pageCount, 2);
});

test("CLI defaults to the active remote project and reads its revision automatically", async () => {
  const projectId = randomUUID();
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer dpai_remote_key");
    const path = request.url ?? "";
    requests.push(path);
    const body = request.method === "POST"
      ? JSON.parse(await new Promise<string>((accept) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        request.on("end", () => accept(Buffer.concat(chunks).toString("utf8")));
      })) as { input: Record<string, unknown> }
      : { input: {} };

    response.setHeader("Content-Type", "application/json");
    if (path === "/api/cli/workspace/get_project_context") {
      response.end(JSON.stringify({
        agentPageState: { pages: {}, schemaVersion: 1 },
        canvas: { frames: {}, hiddenPageIds: [], schemaVersion: 1 },
        manifest: {
          components: [],
          layouts: [],
          pages: [],
          runtime: "single-html@1",
          styles: [],
          title: "Remote prototype",
        },
        project: { id: projectId, name: "Remote project", role: "owner" },
        prototypeId: randomUUID(),
        revision: "sha256-remote",
      }));
      return;
    }
    if (path === "/api/cli/workspace/get_design_context") {
      response.end(JSON.stringify({
        colors: {},
        components: {},
        omitted: [],
        revision: "sha256-remote",
        sections: [],
        typography: {},
      }));
      return;
    }
    if (path === "/api/cli/workspace/create_page") {
      assert.deepEqual(body.input, {
        expectedRevision: "sha256-remote",
        id: "remote-page",
        name: "Remote page",
        route: "/remote",
      });
      response.end(JSON.stringify({
        page: { id: "remote-page" },
        revision: "sha256-next",
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await execFileAsync(process.execPath, [
      "--import",
      "tsx",
      resolve("src/cli.ts"),
      "page",
      "create",
      "--id",
      "remote-page",
      "--name",
      "Remote page",
      "--route",
      "/remote",
    ], {
      cwd: resolve("."),
      env: {
        ...process.env,
        DPAI_API_KEY: "dpai_remote_key",
        DPAI_API_URL: `http://127.0.0.1:${address.port}`,
      },
    });
    assert.equal(JSON.parse(result.stdout).page.id, "remote-page");
    assert.deepEqual(requests.sort(), [
      "/api/cli/workspace/create_page",
      "/api/cli/workspace/get_design_context",
      "/api/cli/workspace/get_project_context",
    ]);
  } finally {
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  }
});
