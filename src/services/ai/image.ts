import { isImageGenerationMockEnabled } from "@/lib/demo-flags";
import { getAppEnv } from "@/lib/env";
import { AppError } from "@/lib/errors/app-error";

export type ImageGenerationInput = {
  prompt: string;
};

export type GeneratedImage = {
  body: Uint8Array;
  contentType: "image/svg+xml";
  extension: "svg";
  provider: "mock";
  providerRequestId: string;
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/**
 * Local provider adapter for the starter's reference workflow.
 *
 * A real adapter should preserve `idempotencyKey` at the provider boundary and
 * return bytes; task orchestration and private storage stay unchanged.
 */
export async function generateImage(
  input: ImageGenerationInput,
  options: {
    idempotencyKey: string;
    attempt: number;
    signal: AbortSignal;
  },
): Promise<GeneratedImage> {
  if (!isImageGenerationMockEnabled()) {
    throw new AppError("FEATURE_DISABLED", {
      message: "image-generation mock provider is disabled",
    });
  }

  if (options.signal.aborted) {
    throw new AppError("TASK_PROVIDER_FAILED", {
      message: `image-generation request ${options.idempotencyKey} was aborted`,
    });
  }

  if (options.attempt <= getAppEnv().IMAGE_GENERATION_MOCK_FAILURES) {
    throw new AppError("TASK_PROVIDER_FAILED", {
      message: `image-generation mock failure on attempt ${options.attempt}`,
    });
  }

  const prompt = escapeXml(input.prompt.trim().slice(0, 240));
  const requestId = `mock-${options.idempotencyKey}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="Generated image">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111827"/>
      <stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="72" fill="url(#background)"/>
  <circle cx="790" cy="220" r="160" fill="#a5b4fc" opacity="0.28"/>
  <circle cx="220" cy="820" r="210" fill="#22d3ee" opacity="0.18"/>
  <text x="72" y="430" fill="#ffffff" font-family="system-ui, sans-serif" font-size="44" font-weight="700">Image generation mock</text>
  <foreignObject x="72" y="480" width="880" height="300">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#e0e7ff;font:32px/1.35 system-ui,sans-serif;overflow-wrap:anywhere">${prompt}</div>
  </foreignObject>
  <text x="72" y="940" fill="#c7d2fe" font-family="ui-monospace, monospace" font-size="18">${requestId}</text>
</svg>`;

  return {
    body: new TextEncoder().encode(svg),
    contentType: "image/svg+xml",
    extension: "svg",
    provider: "mock",
    providerRequestId: requestId,
  };
}
