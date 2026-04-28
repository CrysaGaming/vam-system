---
name: vam-multi-tenancy
description: Use when writing or modifying any database read, write, Server Action, API route, or Prisma model. Enforces airlineId-scoping via session → user.airlineId. Documents two exceptions (public token endpoints, single-tenant bot).
---

# VAM Multi-Tenancy Pattern

Architectural Principle 1: every entity is airline-scoped. No hardcoded
airline IDs. Enforced in every DB read and write.

## airlineId source — always session→DB→user.airlineId

```ts
const session = await auth();
const user = await prisma.user.findUnique({
  where: { id: session.user.id },
  select: { airlineId: true },
});
if (!user?.airlineId) throw new Error('User not in any airline');
```

Never from URL params, props, or hardcoded strings. Reference:
`apps/web/app/api/live/sessions/route.ts:5-38`.

## Read pattern (Server Component / API Route)

Fetch user, then filter downstream queries explicitly:

```ts
const topPilots = await prisma.user.findMany({
  where: { airlineId: user.airlineId, totalFlights: { gt: 0 } },
});
```

Nested relation filter for joins:

```ts
where: { isActive: true, user: { airlineId: currentUser.airlineId } }
```

References: `apps/web/app/dashboard/page.tsx:13-61`,
`apps/web/app/api/live/sessions/route.ts:5-38`.

## Write pattern (Server Action)

Validate ownership before mutating — fetch with airlineId in where, then update:

```ts
const target = await prisma.entity.findFirst({
  where: { id, airlineId: currentUser.airlineId },
});
if (!target) throw new Error('Not found or not in your airline');
await prisma.entity.update({ where: { id }, data: { ... } });
```

⚠️ TODO (refactor track): `apps/web/app/pireps/actions.ts:40-104` scopes
implicitly via userId alone. Make explicit. New actions MUST scope
explicitly — don't follow this legacy pattern.

## Public token endpoints — documented exception

Overlay tokens (OBS public endpoints) scope by userId only — token IS
the auth, no airlineId filter needed. Reference:
`apps/web/app/api/overlay/[token]/data/route.ts`. Don't apply this skill
to those endpoints.

## Anti-patterns

- Hardcoded airline ID: `where: { icao: 'DLH' }` outside `apps/bot/`.
- Missing scope on list queries: `prisma.pirep.findMany({})` without
  `airlineId` leaks data across airlines into UI.
- airlineId from URL/prop: never trust client-controllable input.
- Mutation without ownership check: `prisma.x.update({ where: { id } })`
  trusts caller. Validate airlineId match first.

## Bot — single-tenant by design (current state)

`apps/bot/` is hardcoded to DLH (`commands/fleet.ts:31`, `leaderboard.ts:30`).
Exception: `commands/pilot.ts:55-62` uses `user.airlineId`. TODO when bot
goes multi-tenant: derive airlineId from `DiscordRoleMapping` (Guild→Airline).
Don't fix bot hardcoding ad-hoc without a Guild-mapping plan.

## Self-check before committing

- Does this query/mutation include `airlineId` in `where`? (Or is it a
  documented exception?)
- Does the `airlineId` come from session → DB lookup, not from URL,
  props, or string literals?
- Does `grep -r "icao: 'DLH'" apps/web` return zero hits?
