import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

export type RemoteToolOptions = CredentialOverrides & {
  /** Where `export_prototype` writes the downloaded HTML; defaults to ./.output/prototype.html. */
  outputPath?: string;
};

export async function executeRemoteTool(
  name: string,
  input: unknown,
  options: RemoteToolOptions = {},
) {
  if (name === "export_prototype") {
    return downloadRemoteExport(input as { expectedRevision: string }, options);
  }
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

/**
 * The server compiles the project and returns the HTML itself; the file is
 * written here, on the user's machine, never on the server. The export opens
 * on the first page unless the project has none.
 */
async function downloadRemoteExport(input: { expectedRevision: string }, options: RemoteToolOptions) {
  const credential = await resolveCredential(options);
  const apiUrl = credential.apiUrl.replace(/\/$/, "");
  const context = await executeRemoteTool("get_project_context", {}, options) as { pages?: Array<{ route?: unknown }> };
  const firstRoute = context.pages?.find((page) => typeof page.route === "string")?.route as string | undefined;
  const query = new URLSearchParams({ revision: input.expectedRevision, ...(firstRoute ? { route: firstRoute } : {}) });
  const response = await fetch(`${apiUrl}/api/cli/export?${query}`, {
    headers: createCliRequestHeaders(credential.apiKey, {}, { apiUrl: credential.apiUrl }),
  });
  if (!response.ok) await readJsonResponse(response);
  const html = await response.text();
  const outputPath = resolve(options.outputPath ?? ".output/prototype.html");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  return {
    bytes: Buffer.byteLength(html, "utf8"),
    initialRoute: firstRoute ?? "/",
    outputPath,
    pageCount: context.pages?.length ?? 0,
    revision: response.headers.get("x-dpai-revision") ?? input.expectedRevision,
  };
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
      }, { apiUrl: credential.apiUrl }),
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
