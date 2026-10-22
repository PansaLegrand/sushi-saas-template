/** Untrusted pagination must never reach SQL unbounded or before authentication. */
import { beforeEach, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";
const mocks = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn() }));
vi.mock("@/services/authz", () => ({ getOrgContext: mocks.context }));
vi.mock("@/models/file", () => ({ listFilesPageByOrg: mocks.list }));
import { GET } from "@/app/api/storage/files/route";
const request = (query = "") =>
  new Request(`http://localhost:3000/api/storage/files${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimitForTests();
  mocks.context.mockResolvedValue({ orgUuid: "org-1" });
  mocks.list.mockResolvedValue({
    items: [],
    page: 1,
    limit: 50,
    hasMore: false,
  });
});
it("authenticates before reading files", async () => {
  mocks.context.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.list).not.toHaveBeenCalled();
});
it.each([
  "?limit=101",
  "?limit=Infinity",
  "?limit=NaN",
  "?limit=0",
  "?page=-1",
  "?page=1.2",
  "?page=10001",
])("rejects invalid pagination %s", async (query) => {
  const response = await GET(request(query));
  expect(response.status).toBe(400);
  expect((await response.json()).error_code).toBe("REQUEST_VALIDATION_FAILED");
  expect(mocks.list).not.toHaveBeenCalled();
});
it("returns bounded continuation metadata", async () => {
  expect((await GET(request("?page=2&limit=100"))).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith("org-1", 2, 100);
});
