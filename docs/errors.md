# Error Handling

One catalog of error codes, shared by server and browser. Users see translated
copy from that catalog; developers see the real detail in the logs. **No code
path can put backend text in front of a user.**

Related: [docs/database.md](database.md), [tests/README.md](../tests/README.md).

---

## The rules

**1. Never `throw new Error("...")` in server code.** Throw `AppError` with a
catalog code.

**2. Never build a user-facing message at a call site.** If the user needs to
know something, it has a code in the catalog. If there is no fitting code, add
one — that is a two-line change plus five translations.

**3. Never let a route return `error.message`.** Every `catch` at a route
boundary ends in `respError(error, ...)`.

**4. Never branch on message text.** Branch on `error_code`. Text changes with
copy edits and differs per locale; the code is stable.

**5. Error copy lives in `src/lib/errors/i18n/locales/`, not `messages/`.**
Backend exception semantics are a different vocabulary from product copy, and
keeping them apart means translators are not reasoning about webhook signatures
next to hero headlines.

---

## Server side

### Throwing

```ts
import { AppError } from "@/lib/errors";

throw new AppError("CREDITS_INSUFFICIENT", {
  message: `user ${uuid} has ${balance}, needed ${cost}`,  // → logs only
  details: { required: cost, available: balance },          // → user-safe context
  cause: originalError,                                     // → log trail
});
```

`message` is developer-facing and can be as specific as you like — it never
leaves the server. The user gets the catalog's copy for `CREDITS_INSUFFICIENT`
in their own language.

### Returning

```ts
import { respError, respCode } from "@/lib/errors/response";

export async function POST(req: Request) {
  try {
    if (!prompt) return respCode("TASK_PROMPT_REQUIRED");
    ...
  } catch (error) {
    return respError(error, {
      log,
      logFields: { event: "task.create_failed" },
      fallback: "TASK_CREATE_FAILED",
    });
  }
}
```

`respError` resolves the code, logs the full detail (4xx at `warn`, 5xx at
`error`), and returns a body built **only** from the catalog:

```json
{ "code": -1, "message": "You do not have enough credits for this.",
  "error_code": "CREDITS_INSUFFICIENT" }
```

`fallback` applies only when the error carries no recognizable code. An
unrecognized throw becomes `SERVER_ERROR` — deliberately, since an error nobody
anticipated is the one most likely to contain a connection string.

### The envelope

`error_code` was **added** to the existing `{ code, message, data }` shape rather
than replacing it. The numeric `code` still maps 401→-2, 403→-3, 404→-4,
everything else→-1, so every existing client and route test keeps working.
`error_code` is the field new code should read.

---

## Client side

```ts
import { parseApiResponse, resolveErrorMessage, isClientApiError } from "@/lib/errors";

try {
  const data = await parseApiResponse<CreditSummary>(
    await fetch("/api/account/credits", { method: "POST" })
  );
} catch (error) {
  toast.error(resolveErrorMessage(error, locale));

  // Branch on the code when the UI can offer a next step.
  if (isClientApiError(error) && error.code === "CREDITS_INSUFFICIENT") {
    router.push("/pricing");
  }
}
```

`resolveErrorMessage` replaces the `err?.message || "Something failed"` pattern,
which showed users raw backend text when there was any and untranslated English
when there was not. Anything it does not recognize resolves to `SERVER_ERROR`
rather than exposing its message — same principle as the server side.

`readApiError` is tolerant on purpose: an HTML page from a proxy, an empty body
from a gateway timeout, or a legacy `{ code: -1, message }` payload all still
yield a usable code, because the status alone is enough to pick one.

---

## Adding an error

1. Add the entry to [src/lib/errors/catalog.ts](../src/lib/errors/catalog.ts) — `statusCode` and a
   `defaultMessage` written for a user, not a developer.
2. Add the same key to **all five** locale files in
   [src/lib/errors/i18n/locales/](../src/lib/errors/i18n/locales/). `en.json` must match `defaultMessage`
   exactly.
3. Throw it.

`tests/unit/errors.catalog.test.ts` fails if a locale is missing a key, if a
locale has a key the catalog dropped, if English drifts from `defaultMessage`, or
if two entries claim the same legacy alias. You cannot half-add an error code.

### Writing the copy

Say what happened and what to do about it. Never name the internal cause.

| Good | Bad |
|---|---|
| "You do not have enough credits for this." | "decreaseCredits threw: insufficient credits" |
| "That time slot is no longer available." | "unique constraint reservations_service_time_idx violated" |
| "The payment provider is unavailable. Please try again shortly." | "Stripe API error 502: upstream connect timeout" |

---

## Migration status

The foundation is complete and enforced by tests. Route migration is
**incremental** — `respErr(string)` still works everywhere, and the catalog's
`legacyCodes` map the old thrown strings onto canonical codes, so the frontend
can adopt `error_code` before every route is converted.

**Done**

- Catalog, `AppError`, `respError`/`respCode`, client parser, 5-locale bundle.
- `/api/checkout` — was interpolating `e.message` into a 500 body. That is the
  leak this system was built to close.
- `/api/tasks/text-to-video` — was branching on `error.message === "insufficient
  credits"`, which any copy edit would have silently broken.

**Remaining**, roughly by value:

1. ~58 `respErr("...")` call sites across the other routes. Convert opportunistically
   when touching a route; each becomes `respCode("SOME_CODE")`.
2. ~40 `throw new Error(...)` in `src/services/*`. Convert to `AppError` so the
   route boundary gets a code instead of relying on legacy alias matching.
3. ~15 frontend `toast.error(e?.message || "...")` sites → `resolveErrorMessage`.
   These currently show untranslated English to every non-English user.
4. `getAuthErrorMessage` in [auth-screen.tsx](../src/components/auth/auth-screen.tsx) string-matches three Better
   Auth messages. Those three already have catalog codes and aliases
   (`AUTH_EMAIL_NOT_VERIFIED`, `AUTH_CAPTCHA_REQUIRED`, `AUTH_CAPTCHA_FAILED`),
   so it can collapse into `resolveErrorMessage`.

A route is fully migrated when it contains no string literal that a user could
ever see.
