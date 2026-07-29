const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;

/**
 * Accept a proxy trace id only when it is short and log-safe.
 *
 * Request ids are copied into response headers and structured logs. Bounding
 * the alphabet and length prevents an untrusted caller from turning that
 * correlation field into a log-forging or storage-amplification primitive.
 */
export function normalizeRequestId(
  candidate: string | null | undefined,
  generate: () => string = () => crypto.randomUUID()
): string {
  const value = candidate?.trim();
  return value && REQUEST_ID_PATTERN.test(value) ? value : generate();
}
