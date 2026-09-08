export class CliConfigurationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly suggestion?: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CliConfigurationError";
  }
}
