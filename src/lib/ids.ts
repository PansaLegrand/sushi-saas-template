import { randomInt } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

/**
 * Identifiers that do not collide between instances.
 *
 * This replaced a snowflake generator, and the reason is a deployment shape
 * rather than a taste in ids. A snowflake is `timestamp | workerId | sequence`:
 * the sequence counter makes it collision-free *within one process*, and the
 * worker id is what separates processes. `SNOWFLAKE_WORKER_ID` defaulted to `1`,
 * and nothing on Vercel assigns one — so every concurrent lambda was worker 1,
 * and two of them generating in the same millisecond produced the same id.
 *
 * The unique indexes on `orders.order_no`, `credits.trans_no`, and the rest meant
 * that never corrupted data. It meant something else: a failed insert on a
 * financial record, surfaced to whoever was mid-checkout, at exactly the moments
 * traffic was high enough to have concurrent instances.
 *
 * UUIDv7 needs no coordination — 48 bits of millisecond timestamp plus 74 random
 * bits — so there is no worker id to forget to set.
 */

/**
 * A new record identifier. Use for anything persisted: `order_no`, `trans_no`,
 * row `uuid`s.
 *
 * v7 rather than v4 deliberately. It keeps the leading timestamp, so ids still
 * sort roughly by creation order — which preserves B-tree index locality on
 * insert, and keeps a debugging habit that worked with snowflake ids: two ids
 * next to each other were made at about the same time.
 *
 * Not for anything a person types or reads aloud — see `newShortCode`.
 */
export function newId(): string {
  return uuidv7();
}

/**
 * Crockford-ish base32: no `I`, `L`, `O`, or `U`.
 *
 * `I`/`L`/`O` are dropped because they are indistinguishable from `1` and `0` in
 * most fonts, and these codes get read off a screen and typed by hand. `U` is
 * dropped because leaving it out is the cheapest way to avoid generating a code
 * that reads as an obscenity.
 */
const SHORT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A short, human-transcribable, random code. For invite codes and the like.
 *
 * Random rather than derived from `newId()`. The previous invite code was
 * `parseInt(snowflakeId).toString(36).slice(-8)`, which inherited the collision
 * problem above *and* made codes guessable: consecutive ids differ in their low
 * bits, so one real invite code told you roughly what the next ones would be.
 *
 * `randomInt` rather than `Math.random()` because these are shared links that
 * grant an attribution reward — a predictable one can be farmed.
 *
 * Callers must still handle a collision. At 8 characters this is ~40 bits, which
 * is ample for invite codes and nowhere near enough to skip the uniqueness check
 * on a column with a unique index.
 */
export function newShortCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)];
  }
  return code;
}
