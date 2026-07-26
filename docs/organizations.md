# Organizations, teams, and tenancy

Every user belongs to at least one organization, always. Signup creates a
personal workspace, so a solo account is a team of one — there is no
"user-owned resource" path running alongside the org-owned one.

That single sentence is the whole design. The alternative (users *or* orgs)
means every query, every permission check, and every billing rule has two
shapes, and every new feature gets written twice. There is nothing to branch on
here because there is only one case.

```
src/db/schema.ts                organizations, org_members, org_invitations
src/models/organization.ts      membership queries + the scope predicate
src/services/organizations.ts   ensurePersonalOrganization
src/services/authz.ts           getOrgContext() and can()  ← the single door
src/services/members.ts         the rules the auth plugin does not know about
src/lib/auth.ts                 Better Auth organization plugin wiring
```

Membership mechanics — invitations, accept, roles, removal — come from Better
Auth's `organization` plugin. This kit supplies the tenancy scope, the
application's own permissions, and the rules that keep an org usable.

## The two identifiers

`users` and `organizations` both carry a dual id, and the distinction matters:

| Column | Owned by | Used for |
|---|---|---|
| `id` | Better Auth | Its own foreign keys. Never appears in a URL or a payload. |
| `uuid` | This app | What every application table references. |

Application tables reference `org_uuid`, never `organizations.id`.

### `OrgUuid` is a branded type

An org uuid and a user uuid are both bare v4 uuids in a `string`, so nothing
stops one being passed where the other is expected — and nothing fails when it
happens. This is not hypothetical: when entitlements moved from user-keyed to
org-keyed, four call sites kept passing `userUuid`. Every one compiled, ran,
matched no subscription row, and quietly reported the free plan.

```ts
export type OrgUuid = string & { readonly __brand: "OrgUuid" };
```

`asOrgUuid()` in `src/models/organization.ts` is the only place a plain string
becomes one. Call it on values that came out of an `organizations` row, nowhere
else.

## The single door

Every authorization decision goes through two functions:

```ts
const ctx = await getOrgContext(req);        // who, in which org, as what
if (!ctx) return respNoAuth();

if (!can(ctx, "file:delete", file)) return respForbidden();
```

`getOrgContext(req, orgSlug?)` resolves in this order:

1. **The slug in the URL**, if given. Not a member → `null`. It never falls back
   to an org you *do* belong to; serving a different tenant than the URL named
   is the worst outcome of a bad link.
2. **`session.activeOrganizationId`**, as a landing preference only.
3. **The personal org.**
4. **Repair.** A user with no memberships gets one created. A signup hook that
   failed half-way would otherwise leave an account that loads nothing, fixable
   only with SQL.

### `can()` takes a resource it does not use

```ts
export function can(ctx, action: OrgAction, _resource?: unknown): boolean
```

Access is organization-wide today: if you are in the org you see its data, and
your role decides the operation — not who created the row. The third argument is
accepted and ignored so that per-resource sharing, or creator-only deletes,
become a change *inside that function* rather than at every call site. Passing
it costs nothing now and is the entire reason the upgrade stays additive.

### Three axes, never merged

| Question | Answer |
|---|---|
| Does this member's **role** allow it? | `can(ctx, "file:delete", file)` |
| Does this org's **plan** include it? | `requireEntitlement(ctx.orgUuid, "storage.upload")` |
| May they manage the **membership** itself? | the plugin's `hasPermission` |

A plan and a role disagreeing is normal — a `member` on the max tier still
cannot delete the organization. Collapsing them into one check is how that stops
being expressible.

## Roles

`owner` ⊃ `admin` ⊃ `member`. Spelled as supersets in `src/services/authz.ts`,
with a test walking the containment, because three hand-maintained lists drift.

| | member | admin | owner |
|---|:--:|:--:|:--:|
| Read org data, create and delete files, spend credits | ✅ | ✅ | ✅ |
| Invite, remove, change roles (`member:manage`) | | ✅ | ✅ |
| Update the org (`org:update`) | | ✅ | ✅ |
| Manage billing (`billing:manage`) | | | ✅ |
| Delete the org (`org:delete`) | | | ✅ |

Two deliberate defaults, both one line to change:

- **Members can delete org content**, including another member's uploads. That
  follows from org-wide access. Restricting deletes to the creator is the first
  thing the `resource` argument will be used for.
- **Billing is owner-only.** The owner is who the money comes from; an admin
  changing the plan spends someone else's. Mature products go further and split
  billing into its own role so finance can hold it without product access —
  that is the documented next step, not something a starter kit needs.

An unrecognized role degrades to `member`. A typo in a manual SQL update grants
nothing.

## Data scope

Seven tables carry `org_uuid`, NOT NULL since migration 0015:

`files`, `tasks`, `credits`, `orders`, `subscriptions`, `apikeys`,
`reservations`

`affiliates` and `feedbacks` stay user-scoped: a referral and a piece of
feedback belong to the person, not to the tenant they happen to be working in.

Every query against those tables goes through one predicate:

```ts
db().select().from(files).where(scopedToOrg(files.org_uuid, ctx.orgUuid))
```

It is a one-line function, and that is the point. The catastrophic failure of
multi-tenancy is not a complicated bug — it is one forgotten `where` clause that
shows Acme's files to Initech. A named helper gives that clause a single
definition and gives the architecture test something mechanical to enforce.

`tests/unit/architecture.test.ts` fails the build on:

- a query against a tenant table in a model that does not use `scopedToOrg`
- an insert into a tenant table that does not write `org_uuid`
- a route accepting `org_uuid` from a request body — that is an authorization
  bypass with a friendly name
- the detection regex silently matching nothing

The allowlist has two entries, each with a written reason. It is the entire risk
surface of tenancy in one place; a new entry needs a reason that survives the
question *"what happens when two customers both have a row matching this key?"*

## Credits pool at the organization

Two columns, two different questions:

- `org_uuid` — whose balance this row moves. All arithmetic keys on it.
- `user_uuid` — which member did it. Recorded, never summed.

`user_uuid` is carried on every ledger row even though nothing reads it for
balance purposes, because per-member quotas and usage reporting cannot be
reconstructed after the fact. One column now, impossible to backfill later.

**Spending is serialized per organization**, not per user:

```sql
select pg_advisory_xact_lock(hashtextextended(:org_uuid, 0::bigint))
```

This lock used to key on `user_uuid`, which was correct while a balance belonged
to one person. Pooling changed the invariant: two members spending at the same
time would take two different locks, both read the same balance, and both
succeed — spending the same credits twice. The lock must cover exactly what the
balance covers. `tests/db/org-isolation.test.ts` fires two concurrent spends at
one balance and asserts exactly one wins.

## Billing belongs to the organization

The Stripe customer is attached to the tenant, not the person — which is how
every team product bills. With a per-user customer the subscription lives on the
org but the payment method lives on whoever clicked checkout, so when they leave
the team their card keeps paying for it and nobody remaining can change it.

- `organizations.stripe_customer_id`, with `org_uuid` in Stripe metadata.
- `users.stripe_customer_id` is still *read* for subscriptions created before
  tenancy. No longer written.
- Checkout stamps `org_uuid` into session metadata so webhooks attribute
  without guessing.
- A customer is never adopted on a matching email alone. Two organizations can
  legitimately bill to one address — a consultant with several clients, or one
  person's personal and team workspaces — and adopting on email would put both
  tenants behind a single payment method.

Entitlements resolve per organization, so a member of a team on `max` gets
`max`, and the owner leaving does not downgrade everyone else.

## Rules that keep an org usable

Better Auth will happily delete the last owner's membership row. What that
leaves behind is an organization nobody can invite into, bill, or administer,
with no self-serve path back. `src/services/members.ts` refuses:

- **An org must never lose its last owner** — neither by removal nor demotion.
  Checked with a `count(*)` against the database, not a cached list, because two
  admins demoting the last two owners concurrently is exactly the race this is
  here to lose safely.
- **Nobody may leave their only organization.** The invariant is that a user
  always has somewhere to act, not that a workspace carries the `is_personal`
  flag — a workspace that has since been shared still carries it.
- **Nobody may grant a role above their own.** An admin minting an owner would
  be granting a power they do not hold, including the power to remove them.

## Invitations

72-hour expiry. Re-inviting an address supersedes the pending invitation rather
than stacking a second one, because two live invitations means two accept links
and the second click fails confusingly.

The invitation id in the link **is** the credential, so:

- Acceptance is bound to the invited email address. A forwarded email cannot add
  the wrong person to a team.
- Missing, used, and expired invitations all render the same outcome. Telling
  them apart would let anyone with a guessed id learn whether it names a real
  team.
- Accept and decline are separate verbs (`POST` / `DELETE`) so a mis-click on
  decline cannot be replayed into an accept.

Emails queue through the job table rather than sending inline: an invite should
not fail because Resend is briefly down, and a serverless instance can freeze
before an un-awaited send completes.

## What is deliberately not built

Not oversights. Each is additive on top of what is here:

| | Why not yet |
|---|---|
| **Org switcher** | A user can belong to several orgs, but nothing switches between them. `getOrgContext` picks active → personal → first. |
| **`/[locale]/[org]/` routes** | `getOrgContext(req, orgSlug)` already accepts a slug; nothing passes one. Path scoping beats session-only — two tabs on two orgs otherwise fight over one value — but it moves every page and link. |
| **Teams within an org** | The plugin supports them behind a flag. Off, so three tables stay out of a fresh install. |
| **Custom roles** | Same: the plugin's dynamic access control is off. |
| **Seat billing** | Wrong model for a credits product, where usage pools and seats are billed separately if at all. |
| **"Request upgrade" flow** | A member hitting checkout gets `BILLING_OWNER_ONLY` with a clear message, but nothing notifies the owner. |

## Adding a tenant-scoped table

1. Add `org_uuid varchar(255) NOT NULL` and an index.
2. Type the insert as `typeof table.$inferInsert & { org_uuid: string }`, so
   omitting it is a compile error rather than an unreachable row.
3. Read through `scopedToOrg(table.org_uuid, ctx.orgUuid)`.
4. Add the table name to `TENANT_TABLES` in `tests/unit/architecture.test.ts`.

Step 4 is the one that matters. Without it the table is unguarded and the next
forgotten `where` clause ships.
