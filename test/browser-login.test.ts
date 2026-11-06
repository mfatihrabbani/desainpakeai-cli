import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { browserLogin, type BrowserLoginDependencies } from "../src/browser-login.js";

const API_URL = "http://localhost:3000";
const KEY_ID = "0b6f2a4e-6a43-4c3e-9e2f-0c5c1d2e3f40";
const PROJECT = { id: "7d5a3c3e-8f9b-4a51-9d26-2b6a3c1f0e11", name: "Toko Kopi", role: "owner" };

type Reply = { status: number; body: unknown };

/** A fake server: the start call, then one scripted reply per poll, then the session check. */
function fakeServer(polls: Reply[]) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url.replace(API_URL, ""));
    if (url.endsWith("/api/cli/login")) {
      return Response.json({
        deviceCode: "dpai_login_device",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        interval: 2,
        userCode: "BCDF-GHJK",
        verificationPath: "/cli/login?code=BCDF-GHJK",
      }, { status: 201 });
    }
    if (url.endsWith("/api/cli/login/token")) {
      const reply = polls.shift() ?? { status: 200, body: { status: "pending" } };
      return Response.json(reply.body, { status: reply.status });
    }
    if (url.endsWith("/api/cli/session")) {
      return Response.json({ authenticated: true, apiKey: { id: KEY_ID }, project: PROJECT });
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function withConfigHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "dpai-login-"));
  const previous = { config: process.env.DPAI_CONFIG_HOME, url: process.env.DPAI_API_URL, fetch: globalThis.fetch };
  process.env.DPAI_CONFIG_HOME = home;
  delete process.env.DPAI_API_URL;
  try {
    await run(home);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.config === undefined) delete process.env.DPAI_CONFIG_HOME;
    else process.env.DPAI_CONFIG_HOME = previous.config;
    if (previous.url !== undefined) process.env.DPAI_API_URL = previous.url;
    await rm(home, { force: true, recursive: true });
  }
}

function dependencies(fetchImpl: typeof fetch, opened: string[]): BrowserLoginDependencies {
  let clock = Date.now();
  return {
    fetch: fetchImpl,
    log: () => undefined,
    now: () => clock,
    openUrl: async (url) => {
      opened.push(url);
      return true;
    },
    sleep: async (ms) => {
      clock += ms;
    },
  };
}

test("browser login opens the approval page, waits, and stores the minted key", async () => {
  await withConfigHome(async (home) => {
    const server = fakeServer([
      { status: 200, body: { status: "pending" } },
      { status: 200, body: { status: "approved", apiKey: "dpai_minted", apiKeyId: KEY_ID, canvasPath: `/project/${PROJECT.id}/prototype`, project: PROJECT } },
    ]);
    globalThis.fetch = server.fetchImpl;
    const opened: string[] = [];
    const result = await browserLogin({ apiUrl: API_URL }, dependencies(server.fetchImpl, opened));

    assert.deepEqual(opened, [`${API_URL}/cli/login?code=BCDF-GHJK`]);
    assert.equal(result.canvasUrl, `${API_URL}/project/${PROJECT.id}/prototype`);
    assert.deepEqual(result.project, PROJECT);
    assert.equal(result.apiKey.masked.includes("minted"), false);
    const stored = JSON.parse(await readFile(join(home, "credentials.json"), "utf8"));
    assert.equal(stored.apiKey, "dpai_minted");
    assert.equal(stored.apiUrl, API_URL);
    await assert.rejects(stat(join(home, "login-pending.json")));
  });
});

test("a wait that runs out keeps the code, and a rerun resumes it without a new browser tab", async () => {
  await withConfigHome(async () => {
    const server = fakeServer([]);
    globalThis.fetch = server.fetchImpl;
    const opened: string[] = [];
    await assert.rejects(
      browserLogin({ apiUrl: API_URL, waitSeconds: 5 }, dependencies(server.fetchImpl, opened)),
      { code: "LOGIN_PENDING" },
    );
    assert.equal(opened.length, 1);

    const resumed = fakeServer([
      { status: 200, body: { status: "approved", apiKey: "dpai_minted", apiKeyId: KEY_ID, canvasPath: `/project/${PROJECT.id}/prototype`, project: PROJECT } },
    ]);
    globalThis.fetch = resumed.fetchImpl;
    const result = await browserLogin({ apiUrl: API_URL }, dependencies(resumed.fetchImpl, opened));
    assert.equal(opened.length, 1, "the resumed wait must not open another tab");
    assert.equal(resumed.calls.includes("/api/cli/login"), false, "the resumed wait must not start a new code");
    assert.equal(result.authenticated, true);
  });
});

test("a denied request stops the wait and forgets the code", async () => {
  await withConfigHome(async (home) => {
    const server = fakeServer([
      { status: 403, body: { error: { code: "CLI_LOGIN_DENIED", message: "Login CLI ditolak di browser." } } },
    ]);
    globalThis.fetch = server.fetchImpl;
    await assert.rejects(
      browserLogin({ apiUrl: API_URL }, dependencies(server.fetchImpl, [])),
      { code: "CLI_LOGIN_DENIED" },
    );
    await assert.rejects(stat(join(home, "login-pending.json")));
  });
});

test("server hiccups during the wait are retried, not fatal", async () => {
  await withConfigHome(async () => {
    const server = fakeServer([
      { status: 502, body: { message: "bad gateway" } },
      { status: 200, body: { status: "approved", apiKey: "dpai_minted", apiKeyId: KEY_ID, canvasPath: `/project/${PROJECT.id}/prototype`, project: PROJECT } },
    ]);
    globalThis.fetch = server.fetchImpl;
    const result = await browserLogin({ apiUrl: API_URL, noBrowser: true }, dependencies(server.fetchImpl, []));
    assert.equal(result.authenticated, true);
  });
});
