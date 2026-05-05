/**
 * Welle 13E-13b: Seed-script für die theory-exam question-bank.
 *
 * Liest PPL_THEORY_QUESTIONS aus prisma/theory-exam-questions.ts und
 * inserted sie idempotent in die TheoryExamQuestion-tabelle.
 *
 * Idempotency-strategie: pro frage prüfen wir per (questionText, licenseType)
 * ob die frage schon existiert. Wenn ja: skip. Wenn nein: create. Re-runs
 * sind safe — keine duplikate.
 *
 * Run:
 *   pnpm --filter @vam/db tsx prisma/scripts/seed-theory-exam-questions.ts
 *
 * Oder direkt aus packages/db:
 *   npx tsx prisma/scripts/seed-theory-exam-questions.ts
 *
 * Output: progress per category + summary {created, skipped, total}.
 *
 * Exit-codes: 0 = success, 1 = error.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PPL_THEORY_QUESTIONS } from "../theory-exam-questions.js";

// Prisma 7 + driver-adapter: muss explicit konstruiert werden (mirroring
// src/index.ts). DATABASE_URL kommt aus .env via prisma.config.ts loadEnv.
const connectionString = process.env.DATABASE_URL ?? "";
if (!connectionString) {
  console.error("[seed-theory-exam] DATABASE_URL not set in environment");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

interface SeedStats {
  created: number;
  skipped: number;
  total: number;
  byCategory: Record<string, { created: number; skipped: number }>;
}

async function main() {
  console.log(
    `[seed-theory-exam] starting with ${PPL_THEORY_QUESTIONS.length} questions...`,
  );

  const stats: SeedStats = {
    created: 0,
    skipped: 0,
    total: PPL_THEORY_QUESTIONS.length,
    byCategory: {},
  };

  for (const q of PPL_THEORY_QUESTIONS) {
    if (!stats.byCategory[q.category]) {
      stats.byCategory[q.category] = { created: 0, skipped: 0 };
    }

    // App-layer-validation (mirroring createTheoryExamQuestion).
    if (q.options.length !== 4) {
      throw new Error(
        `Question "${q.questionText.slice(0, 50)}..." has ${q.options.length} options, expected 4`,
      );
    }
    if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      throw new Error(
        `Question "${q.questionText.slice(0, 50)}..." has invalid correctIndex ${q.correctIndex}`,
      );
    }

    // Idempotency: check (questionText, licenseType)-tuple. Wir nutzen das
    // exakt-match — wenn der text geändert wurde, gilt das als andere frage.
    const existing = await prisma.theoryExamQuestion.findFirst({
      where: {
        licenseType: q.licenseType,
        questionText: q.questionText,
      },
      select: { id: true },
    });

    if (existing) {
      stats.skipped++;
      stats.byCategory[q.category].skipped++;
      continue;
    }

    await prisma.theoryExamQuestion.create({
      data: {
        licenseType: q.licenseType,
        category: q.category,
        questionText: q.questionText,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation ?? null,
        difficulty: q.difficulty ?? 2,
        active: true,
      },
    });
    stats.created++;
    stats.byCategory[q.category].created++;
  }

  // Summary-output.
  console.log("");
  console.log(`[seed-theory-exam] done.`);
  console.log(
    `  Created: ${stats.created}, Skipped (already in DB): ${stats.skipped}, Total: ${stats.total}`,
  );
  console.log("  By category:");
  for (const [cat, counts] of Object.entries(stats.byCategory)) {
    console.log(`    ${cat.padEnd(15)} created=${counts.created}, skipped=${counts.skipped}`);
  }

  // Final sanity-check: zeige bank-totals pro license/category.
  console.log("");
  console.log(`[seed-theory-exam] bank-totals after seed:`);
  const all = await prisma.theoryExamQuestion.findMany({
    select: { licenseType: true, category: true, active: true },
  });
  const totals: Record<string, Record<string, { active: number; inactive: number }>> = {};
  for (const q of all) {
    if (!totals[q.licenseType]) totals[q.licenseType] = {};
    if (!totals[q.licenseType][q.category]) {
      totals[q.licenseType][q.category] = { active: 0, inactive: 0 };
    }
    if (q.active) totals[q.licenseType][q.category].active++;
    else totals[q.licenseType][q.category].inactive++;
  }
  for (const [lic, cats] of Object.entries(totals)) {
    console.log(`  ${lic}:`);
    for (const [cat, counts] of Object.entries(cats)) {
      const inactiveTag = counts.inactive > 0 ? ` (+${counts.inactive} inactive)` : "";
      console.log(`    ${cat.padEnd(15)} ${counts.active} active${inactiveTag}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("[seed-theory-exam] FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
