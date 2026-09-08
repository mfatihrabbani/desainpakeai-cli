import assert from "node:assert/strict";
import test from "node:test";
import {
  createCliRequestHeaders,
  detectAgentHarness,
  DPAI_CLI_VERSION,
} from "../src/client-metadata.js";

test("detectAgentHarness recognizes common harness environments", () => {
  assert.equal(detectAgentHarness({ CODEX_HOME: "C:/codex" }), "codex");
  assert.equal(detectAgentHarness({ CLAUDECODE: "1" }), "claude-code");
  assert.equal(detectAgentHarness({ CURSOR_AGENT: "1" }), "cursor-agent");
  assert.equal(detectAgentHarness({ GEMINI_CLI: "1" }), "gemini-cli");
  assert.equal(detectAgentHarness({ OPENCODE: "1" }), "opencode");
  assert.equal(detectAgentHarness({ CODEIUM_AGENT: "1" }), "windsurf");
  assert.equal(detectAgentHarness({ TERM_PROGRAM: "vscode" }), "vscode");
})

test("explicit harness identity supports every client without guessing", () => {
  assert.equal(
    detectAgentHarness({ DPAI_AGENT_HARNESS: "my-private-harness" }),
    "my-private-harness",
  );
  assert.equal(detectAgentHarness({}), undefined);
})

test("CLI request headers include safe version metadata", () => {
  const previousHarness = process.env.DPAI_AGENT_HARNESS;
  const previousVersion = process.env.DPAI_AGENT_VERSION;
  process.env.DPAI_AGENT_HARNESS = "codex";
  process.env.DPAI_AGENT_VERSION = "1.2.3";
  try {
    const headers = createCliRequestHeaders("dpai_secret", { "Content-Type": "application/json" });
    assert.equal(headers.Authorization, "Bearer dpai_secret");
    assert.equal(headers["User-Agent"], `desainpakeai-cli/${DPAI_CLI_VERSION}`);
    assert.equal(headers["X-DPAI-CLI-Version"], DPAI_CLI_VERSION);
    assert.equal(headers["X-DPAI-Agent"], "codex");
    assert.equal(headers["X-DPAI-Agent-Version"], "1.2.3");
    assert.equal(headers["Content-Type"], "application/json");
  } finally {
    if (previousHarness === undefined) delete process.env.DPAI_AGENT_HARNESS;
    else process.env.DPAI_AGENT_HARNESS = previousHarness;
    if (previousVersion === undefined) delete process.env.DPAI_AGENT_VERSION;
    else process.env.DPAI_AGENT_VERSION = previousVersion;
  }
});
