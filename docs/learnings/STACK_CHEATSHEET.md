# Stack Cheatsheet — Tailwind CSS v4 + Next.js 16

Researched 2026-05-01 from official docs. Reference for cc-experiment branch
work; informs everything we build going forward. Updated as we hit edges.

---

## Tailwind CSS v4

### Setup (current project state)

```css
/* apps/web/app/globals.css */
@import "tailwindcss";
@plugin "@tailwindcss/forms";
```

```js
// apps/web/postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`tailwind.config.{js,ts}` is **gone in v4** — config lives in CSS via `@theme`,
`@utility`, `@custom-variant`. The legacy `@config` directive can load an old
JS config, but new code shouldn't reach for it.

### Source detection (THE thing that bit us)

Tailwind v4 scans **all files** in the project as plain text, except:
- Files in `.gitignore`
- `node_modules`
- Binaries (images, video, fonts, archives)
- CSS files
- Lock files

Detection starts from the directory of the `package.json` containing the
stylesheet. **For us that's `apps/web/`** — so `app/**` and `components/**`
are both scanned automatically. `components/AppShell.tsx` should have been
picked up without needing an explicit `@source`.

When the auto-detection misses something (rare — usually only for external
packages):

```css
@source "../node_modules/@acmecorp/ui-lib";   /* include external */
@source not "../src/legacy";                    /* exclude */
@source inline("bg-red-{50,...,950}");          /* safelist explicit classes */
@source not inline("hover:bg-red-{50,..,950}"); /* exclude classes */
@import "tailwindcss" source(none);             /* disable auto-detect */
@import "tailwindcss" source("../src");          /* override base path */
```

### Detection gotchas

- **Dynamic class names break detection**: `bg-${color}-600` is invisible to
  Tailwind. Map to predefined static strings instead:
  ```jsx
  // ✗ won't work
  <button className={`bg-${color}-600`} />
  // ✓ works
  const variants = { red: 'bg-red-600', blue: 'bg-blue-600' };
  <button className={variants[color]} />
  ```
- **String concatenation breaks too**: `'lg:' + 'flex'` is invisible. Always
  write the full literal class name.

### Theme variables (`@theme`)

Theme variables aren't just CSS variables — they **drive utility generation**.
A `--color-foo-500` definition automatically creates `bg-foo-500`, `text-foo-500`,
`border-foo-500`, etc.

Namespaces and what they generate:

| Namespace            | Generates                                |
| -------------------- | ---------------------------------------- |
| `--color-*`          | `bg-`, `text-`, `border-`, `ring-`, etc. |
| `--font-*`           | `font-sans`, `font-display`              |
| `--text-*`           | `text-xs`, `text-2xl` (font-size)        |
| `--font-weight-*`    | `font-bold`, `font-semibold`             |
| `--tracking-*`       | `tracking-wide`, `tracking-tight`        |
| `--leading-*`        | `leading-tight`, `leading-relaxed`       |
| `--breakpoint-*`     | `sm:`, `md:`, `lg:`, `xl:`, `2xl:`       |
| `--container-*`      | `@sm:`, `max-w-md`                       |
| `--spacing-*`        | `px-4`, `mt-8`, `max-h-16`               |
| `--radius-*`         | `rounded-sm`, `rounded-xl`               |
| `--shadow-*`         | `shadow-md`                              |
| `--inset-shadow-*`   | `inset-shadow-xs`                        |
| `--drop-shadow-*`    | `drop-shadow-md`                         |
| `--blur-*`           | `blur-md`                                |
| `--ease-*`           | `ease-out`                               |
| `--animate-*`        | `animate-spin`                           |
| `--aspect-*`         | `aspect-video`                           |

Default breakpoints: `sm: 40rem (640px)`, `md: 48rem (768px)`,
`lg: 64rem (1024px)`, `xl: 80rem (1280px)`, `2xl: 96rem (1536px)`. The `rem`
units mean these scale with root font-size — at the default 16px it's the
same as the v3 px-based breakpoints.

To override or add:

```css
@theme {
  --breakpoint-sm: 30rem;       /* override existing */
  --breakpoint-3xl: 120rem;     /* add new → enables 3xl: variant */
  --color-mint-500: oklch(0.72 0.11 178);  /* add new color */
}

@theme {
  --color-*: initial;            /* nuke ALL default colors */
  --color-white: #fff;
  --color-brand: oklch(...);
}

@theme inline {
  --font-sans: var(--font-inter);  /* `inline` resolves at definition */
}
```

### `@utility` for custom utilities (replaces `@layer utilities`)

```css
/* Static utility */
@utility content-auto {
  content-visibility: auto;
}

/* Functional utility — accepts theme tokens */
@theme {
  --tab-size-github: 8;
}
@utility tab-* {
  tab-size: --value(--tab-size-*);     /* match theme */
  tab-size: --value(integer);          /* bare numbers: tab-4 */
  tab-size: --value([integer]);        /* arbitrary: tab-[7] */
}
```

All `@utility` declarations automatically support every variant
(`hover:`, `focus:`, `lg:`, `dark:`, etc.) — no manual wiring needed.

### Variants

Order doesn't matter when stacking (`dark:md:hover:bg-foo` and
`md:dark:hover:bg-foo` produce the same CSS). All variants share equal
specificity; later rules in the stylesheet win.

Categories:
- **Pseudo-class**: `hover`, `focus`, `focus-visible`, `focus-within`, `active`,
  `disabled`, `checked`, `valid`, `invalid`, `placeholder-shown`, `read-only`,
  `first`, `last`, `odd`, `even`, `nth-[3]`
- **Pseudo-element**: `before`, `after`, `placeholder`, `selection`,
  `first-line`, `first-letter`, `marker`, `file`, `backdrop`
- **Media**: `sm/md/lg/xl/2xl`, `max-sm` … `max-2xl` (max-width versions),
  `dark` (`prefers-color-scheme: dark` by default in v4),
  `motion-safe`, `motion-reduce`, `contrast-more`, `print`, `portrait`, `landscape`
- **Container queries**: `@container` parent + `@sm`, `@md`, etc. on children
- **Attributes**: `aria-checked`, `aria-disabled`, `aria-expanded`,
  `data-[state=open]`, `data-[size=large]`, `ltr`, `rtl`
- **Group/Peer**: `group-hover:*`, `peer-checked:*`, named: `group/item` →
  `group-hover/item:*`
- **Children**: `*:` (direct children), `**:` (all descendants)
- **Arbitrary**: `[&.is-active]:*`, `[&_p]:*` (underscore = space),
  `[@supports(grid):]grid`

`@custom-variant` registers reusable variants:

```css
@custom-variant theme-midnight (&:where([data-theme="midnight"] *));
/* → enables theme-midnight:bg-black */
```

### Cascade layers in the generated CSS

Tailwind v4 emits CSS structured as:

```css
@layer properties { /* @property declarations */ }
@layer theme       { /* :root with --color-*, --breakpoint-*, etc. */ }
@layer base        { /* preflight resets */ }
@layer components  { /* @utility output that's composable */ }
@layer utilities   { /* the bulk: utility classes + responsive variants */ }
```

Inside `@layer utilities`, breakpoint variants are wrapped in nested
`@media (min-width: 64rem)` blocks. Same specificity as the unprefixed rule;
later in source-order wins, which means `.lg:flex` (later) overrides
`.hidden` (earlier) when the media query matches.

### v4 vs v3 — quick migration table

| v3                      | v4                               |
| ----------------------- | -------------------------------- |
| `@tailwind base/.../utilities;` | `@import "tailwindcss";`   |
| `tailwind.config.js`    | `@theme {}` in CSS               |
| `@layer utilities { }`  | `@utility name { }`              |
| `bg-opacity-50`         | `bg-black/50`                    |
| `flex-shrink-0`         | `shrink-0`                       |
| `shadow-sm`             | `shadow-xs` (renamed)            |
| `shadow`                | `shadow-sm` (renamed)            |
| `rounded-sm`            | `rounded-xs`                     |
| `outline-none`          | `outline-hidden`                 |
| `ring`                  | `ring-3`                         |
| `!flex`                 | `flex!` (! at end)               |
| `bg-[--brand]`          | `bg-(--brand)` (parens)          |
| Default border = gray-200 | Default border = currentColor  |
| Default ring = blue-500/3px | Default ring = currentColor/1px |

### Browser requirements

Chrome 111+, Safari 16.4+, Firefox 128+. Older browsers → stick with v3.4.

---

## Next.js 16

### Defaults that matter for us

- **Turbopack is now default** for `next dev` and `next build`.
  Opt out with `--webpack`. We're already on Turbopack.
- **Node.js 20.9+ minimum**.
- **Sync `params`, `searchParams`, `cookies()`, `headers()`, `draftMode()`
  are removed** — must `await` them. Code that still has
  `params.id` without `await` is broken on 16.
- **`middleware.ts` deprecated** in favor of `proxy.ts` (same API, runs on
  Node.js runtime). Edge-runtime middleware still works but goes away.
- **Cache Components opt-in** via `next.config.ts`:
  ```ts
  export default { cacheComponents: true } satisfies NextConfig;
  ```
  Without it, the previous "implicit caching" behavior is what we have.

### App Router file conventions

| File              | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| `layout.tsx`      | Wraps children; preserves state across navigations          |
| `page.tsx`        | Renders at the route's URL                                  |
| `loading.tsx`     | Suspense fallback during navigation/data fetch              |
| `error.tsx`       | Error boundary; **must be Client Component**                |
| `not-found.tsx`   | Rendered for `notFound()` calls or unmatched routes         |
| `route.ts`        | API/HTTP handler (GET/POST/etc.)                            |
| `template.tsx`    | Like layout but re-creates on navigation (no state)         |
| `default.tsx`     | Required for parallel-route slots without explicit content  |
| `proxy.ts`        | Network-edge interception (replaces middleware.ts)          |

Special folder conventions:
- `[slug]` — dynamic segment (single)
- `[...slug]` — catch-all
- `[[...slug]]` — optional catch-all
- `(group)` — **route group** — folder name in parens does NOT appear in URL.
  Use to share a layout among siblings or partition the app into sections.
- `@slot` — parallel route slot

### Layouts

- `app/layout.tsx` is the **root layout** — required, must contain `<html>`
  and `<body>`. Can be async and fetch data with Prisma/etc.
- Nested layouts compose: `app/dashboard/layout.tsx` wraps everything under
  `/dashboard/*`.
- **State is preserved on navigation between siblings** — a layout doesn't
  re-render when navigating between pages it wraps. This is why putting
  ephemeral state in a layout works.
- Use `LayoutProps<'/dashboard'>` and `PageProps<'/blog/[slug]'>` helpers
  (auto-generated, globally available) for typed `params` / named slots.

### Server Components vs Client Components

- **Default = Server Component**. Layouts and pages are server components
  unless marked otherwise.
- `"use client"` at the top of a file marks the **boundary** — that file and
  everything it imports becomes part of the client bundle. You don't add the
  directive to every nested file, only the entry.
- Server components can be `async`, fetch data, run Prisma queries, use API
  keys safely. They can't use `useState`, `useEffect`, event handlers, or
  browser-only APIs.
- Client components can't import server-only code, but **can receive server
  components as `children` props** — common pattern: `<ClientModal>` wrapping
  `<ServerCart />` from the server.
- Props passed server → client must be **serializable** (no functions except
  server actions, no class instances, etc.).
- Context providers must be client components, but should be placed deep in
  the tree to keep statics statically renderable.

Use `server-only` package to mark modules that must never reach the client
(it produces a build-time error if a client component imports them).

### Server Actions / Server Functions

- Async server-side functions, callable from forms or client event handlers.
- Two ways to mark:
  - `'use server'` at top of an async function → that one fn is a server fn
  - `'use server'` at top of a file → all exports are server fns

```ts
// app/actions.ts
'use server';

export async function createPost(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  // mutate...
  revalidatePath('/posts');
  redirect('/posts');
}
```

```tsx
// Server component using it directly
<form action={createPost}>
  <input name="title" />
  <button type="submit">Create</button>
</form>

// Client component using it
'use client';
import { createPost } from '@/app/actions';
<button onClick={() => createPost(formData)}>...</button>
```

After mutations:
- `revalidatePath('/posts')` — invalidates the route's cache.
- `revalidateTag('posts', 'max')` — second arg is **now required** in 16
  (was deprecated single-arg form in 15). Profile is `'max'`, `'hours'`,
  `'days'`, or `{ expire: number }`.
- `updateTag('posts')` — **NEW in 16**, server-actions-only, read-your-writes
  semantics: fresh data within the same request.
- `refresh()` from `next/cache` — **NEW in 16**, refreshes uncached client
  data without touching the cache.
- `redirect('/somewhere')` — throws a control-flow exception; nothing after
  it runs. Call `revalidatePath` BEFORE `redirect` if you need fresh data.

For pending state: `useActionState(action, initial)` returns
`[state, action, pending]`.

`cookies()` is **async in 16** — must `await cookies()`. Cookies set in a
server action automatically re-render the current page server-side so the UI
sees the new value.

**Security note**: server actions are POST endpoints reachable directly, not
just through the UI. Always check auth inside every server action — don't
rely on the calling component's gating.

### Caching (legacy model — what we use)

Without `cacheComponents: true`, Next.js uses the previous caching model:
- `fetch()` calls are cached by default (with revalidation knobs).
- `revalidatePath` and `revalidateTag` invalidate.
- Routes flip to dynamic when they read cookies/headers/searchParams.

### Caching (Cache Components — opt-in)

When `cacheComponents: true`:
- Default rendering is **dynamic** (request-time) — opt INTO caching with
  `'use cache'` at top of a function/component.
- `cacheLife('hours')`, `cacheTag('posts')` to configure.
- Anything dynamic without `<Suspense>` wrapping or `'use cache'` errors out
  at dev/build time.
- Enables Partial Prerendering (PPR) — static shell + streamed dynamic chunks.

### Routing & Linking

`<Link href="/foo">` is the canonical way to navigate. Auto-prefetches on
hover and viewport entry. Next.js 16 added:
- **Layout deduplication**: shared layouts are downloaded once even if 50
  prefetched links share them.
- **Incremental prefetching**: only the parts not already cached.
- Cancels prefetches when links leave the viewport.

For programmatic nav: `useRouter()` (client) or `redirect()` (server).

### Things NOT to do

- Don't put `'use client'` at the top of `app/layout.tsx` — it ruins the
  data-fetching ability of the root layout. Put it on leaf interactive
  components.
- Don't import server-only packages (Prisma, fs, etc.) into client
  components. Use `server-only` to enforce.
- Don't pass functions that aren't server actions as props from server →
  client. Won't serialize.
- Don't rename `middleware.ts` until you read the proxy.ts migration — same
  API but Node runtime semantics may differ for edge-specific code.

---

## How this project is wired (current state, 2026-05-01)

- `apps/web/app/layout.tsx` — async server component, fetches session +
  user/airline/role for the sidebar via Prisma, hands to `<AppShell>` which
  decides whether to render the sidebar based on pathname.
- `apps/web/components/AppShell.tsx` — client component (`usePathname`),
  bypasses shell on `/`, `/invite/*`, `/overlay/*`, `/api/*`. Wraps content
  in a flex layout with sidebar on `lg+`.
- Server actions live next to their pages (`app/airline/actions.ts`,
  `app/admin/roles/actions.ts`, etc.) with `'use server'` at file top.
- Auth gates use convention: `requireAdmin()`, `requireAirlineAdmin()`
  helpers that re-export from each actions file. The pattern duplicates
  itself — when we hit a 4th caller, extract to `lib/auth-guards.ts`.
- `globals.css` uses Tailwind v4 default source detection — no explicit
  `@source` for app/components needed. The default scan starts from
  `apps/web/` (where the closest `package.json` lives) and covers
  `app/**` + `components/**` automatically.
- The `apps/web/components/` folder contains AppShell, BarChart, DonutChart,
  OfpSummary. Sibling to `app/`.

## Open issue carried forward

~~Sidebar (`AppShell.tsx`) renders but display: none.~~ **RESOLVED 2026-05-01.**

### Root cause (the actual one)

After CSS source files change at runtime (e.g. `globals.css` edits, new
component files with new utilities), Turbopack does emit fresh CSS, but the
**browser's already-parsed `document.styleSheets` object stays stale on
hard-reload (Ctrl+Shift+R)** when the URL hash hasn't changed. The browser
re-fetches the file (confirmed via Network) but doesn't always re-parse it
into a new CSSStyleSheet object.

Symptom: `document.styleSheets[0].cssRules` contains older rules than what a
fresh `fetch()` of the same URL returns. New `lg:` (or any newly-added)
utilities don't apply because their `@media` blocks are missing from the
parsed sheet, even though they exist in the file on the network.

### How to detect it

```js
// In DevTools console:
const ss = [...document.styleSheets].find(s => s.href?.includes('00ekqvr'));
const utilLayer = [...ss.cssRules].find(r => r.constructor.name === 'CSSLayerBlockRule' && r.name === 'utilities');
const mqs = new Set();
for (const r of utilLayer.cssRules) {
  if (r.constructor.name === 'CSSMediaRule') mqs.add(r.media.mediaText);
}
console.log([...mqs]);  // should include "(min-width: 64rem)" if lg: rules exist
```

If the expected media queries aren't there but raw `fetch(ss.href)` returns
them, the parsed sheet is stale.

### Fix

A real **navigation** (not Ctrl+Shift+R) re-parses the stylesheet. From the
problem page, navigate to a different route and back, or to any URL and
back. The fresh page-load triggers a full stylesheet re-parse.

Programmatic fix during debugging: inject a fresh `<link>` tag with a
cache-busting query param — that bypasses the stale parsed-sheet object
entirely.

### What did NOT fix it (don't waste time on these)

- Ctrl+Shift+R / hard reload — fetches new CSS but doesn't re-parse it
- `rm -rf .next` + dev-server restart — server emits fresh CSS but the
  client browser still uses its parsed copy
- Cloudflared restart — the CF-tunnel cache turned out to be incidental;
  CF was correctly revalidating with `cf-cache-status: EXPIRED` and serving
  the fresh file
- Adding `@source` directives — Tailwind v4's default scan covers `apps/web/`
  including `components/`, so explicit globs were redundant (they did
  nothing harmful, but didn't fix the issue either)

