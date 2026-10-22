/** Fresh clones contain an empty override; a successful demo must still return playable output. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { generateTextToVideo } from "@/services/ai/video";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENABLE_DEMO_FEATURES", "true");
  vi.stubEnv("ENABLE_TEXT2VIDEO_MOCK", "true");
  resetEnvCacheForTests();
});
afterEach(() => { vi.unstubAllEnvs(); resetEnvCacheForTests(); });
it.each([undefined, "", "   "])("uses the bundled asset for an absent or empty override (%s)", async value => {
  vi.stubEnv("TEXT2VIDEO_MOCK_URL", value);
  expect(await generateTextToVideo({ prompt: "demo" })).toEqual({ outputUrl: "/demo-video.mp4" });
});
it("trims a configured override", async () => {
  vi.stubEnv("TEXT2VIDEO_MOCK_URL", "  https://example.test/video.mp4  ");
  expect(await generateTextToVideo({ prompt: "demo", seconds: 4, aspectRatio: "portrait" })).toEqual({ outputUrl: "https://example.test/video.mp4" });
});
it("remains disabled in production even when demo flags are set", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await expect(generateTextToVideo({ prompt: "demo" })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
});
