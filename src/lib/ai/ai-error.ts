import { AiConfig } from "../../shared/types";

type ErrorWithCause = Error & {
  cause?: NodeJS.ErrnoException;
  status?: number;
};

/** Ensure the AI config is minimally valid before requests. */
export function validateAiConfig(config: AiConfig): void {
  if (!config.baseUrl.trim()) {
    throw new Error("AI config error: baseUrl is empty.");
  }

  if (!config.apiKey.trim()) {
    throw new Error("AI config error: apiKey is empty.");
  }

  if (!config.model.trim()) {
    throw new Error("AI config error: model is empty.");
  }
}

/** Convert low-level SDK/network failures to user-facing errors. */
export function normalizeAiError(error: unknown): Error {
  if (error instanceof Error) {
    const cause = (error as ErrorWithCause).cause;
    const code = cause?.code;

    if (code === "ECONNREFUSED") {
      return new Error(
        "Unable to reach the AI server. Connection was refused by the configured baseUrl.",
      );
    }

    if (code === "ENOTFOUND") {
      return new Error(
        "Unable to resolve the AI server host. Check the configured baseUrl.",
      );
    }

    if (code === "ETIMEDOUT") {
      return new Error(
        "The AI server did not respond in time. Check connectivity or server load.",
      );
    }

    if ((error as ErrorWithCause).status === 401) {
      return new Error(
        "AI authentication failed. Check the configured apiKey.",
      );
    }

    if ((error as ErrorWithCause).status === 404) {
      return new Error(
        "The configured AI endpoint or model was not found. Check baseUrl and model.",
      );
    }

    return new Error(error.message);
  }

  return new Error("Unknown AI request error.");
}
