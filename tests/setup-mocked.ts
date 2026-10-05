/**
 * Route and service tests use the real in-memory rate limiter. CI also exposes
 * Redis for the infrastructure tier, but sharing its counters here makes
 * otherwise isolated route tests consume each other's request allowance.
 * Clear the deployment setting before test modules initialize their env cache;
 * tests of Redis failures can still opt in explicitly with vi.stubEnv.
 */
delete process.env.RATE_LIMIT_REDIS_URL;
