/**
 * Theory-Exam helpers für Welle 13E-13.
 *
 * Was hier rein gehört:
 *   - createTheoryExamQuestion    — admin/seed CRUD für die question-bank
 *   - deactivateTheoryExamQuestion — soft-delete (active=false)
 *   - listTheoryExamQuestions     — admin-overview, filter per license/cat/active
 *   - startTheoryExam             — pilot startet einen versuch, balanced random-pick
 *   - getAttemptWithQuestions     — fetch attempt + zugehörige fragen für UI-render
 *   - saveAttemptAnswer           — pilot beantwortet eine frage (in-progress save)
 *   - submitTheoryExam            — pilot finalisiert, score wird berechnet,
 *                                   bei pass: enrollment.theoryExamPassedAt+Score
 *                                   gesetzt + status → EXAM_SCHEDULED
 *   - getTheoryExamAttempts       — history pro enrollment
 *   - getActiveAttempt            — running attempt für resume nach reload
 *
 * Was NICHT hier rein gehört:
 *   - Practical-Exam (PIREP-based criteria) — kommt in 13E-14
 *   - License-issuance nach exam-pass — die wird nicht hier ausgelöst,
 *     weil der praktische teil noch fehlt. License-grant erst wenn BEIDE
 *     teile passed sind (Welle 13E-14).
 *
 * Pass-policy:
 *   - Pass-mark: PASS_MARK_PERCENT (80%). Fix global, kein per-license-
 *     override. Realistisch (EASA pass-mark für Theorie-fächer ist 75%
 *     pro fach — wir sind etwas strenger weil unsere fragen-bank kleiner
 *     und damit weniger noise-tolerant ist).
 *   - Default question-count: DEFAULT_EXAM_QUESTION_COUNT (20). Caller
 *     kann mehr/weniger anfragen — im MVP fix 20 weil die starter-bank
 *     ~50 fragen hat. Bei 20 von 50 sind genug variation für retries.
 *   - Pass-bedingung: scorePercent >= PASS_MARK_PERCENT (>=, nicht >).
 *     17/20 = 85% → pass. 16/20 = 80% → pass (exakt grenze). 15/20 =
 *     75% → fail.
 *
 * Selection-strategy in startTheoryExam:
 *   1. Filter active=true, licenseType=enrollment.licenseType
 *   2. Pro relevant-category (siehe RELEVANT_CATEGORIES_BY_LICENSE):
 *      pick floor(count/categories.length) random questions
 *   3. Wenn count nicht teilbar: remainder als topup aus restlicher bank
 *   4. Wenn pro category nicht genug fragen: greedily mit was da ist,
 *      topup-rest aus gesamter bank (best-effort, nie throw)
 *   5. Final shuffle damit categories nicht clustered erscheinen
 *
 * Race-conditions:
 *   - saveAttemptAnswer: full-array-replace (nicht atomic-position-update)
 *     weil prisma keine partial-array-updates supported. Im single-user-
 *     pilot-context (jeder pilot allein in seinem quiz) keine race möglich.
 *     Wenn UI parallel save'n tries (z.B. user-clicks zwei mal schnell),
 *     wins last-write — akzeptabel weil beide answers dieselbe semantik
 *     haben (frage X hat antwort Y).
 *   - submitTheoryExam: prisma.$transaction für atomic update von attempt
 *     + enrollment. Wenn enrollment-update fehlt aber attempt-update ge-
 *     committed wäre, wäre der pilot in inkonsistentem state ("ich hab
 *     bestanden aber meine enrollment weiß es nicht"). Transaction
 *     verhindert das.
 */

import {
  Prisma,
  type LicenseType,
  type TheoryExamCategory,
  type TheoryExamQuestion,
  type TheoryExamAttempt,
} from "@prisma/client";
import { prisma } from "../index.js";
import type { DbClient } from "../economy/wallet.js";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pass-mark in percent. Pilot muss diesen score erreichen ODER überschreiten
 * um die theorie-prüfung zu bestehen. Global, nicht per-license override-
 * bar im MVP. Wenn später nötig, wäre ein Map<LicenseType, number> additive.
 */
export const PASS_MARK_PERCENT = 80;

/**
 * Default-anzahl fragen pro versuch. Caller (z.B. server-action) kann
 * via questionCount-param überschreiben. Bei start mit weniger questions
 * in der bank als angefragt → wir picken alle vorhandenen + warning-flag
 * im result.
 */
export const DEFAULT_EXAM_QUESTION_COUNT = 20;

/**
 * Pro license-typ: welche kategorien sind relevant?
 *
 * Quelle: EASA Part-FCL syllabi. Manche kategorien sind für gewisse licenses
 * irrelevant (z.B. NAVIGATION für PPL nicht required, kommt erst mit IR/CPL).
 *
 * Wenn ein license-typ nicht in dieser map ist (sollte nicht passieren wenn
 * alle LicenseType-werte abgedeckt sind), fallback auf alle 6 kategorien.
 */
export const RELEVANT_CATEGORIES_BY_LICENSE: Record<LicenseType, TheoryExamCategory[]> = {
  SPL: ["REGULATIONS", "WEATHER", "AERODYNAMICS", "SYSTEMS"],
  PPL: ["REGULATIONS", "WEATHER", "AERODYNAMICS", "SYSTEMS"],
  NIGHT_RATING: ["REGULATIONS", "WEATHER", "AERODYNAMICS", "SYSTEMS"],
  INSTRUMENT_RATING: [
    "REGULATIONS",
    "WEATHER",
    "AERODYNAMICS",
    "SYSTEMS",
    "NAVIGATION",
  ],
  MULTI_ENGINE_RATING: ["AERODYNAMICS", "SYSTEMS"],
  CPL: ["REGULATIONS", "WEATHER", "AERODYNAMICS", "SYSTEMS", "NAVIGATION"],
  MCC: ["SYSTEMS", "HUMAN_FACTORS"],
  ATPL: [
    "REGULATIONS",
    "WEATHER",
    "AERODYNAMICS",
    "SYSTEMS",
    "NAVIGATION",
    "HUMAN_FACTORS",
  ],
  TRI: ["REGULATIONS", "AERODYNAMICS", "SYSTEMS", "HUMAN_FACTORS"],
  TRE: ["REGULATIONS", "AERODYNAMICS", "SYSTEMS", "HUMAN_FACTORS"],
};

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers (kein DB-zugriff, leicht testbar)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle (in-place mutation, returns same array). Math.random
 * ist gut genug für quiz-randomization — kein crypto-random nötig.
 */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Verteilt `total` items auf `bucketCount` buckets mit "fair distribution":
 * jeder bucket bekommt floor(total/buckets), restliche werden auf erste
 * (total mod buckets) buckets gleichmäßig verteilt.
 *
 * Beispiel: distribute(20, 4) → [5, 5, 5, 5]
 * Beispiel: distribute(20, 6) → [4, 4, 4, 4, 2, 2]  (NEIN — siehe unten)
 *           tatsächlich:        [4, 4, 4, 3, 3, 2]  (fair: 20/6=3R2 → erste
 *                               2 kriegen +1 aufs base-3, plus +1 aufgerundet
 *                               ergibt 4-4-3-3-3-3 mit remainder 2 → wir
 *                               geben den ersten 2 buckets +1: 4-4-3-3-3-3
 *                               wait das ist 20)
 *
 * Eigentlich ist die formel: each bucket = floor(total/n) + (i < total%n ? 1 : 0).
 * 20/6 = 3 mit rem 2 → buckets[0..1] = 4, buckets[2..5] = 3. Sum: 4+4+3+3+3+3 = 20. ✓
 */
export function distributeBalanced(total: number, bucketCount: number): number[] {
  if (bucketCount <= 0) return [];
  const base = Math.floor(total / bucketCount);
  const remainder = total % bucketCount;
  return Array.from({ length: bucketCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Pure scoring-helper. Vergleicht answers[] gegen die correctIndex der
 * questions[] (same-order alignment expected — caller muss garantieren
 * dass questions in der reihenfolge von attempt.questionIds geladen sind).
 *
 * Score = round(correct / total * 100, 1) — auf 1 dezimalstelle gerundet.
 *
 * Returns: { correctCount, totalCount, scorePercent, passed }.
 */
export function gradeAnswers(
  questions: Pick<TheoryExamQuestion, "id" | "correctIndex">[],
  answers: number[],
): {
  correctCount: number;
  totalCount: number;
  scorePercent: number;
  passed: boolean;
} {
  const totalCount = questions.length;
  if (totalCount === 0) {
    return { correctCount: 0, totalCount: 0, scorePercent: 0, passed: false };
  }
  if (answers.length !== totalCount) {
    throw new Error(
      `gradeAnswers: array-length-mismatch (questions=${totalCount}, answers=${answers.length})`,
    );
  }

  let correctCount = 0;
  for (let i = 0; i < totalCount; i++) {
    if (answers[i] === questions[i].correctIndex) {
      correctCount++;
    }
  }
  const scorePercent = Math.round((correctCount / totalCount) * 1000) / 10;
  return {
    correctCount,
    totalCount,
    scorePercent,
    passed: scorePercent >= PASS_MARK_PERCENT,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Question-CRUD (admin-side)
// ─────────────────────────────────────────────────────────────────────────

export interface CreateTheoryExamQuestionInput {
  licenseType: LicenseType;
  category: TheoryExamCategory;
  questionText: string;
  options: string[]; // exactly 4 expected
  correctIndex: number; // 0..options.length-1
  explanation?: string | null;
  difficulty?: number; // 1-5, default 2
}

/**
 * Erzeugt eine question. App-layer-validation:
 *   - options must have at least 2 entries (typically 4)
 *   - correctIndex must be 0 <= idx < options.length
 *   - difficulty (if provided) must be 1..5
 *
 * Bewusst keine cuid-collision-prüfung — prisma cuid() ist effectively
 * collision-free für unsere skalen. Insert kann theoretisch P2002 werfen
 * wenn miraculously collide → caller exception.
 */
export async function createTheoryExamQuestion(
  input: CreateTheoryExamQuestionInput,
  db: DbClient = prisma,
): Promise<TheoryExamQuestion> {
  if (input.options.length < 2) {
    throw new Error("createTheoryExamQuestion: options must have at least 2 entries");
  }
  if (input.correctIndex < 0 || input.correctIndex >= input.options.length) {
    throw new Error(
      `createTheoryExamQuestion: correctIndex ${input.correctIndex} out of range [0, ${input.options.length - 1}]`,
    );
  }
  const difficulty = input.difficulty ?? 2;
  if (difficulty < 1 || difficulty > 5) {
    throw new Error("createTheoryExamQuestion: difficulty must be 1..5");
  }

  return db.theoryExamQuestion.create({
    data: {
      licenseType: input.licenseType,
      category: input.category,
      questionText: input.questionText,
      options: input.options,
      correctIndex: input.correctIndex,
      explanation: input.explanation ?? null,
      difficulty,
      active: true,
    },
  });
}

/**
 * Soft-delete: active=false. Frage erscheint danach NICHT mehr in
 * startTheoryExam-selection, aber existing attempts mit dieser question
 * in questionIds[] können sie noch via getAttemptWithQuestions laden
 * (wir filtern beim load NICHT auf active).
 */
export async function deactivateTheoryExamQuestion(
  id: string,
  db: DbClient = prisma,
): Promise<TheoryExamQuestion> {
  return db.theoryExamQuestion.update({
    where: { id },
    data: { active: false },
  });
}

export interface ListTheoryExamQuestionsFilters {
  licenseType?: LicenseType;
  category?: TheoryExamCategory;
  active?: boolean;
}

/**
 * Admin-overview: list questions, optional filter. Default: alle. Sortiert
 * by createdAt-DESC (neueste oben — typisch für admin "was wurde zuletzt
 * hinzugefügt").
 */
export async function listTheoryExamQuestions(
  filters: ListTheoryExamQuestionsFilters = {},
  db: DbClient = prisma,
): Promise<TheoryExamQuestion[]> {
  return db.theoryExamQuestion.findMany({
    where: {
      ...(filters.licenseType !== undefined && { licenseType: filters.licenseType }),
      ...(filters.category !== undefined && { category: filters.category }),
      ...(filters.active !== undefined && { active: filters.active }),
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Selection-helper (internal, used by startTheoryExam)
// ─────────────────────────────────────────────────────────────────────────

interface SelectQuestionsInput {
  licenseType: LicenseType;
  count: number;
}

interface SelectQuestionsResult {
  questionIds: string[];
  /**
   * Warning-flag: true wenn die bank zu klein war für balanced selection
   * und wir auf "best-effort"-fallback gefallen sind (siehe selection-
   * strategy in module-docstring). UI kann das anzeigen.
   */
  bankTooSmall: boolean;
  /** Effektive anzahl gepickter fragen (kann < count sein wenn bank-leer). */
  selectedCount: number;
}

/**
 * Picked balanced-random questions für einen license-typ.
 * Erst per-category, dann topup mit residual aus gesamter bank.
 */
async function selectQuestionsForExam(
  input: SelectQuestionsInput,
  db: DbClient = prisma,
): Promise<SelectQuestionsResult> {
  const relevantCategories =
    RELEVANT_CATEGORIES_BY_LICENSE[input.licenseType] ??
    (["REGULATIONS", "WEATHER", "AERODYNAMICS", "SYSTEMS", "NAVIGATION", "HUMAN_FACTORS"] as TheoryExamCategory[]);

  const distribution = distributeBalanced(input.count, relevantCategories.length);

  const pickedIds: string[] = [];
  let bankTooSmall = false;

  // Phase 1: balanced per-category pick.
  for (let i = 0; i < relevantCategories.length; i++) {
    const cat = relevantCategories[i];
    const wanted = distribution[i];
    if (wanted === 0) continue;

    // Hole alle aktiven fragen dieser kategorie+license.
    const candidates = await db.theoryExamQuestion.findMany({
      where: {
        licenseType: input.licenseType,
        category: cat,
        active: true,
      },
      select: { id: true },
    });

    if (candidates.length < wanted) {
      // Nicht genug in dieser category → nimm alle, markiere fallback.
      bankTooSmall = true;
      pickedIds.push(...candidates.map((c) => c.id));
    } else {
      // Random-shuffle + take(wanted).
      shuffleInPlace(candidates);
      pickedIds.push(...candidates.slice(0, wanted).map((c) => c.id));
    }
  }

  // Phase 2: topup wenn wir nicht genug gepickt haben (bank-too-small ODER
  // wenn user mehr als wir per-category haben angefragt). Ziehe aus
  // gesamter aktiver bank dieses license-typs, exkludiere bereits gepickte.
  if (pickedIds.length < input.count) {
    const needed = input.count - pickedIds.length;
    const topup = await db.theoryExamQuestion.findMany({
      where: {
        licenseType: input.licenseType,
        active: true,
        id: { notIn: pickedIds.length > 0 ? pickedIds : undefined },
      },
      select: { id: true },
    });
    if (topup.length < needed) {
      bankTooSmall = true;
    }
    shuffleInPlace(topup);
    pickedIds.push(...topup.slice(0, needed).map((c) => c.id));
  }

  // Phase 3: final shuffle damit categories nicht clustered sind.
  shuffleInPlace(pickedIds);

  return {
    questionIds: pickedIds,
    bankTooSmall,
    selectedCount: pickedIds.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Attempt-flow
// ─────────────────────────────────────────────────────────────────────────

export interface StartTheoryExamInput {
  enrollmentId: string;
  /** Override für DEFAULT_EXAM_QUESTION_COUNT (default 20). */
  questionCount?: number;
}

export interface StartTheoryExamResult {
  attempt: TheoryExamAttempt;
  /** Wenn die bank zu klein war für balanced selection. UI kann warning zeigen. */
  bankTooSmall: boolean;
}

/**
 * Pilot startet einen versuch. Picked balanced random-fragen, erstellt
 * attempt-record mit empty answers[], status=in-progress.
 *
 * Pre-conditions (caller's responsibility — wir prüfen sie hier nochmal
 * für defense-in-depth):
 *   - enrollment must exist
 *   - enrollment.status must be IN_PROGRESS oder EXAM_SCHEDULED
 *   - kein anderer running attempt darf existieren (sonst error — pilot
 *     muss den anderen erst submitten oder canceln). Wir checken auf
 *     attempts mit submittedAt=null.
 */
export async function startTheoryExam(
  input: StartTheoryExamInput,
  db: DbClient = prisma,
): Promise<StartTheoryExamResult> {
  const questionCount = input.questionCount ?? DEFAULT_EXAM_QUESTION_COUNT;
  if (questionCount <= 0 || questionCount > 100) {
    throw new Error(
      `startTheoryExam: questionCount must be 1..100 (got ${questionCount})`,
    );
  }

  const enrollment = await db.flightSchoolEnrollment.findUnique({
    where: { id: input.enrollmentId },
    select: { id: true, status: true, licenseType: true },
  });
  if (!enrollment) {
    throw new Error(`startTheoryExam: enrollment ${input.enrollmentId} not found`);
  }
  if (
    enrollment.status !== "IN_PROGRESS" &&
    enrollment.status !== "EXAM_SCHEDULED"
  ) {
    throw new Error(
      `startTheoryExam: enrollment is in status ${enrollment.status} — cannot start exam`,
    );
  }

  // Check for existing running attempt (kein concurrent attempts).
  const existingActive = await db.theoryExamAttempt.findFirst({
    where: { enrollmentId: input.enrollmentId, submittedAt: null },
    select: { id: true },
  });
  if (existingActive) {
    throw new Error(
      `startTheoryExam: enrollment has an active attempt (${existingActive.id}). Submit or abandon it first.`,
    );
  }

  const selection = await selectQuestionsForExam(
    { licenseType: enrollment.licenseType, count: questionCount },
    db,
  );

  if (selection.selectedCount === 0) {
    throw new Error(
      `startTheoryExam: no active questions in bank for ${enrollment.licenseType}. Admin must seed questions first.`,
    );
  }

  const attempt = await db.theoryExamAttempt.create({
    data: {
      enrollmentId: input.enrollmentId,
      questionIds: selection.questionIds,
      // answers default empty []; wird per saveAttemptAnswer inkrementell gefüllt.
    },
  });

  return { attempt, bankTooSmall: selection.bankTooSmall };
}

export interface AttemptWithQuestions {
  attempt: TheoryExamAttempt;
  questions: TheoryExamQuestion[];
}

/**
 * Lade einen attempt + die zugehörigen fragen in der order von questionIds.
 * UI nutzt das für quiz-rendering (frage X mit options A/B/C/D anzeigen).
 *
 * Sicherheits-policy: gibt full-data zurück inklusive correctIndex und
 * explanation. Caller (server-action) MUSS bei in-progress-attempts diese
 * felder strippen bevor sie zum client gehen — sonst kann der client
 * cheaten. Wenn submittedAt!=null, ist das stripping nicht mehr nötig
 * (UI darf antworten zeigen für review).
 *
 * Filter-detail: wir laden questions OHNE active-filter. Eine inzwischen
 * deaktivierte frage muss weiter angezeigt werden weil sie teil dieses
 * specific attempts ist.
 */
export async function getAttemptWithQuestions(
  attemptId: string,
  db: DbClient = prisma,
): Promise<AttemptWithQuestions | null> {
  const attempt = await db.theoryExamAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt) return null;

  // Bulk-fetch alle fragen, dann re-order nach attempt.questionIds-position.
  const questionsRaw = await db.theoryExamQuestion.findMany({
    where: { id: { in: attempt.questionIds } },
  });
  const byId = new Map(questionsRaw.map((q) => [q.id, q]));
  const questions = attempt.questionIds
    .map((id) => byId.get(id))
    .filter((q): q is TheoryExamQuestion => q !== undefined);

  return { attempt, questions };
}

export interface SaveAttemptAnswerInput {
  attemptId: string;
  /** 0-indexed position in attempt.questionIds[]. */
  questionIndex: number;
  /** 0..options.length-1 ODER -1 (= clear/skip). */
  answerIndex: number;
}

/**
 * Speichere antwort für eine question-position. Full-array-replace approach
 * (siehe race-conditions-discussion in module-docstring).
 *
 * Wenn attempt.answers kürzer als questionIndex ist, padden wir mit -1
 * (skipped) auf die richtige länge bevor wir setzen. Pilot kann also
 * springen ("ich beantworte erst frage 5, dann 1") ohne explicit-skip
 * zwischendurch.
 *
 * Errors:
 *   - attempt nicht gefunden
 *   - attempt schon submitted (submittedAt != null)
 *   - questionIndex out-of-bounds bzgl. questionIds[]
 *   - answerIndex < -1 oder > 3
 */
export async function saveAttemptAnswer(
  input: SaveAttemptAnswerInput,
  db: DbClient = prisma,
): Promise<TheoryExamAttempt> {
  if (input.questionIndex < 0) {
    throw new Error("saveAttemptAnswer: questionIndex must be >= 0");
  }
  if (input.answerIndex < -1) {
    throw new Error("saveAttemptAnswer: answerIndex must be >= -1");
  }

  const attempt = await db.theoryExamAttempt.findUnique({
    where: { id: input.attemptId },
    select: { id: true, submittedAt: true, questionIds: true, answers: true },
  });
  if (!attempt) {
    throw new Error(`saveAttemptAnswer: attempt ${input.attemptId} not found`);
  }
  if (attempt.submittedAt !== null) {
    throw new Error("saveAttemptAnswer: attempt already submitted");
  }
  if (input.questionIndex >= attempt.questionIds.length) {
    throw new Error(
      `saveAttemptAnswer: questionIndex ${input.questionIndex} out of bounds (length=${attempt.questionIds.length})`,
    );
  }

  // Pad answers[] auf länge questionIndex+1 mit -1, dann set position.
  const newAnswers = [...attempt.answers];
  while (newAnswers.length <= input.questionIndex) {
    newAnswers.push(-1);
  }
  newAnswers[input.questionIndex] = input.answerIndex;

  return db.theoryExamAttempt.update({
    where: { id: input.attemptId },
    data: { answers: newAnswers },
  });
}

export interface SubmitTheoryExamInput {
  attemptId: string;
  /**
   * Optional: vollständiges answers-array. Wenn weggelassen, nutzen wir
   * attempt.answers (was via saveAttemptAnswer aufgebaut wurde). Wenn
   * provided: full-replace. Length muss == questionIds.length sein
   * (sonst error). Skipped questions als -1.
   */
  finalAnswers?: number[];
}

export interface SubmitTheoryExamResult {
  attempt: TheoryExamAttempt;
  scorePercent: number;
  passed: boolean;
  correctCount: number;
  totalCount: number;
}

/**
 * Pilot finalisiert seinen versuch. Berechnet score, updated attempt-row,
 * und wenn passed=true: setzt enrollment.theoryExamPassedAt + Score und
 * status → EXAM_SCHEDULED (= ready für practical).
 *
 * Atomic via prisma.$transaction. Auch enrollment.theoryExamAttempts
 * counter wird inkrementiert (egal ob passed oder failed — jeder submit
 * zählt als attempt).
 *
 * Score-computation siehe gradeAnswers.
 *
 * Lifecycle-effect bei passed:
 *   - attempt.submittedAt = NOW(), scorePercent + passed gesetzt
 *   - enrollment.theoryExamPassedAt = NOW(), theoryExamScore = score
 *   - enrollment.theoryExamAttempts += 1
 *   - enrollment.status = EXAM_SCHEDULED (wenn vorher IN_PROGRESS)
 *
 * Lifecycle-effect bei failed:
 *   - attempt.submittedAt = NOW(), scorePercent + passed gesetzt
 *   - enrollment.theoryExamAttempts += 1
 *   - enrollment.status unchanged (pilot kann retry)
 *   - enrollment.theoryExamPassedAt + Score unchanged (best-pass-policy:
 *     wenn pilot später passed, wird das gesetzt; ein fail überschreibt
 *     nie einen pass)
 */
export async function submitTheoryExam(
  input: SubmitTheoryExamInput,
  db: DbClient = prisma,
): Promise<SubmitTheoryExamResult> {
  // Outer-fetch um attempt + enrollment zu validieren bevor transaction.
  const attempt = await db.theoryExamAttempt.findUnique({
    where: { id: input.attemptId },
    select: {
      id: true,
      enrollmentId: true,
      submittedAt: true,
      questionIds: true,
      answers: true,
    },
  });
  if (!attempt) {
    throw new Error(`submitTheoryExam: attempt ${input.attemptId} not found`);
  }
  if (attempt.submittedAt !== null) {
    throw new Error("submitTheoryExam: attempt already submitted");
  }

  // Final answers: entweder explizit übergeben oder aus attempt.answers
  // (gepadded falls noch zu kurz).
  let finalAnswers: number[];
  if (input.finalAnswers) {
    if (input.finalAnswers.length !== attempt.questionIds.length) {
      throw new Error(
        `submitTheoryExam: finalAnswers length ${input.finalAnswers.length} !== questionIds length ${attempt.questionIds.length}`,
      );
    }
    finalAnswers = input.finalAnswers;
  } else {
    finalAnswers = [...attempt.answers];
    while (finalAnswers.length < attempt.questionIds.length) {
      finalAnswers.push(-1);
    }
  }

  // Lade questions in der order von questionIds für scoring.
  const questionsRaw = await db.theoryExamQuestion.findMany({
    where: { id: { in: attempt.questionIds } },
    select: { id: true, correctIndex: true },
  });
  const byId = new Map(questionsRaw.map((q) => [q.id, q]));
  const orderedQuestions = attempt.questionIds.map((id) => {
    const q = byId.get(id);
    if (!q) {
      // Sollte nie passieren — questions können soft-deleted aber nicht
      // hard-deleted werden. Wenn doch, ist data-integrity-bruch.
      throw new Error(
        `submitTheoryExam: question ${id} referenced by attempt but not found in DB`,
      );
    }
    return q;
  });

  const grading = gradeAnswers(orderedQuestions, finalAnswers);
  const submittedAt = new Date();

  // Atomic: update attempt + enrollment in einer transaction.
  const updated = await db.$transaction(async (tx) => {
    const updatedAttempt = await tx.theoryExamAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedAt,
        answers: finalAnswers,
        scorePercent: grading.scorePercent,
        passed: grading.passed,
      },
    });

    // Enrollment-update: theoryExamAttempts immer +1. Bei passed: zusätzlich
    // theoryExamPassedAt+Score setzen + status auf EXAM_SCHEDULED bringen.
    const enrollmentUpdate: Prisma.FlightSchoolEnrollmentUpdateInput = {
      theoryExamAttempts: { increment: 1 },
    };
    if (grading.passed) {
      enrollmentUpdate.theoryExamPassedAt = submittedAt;
      enrollmentUpdate.theoryExamScore = grading.scorePercent;
      // Status-flip nur wenn aktuell IN_PROGRESS — wenn schon EXAM_SCHEDULED
      // (z.B. weil practical schon scheduled ist), nicht zurück-shiften.
      const enrollmentNow = await tx.flightSchoolEnrollment.findUnique({
        where: { id: attempt.enrollmentId },
        select: { status: true },
      });
      if (enrollmentNow?.status === "IN_PROGRESS") {
        enrollmentUpdate.status = "EXAM_SCHEDULED";
      }
    }
    await tx.flightSchoolEnrollment.update({
      where: { id: attempt.enrollmentId },
      data: enrollmentUpdate,
    });

    return updatedAttempt;
  });

  return {
    attempt: updated,
    scorePercent: grading.scorePercent,
    passed: grading.passed,
    correctCount: grading.correctCount,
    totalCount: grading.totalCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Read-helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Alle attempts eines enrollments, neueste zuerst (DESC by startedAt).
 * Inkl. running attempts (submittedAt=null) UND submitted.
 */
export async function getTheoryExamAttempts(
  enrollmentId: string,
  db: DbClient = prisma,
): Promise<TheoryExamAttempt[]> {
  return db.theoryExamAttempt.findMany({
    where: { enrollmentId },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Aktiver (running) attempt eines enrollments wenn vorhanden, sonst null.
 * UI nutzt das für resume nach reload ("du hast einen offenen test").
 *
 * Theoretisch sollte es per startTheoryExam-guard nur 0 oder 1 active
 * attempts geben. Wenn doch mehrere existieren (data-corruption), nehmen
 * wir den neuesten.
 */
export async function getActiveAttempt(
  enrollmentId: string,
  db: DbClient = prisma,
): Promise<TheoryExamAttempt | null> {
  return db.theoryExamAttempt.findFirst({
    where: { enrollmentId, submittedAt: null },
    orderBy: { startedAt: "desc" },
  });
}

/**
 * Hat dieser enrollment schon den theory-test bestanden? Quick-check
 * für UI/booking-gate.
 */
export async function hasPassedTheoryExam(
  enrollmentId: string,
  db: DbClient = prisma,
): Promise<boolean> {
  const e = await db.flightSchoolEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { theoryExamPassedAt: true },
  });
  return e?.theoryExamPassedAt !== null && e?.theoryExamPassedAt !== undefined;
}
