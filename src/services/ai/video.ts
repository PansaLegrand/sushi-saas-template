interface TextToVideoInput {
  prompt: string;
  seconds?: number;
  aspectRatio?: string;
}

interface TextToVideoResult {
  outputUrl: string;
  vendorId?: string;
  raw?: unknown;
}

export async function generateTextToVideo(
  input: TextToVideoInput
): Promise<TextToVideoResult> {
  const seconds = input.seconds ?? 8;
  const aspect = input.aspectRatio ?? "landscape";

  void seconds;
  void aspect;

  const fallbackUrl =
    process.env.TEXT2VIDEO_MOCK_URL ??
    "/test.mp4";

  return {
    outputUrl: fallbackUrl,
  };
}

export type { TextToVideoInput, TextToVideoResult };

