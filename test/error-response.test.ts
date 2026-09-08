import assert from "node:assert/strict";
import test from "node:test";
import { readJsonResponse } from "../src/auth-client.js";
import { CliConfigurationError } from "../src/errors.js";

test("readJsonResponse preserves server error details and status", async () => {
  const response = Response.json({
    error: {
      code: "ANCHOR_NOT_FOUND",
      details: { path: "src/pages/home.page.html", suggestion: "Read the file again." },
      message: "The edit anchor was not found.",
    },
  }, { status: 400 });

  await assert.rejects(
    () => readJsonResponse(response),
    (error) => error instanceof CliConfigurationError
      && error.code === "ANCHOR_NOT_FOUND"
      && error.details.httpStatus === 400
      && error.details.path === "src/pages/home.page.html"
      && error.suggestion === "Read the file again.",
  );
});
