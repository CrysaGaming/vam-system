/**
 * Prisma 7 CLI configuration.
 *
 * Welle 12 phase B: Prisma 7 hat die datasource-URL aus schema.prisma
 * raus migriert in diese eigene config-datei. Schema enthält nur noch
 * den `provider`-block, der `url`-eintrag lebt hier — das erlaubt
 * environment-spezifische connection-strings ohne schema-edits und
 * macht den schema-file rein-deklarativ für DDL-fragen.
 *
 * Die `dotenv/config`-import lädt die monorepo-wurzel-`.env` in
 * process.env beim CLI-start. Wir suchen drei ebenen tiefer (../../.env)
 * weil `packages/db/` nicht im root liegt; der pfad ist relativ zur
 * config-datei selbst (Prisma 7 resolved relative paths so).
 *
 * Migrate-CLI-workflow nach v7:
 *   - `prisma migrate dev` / `migrate deploy` — lesen die URL hieraus
 *   - `prisma migrate diff --from-config-datasource` ersetzt das alte
 *     `--from-schema-datasource` aus v6
 *   - Unsere bisherige `dotenv-cli`-wrap in den package.json scripts
 *     bleibt redundant aber harmlos (dotenv lädt zweimal — kein effekt)
 *     bis wir die scripts in einem follow-up updaten.
 */
import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Lade die monorepo-root .env BEFORE defineConfig — env() helper liest
// process.env zur evaluierungs-zeit, nicht lazy.
config({ path: '../../.env' });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
