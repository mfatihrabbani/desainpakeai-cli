import { readJsonResponse } from "./auth-client.js";
import { resolveCredential, type CredentialOverrides } from "./credentials.js";
import { CliConfigurationError } from "./errors.js";
import { createCliRequestHeaders } from "./client-metadata.js";
import { GUIDES } from "./guides.js";
import {
  compactToolPayload,
  shapeDesignContext,
  shapeProjectContext,
  type DesignContextOptions,
  type ProjectContextOptions,
} from "./output-shaping.js";

export async function executeRemoteTool(
  name: string,
  input: unknown,
  options: CredentialOverrides = {},
) {
  if (name === "get_guide") {
    try {
      return await requestRemoteTool(name, input, options);
    } catch (error) {
      if (error instanceof CliConfigurationError && error.code === "UNKNOWN_CLI_OPERATION") {
        return GUIDES[(input as { topic: keyof typeof GUIDES }).topic];
      }
      throw error;
    }
  }
  if (name === "get_project_context") {
    const [context, design] = await Promise.all([
      requestRemoteTool(name, input, options),
      requestRemoteTool("get_design_context", { detail: "full" }, options),
    ]);
    return shapeProjectContext(context, design, input as ProjectContextOptions);
  }
  if (name === "get_design_context") {
    return shapeDesignContext(
      await requestRemoteTool(name, input, options),
      input as DesignContextOptions,
    );
  }
  return compactToolPayload(name, await requestRemoteTool(name, input, options));
}

async function requestRemoteTool(
  name: string,
  input: unknown,
  options: CredentialOverrides,
) {
  const credential = await resolveCredential(options);
  const operation = encodeURIComponent(name);
  const response = await fetch(
    `${credential.apiUrl.replace(/\/$/, "")}/api/cli/workspace/${operation}`,
    {
      body: JSON.stringify({ input: input ?? {} }),
      headers: createCliRequestHeaders(credential.apiKey, {
        "Content-Type": "application/json",
      }),
      method: "POST",
    },
  );
  try {
    return await readJsonResponse(response);
  } catch (error) {
    if (error instanceof CliConfigurationError && error.code === "INTERNAL_ERROR") {
      throw new CliConfigurationError(
        error.code,
        error.message,
        error.suggestion
          ?? `Retry the native '${name}' command once. If it still fails, report the operation and CLI version; do not rewrite the whole workspace file as a workaround.`,
        { ...error.details, operation: name },
      );
    }
    throw error;
  }
}
