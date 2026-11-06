import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOpenLink } from "../src/auth-client.js";

async function withIsolatedConfig(run: () => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "dpai-open-link-"));
  const previous = { config: process.env.DPAI_CONFIG_HOME, fetch: globalThis.fetch };
  process.env.DPAI_CONFIG_HOME = home;
  try {
    await run();
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.config === undefined) delete process.env.DPAI_CONFIG_HOME;
    else process.env.DPAI_CONFIG_HOME = previous.config;
    await rm(home, { force: true, recursive: true });
  }
}

const token = `dpai_open_${"a".repeat(43)}`;

test("open --link asks the server with the CLI key and returns a full one-time URL", async () => {
  await withIsolatedConfig(async () => {
    const calls: Array<{ authorization: string | null; method: string | undefined; url: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        authorization: new Headers(init?.headers).get("authorization"),
        method: init?.method,
        url: String(input),
      });
      return Response.json({ expiresAt: "2026-11-06T10:02:00.000Z", path: `/cli/open#t=${token}` });
    }) as typeof fetch;

    const link = await createOpenLink({ apiKey: "dpai_test_key", apiUrl: "https://desainpakeai.com/" });

    assert.deepEqual(calls, [{
      authorization: "Bearer dpai_test_key",
      method: "POST",
      url: "https://desainpakeai.com/api/cli/open-link",
    }]);
    assert.deepEqual(link, {
      expiresAt: "2026-11-06T10:02:00.000Z",
      openUrl: `https://desainpakeai.com/cli/open#t=${token}`,
    });
  });
});

test("open --link refuses a response that is not an open link", async () => {
  await withIsolatedConfig(async () => {
    globalThis.fetch = (async () => Response.json({ expiresAt: "2026-11-06T10:02:00.000Z", path: "/evil?t=x" })) as typeof fetch;
    await assert.rejects(
      createOpenLink({ apiKey: "dpai_test_key", apiUrl: "https://desainpakeai.com" }),
      { code: "INVALID_OPEN_LINK_RESPONSE" },
    );
  });
});

test("open --link surfaces the server's error code", async () => {
  await withIsolatedConfig(async () => {
    globalThis.fetch = (async () => Response.json(
      { error: { code: "LOCAL_AGENT_HANDOFF_REQUIRES_PRO", message: "Butuh Pro." } },
      { status: 403 },
    )) as typeof fetch;
    await assert.rejects(
      createOpenLink({ apiKey: "dpai_test_key", apiUrl: "https://desainpakeai.com" }),
      { code: "LOCAL_AGENT_HANDOFF_REQUIRES_PRO" },
    );
  });
});
