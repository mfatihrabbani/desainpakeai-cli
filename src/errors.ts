export class CliConfigurationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = "CliConfigurationError";
  }
}
