/**
 * Welle 14F — Stream-Rewards für streamer-pilots.
 *
 * Wenn ein viewer auf twitch (oder zukünftig youtube/etc.) etwas
 * monetäres macht — neue subscription, gift-sub, bits cheeren — kriegt
 * der streamer-pilot VAM-coins als reward in seinem primary user-wallet.
 *
 * # Design
 *
 * - **Single transaction-typ** REVENUE_STREAM_REWARD für alle event-
 *   kinds. Differenzierung passiert via `category`-string (z.B.
 *   "twitch-sub-tier1") + `metadata`-JSON (viewer-name, raw-amount,
 *   etc.). So bleibt der enum übersichtlich aber audit-views können
 *   per category-prefix-filter platform-agnostisch laufen
 *   ("twitch-*" vs "youtube-*" vs "*-sub-*" vs "*-cheer").
 *
 * - **Auto-create wallet**: streamer-pilot hat möglicherweise noch
 *   kein primary-wallet wenn er noch nie wallet-aktivität hatte. Wir
 *   nutzen getOrCreateWallet damit der erste reward das wallet
 *   bootstrappt.
 *
 * - **Reward-amounts als constants**: tunable via konstanten am
 *   anfang dieser file. Kein DB-config-table im MVP — wenn admin-
 *   side tuning später gewünscht, kommt das mit einem economy-config-
 *   model. Aktuelle werte sind kalibriert sodass ein subscriber-tier-1
 *   ungefähr 100 VAM$ wert ist (ungefähr 1/3 PIREP-flight-revenue),
 *   ein tier-3-sub fast einen ganzen flug ersetzt. Cheer ist scaled
 *   per 100-bits weil 100 bits = ~1 USD echtgeld = 1 sub-tier-1-äquivalent.
 *
 * - **Idempotency**: caller-responsibility. Twitch-EventSub liefert
 *   gelegentlich duplicate-events (websocket-reconnect, retry). Der
 *   bot-handler sollte mit message_id deduplizieren bevor awardStreamReward
 *   gerufen wird. Wir machen hier KEIN dedup-check — das wäre app-layer
 *   coupling auf eine specific event-source-impl. Wallet-side ist jeder
 *   call eine echte transaction.
 *
 * # Failure-modes
 *
 * - User existiert nicht → wirft Error("User not found"). Bot-handler
 *   loggt + skippt (race: streamer hat sich kurz vor reward unverlinkt).
 * - User-wallet kann nicht erstellt werden (DB-error) → propagiert.
 *   Bot-handler loggt aber unterbricht event-dispatch nicht.
 * - Amount = 0 (z.B. cheer mit < 100 bits gerundet) → no-op, returnt
 *   { skipped: true, reason: "amount-zero" } statt error. So können
 *   bot-handler micro-events (z.B. 1-bit-cheers) silently ignorieren.
 */

import { Prisma, type Transaction } from "@prisma/client";
import { prisma } from "../index.js";
import { toDecimal } from "./decimal.js";
import { getOrCreateWallet, recordTransaction } from "./wallet.js";

// ─────────────────────────────────────────────────────────────────────────
// Reward-amount-konstanten (kalibriert in VAM$)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reward für eine neue subscription auf den channel des streamer-pilots.
 * Indexiert per twitch-tier (1, 2, 3 = stufen 4.99/9.99/24.99 USD).
 *
 * Tier-progression entspricht der ungefähren USD-relation: tier 2 = 2.5×,
 * tier 3 = 5× tier 1. Wir geben aber nicht 1:1 USD-werte — VAM$ ist eine
 * spielwährung mit eigener kurve. Tier-1 = 100 VAM$ ist kalibriert sodass
 * subscribers spürbar sind aber nicht alleine den airline-output dominieren.
 *
 * Re-subs (1-monat resub eines existing subscribers) werden vom bot
 * NICHT gerewardet — channel.subscribe in twitch's EventSub feuert nur
 * für NEW subs, re-subs kommen via channel.subscription.message als
 * separates event (nicht implementiert in 14F). Strategie um chronische
 * sub-farming zu verhindern (sub→cancel→sub-again-loop).
 */
export const SUBSCRIBE_REWARDS_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 100,
  2: 250,
  3: 750,
};

/**
 * Reward für cheer-events, kalkuliert pro 100 bits. Twitch-bits sind ~1¢
 * USD-äquivalent pro bit (nach twitch's 30%-cut), so 100 bits ~= 1 USD,
 * also ~50 VAM$ als pendant. Reward-amount = floor(bits / 100) * 50.
 *
 * Cheer-events mit < 100 bits werden silent skipped (amount=0). Twitch
 * erlaubt cheers ab 1 bit — wir wollen aber nicht jedem 1-bit-cheer
 * ein audit-log-entry geben (würde transaction-history mit micro-noise
 * fluten). Schwellenwert kann später getunt werden falls user-feedback
 * anders.
 */
export const CHEER_REWARD_PER_100_BITS = 50;

/**
 * Reward pro gegifteten sub. Channel.subscription.gift fires einmal
 * mit `total` count + tier — wir geben pro gegiftetem sub den tier-
 * preis, nicht den subscriber-preis (gifts gehen zwar an viewers,
 * aber das geld kommt vom gifter).
 *
 * Beispiel: gifter giftet 5 tier-1-subs → reward = 5 × 100 = 500 VAM$.
 * Beispiel: gifter giftet 1 tier-3-sub → reward = 1 × 750 = 750 VAM$.
 *
 * Die bibliotheks-frage \"gift-batch oder pro-sub einzeln tracken?\" ist
 * geklärt: twitch fire EIN gift-event mit total-count, nicht N events.
 * Wir machen also EIN reward-transaction mit metadata.giftCount für
 * audit-clarity.
 */
export const GIFT_REWARDS_BY_TIER: Record<1 | 2 | 3, number> = {
  1: 100,
  2: 250,
  3: 750,
};

/**
 * Hype-train base-bonus (multipliziert mit dem level). Twitch hype-trains
 * haben level 1-5 (rare bis epic). Wir multiplizieren base × level so:
 *   level 1 = 200 VAM$
 *   level 2 = 400
 *   level 3 = 600
 *   level 4 = 800
 *   level 5 = 1000
 *
 * Ein hype-train ist eine community-recognition-event ("dein chat hat
 * sich aufgeregt!") — der reward-wert ist intentional moderat damit
 * subs/cheers die hauptliche revenue-source bleiben. Hype-train-bonus
 * ist mehr "icing on the cake" bei einem aktiven stream.
 */
export const HYPE_TRAIN_BASE_BONUS = 200;

// ─────────────────────────────────────────────────────────────────────────
// Reward-types (discriminated union)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Discriminated union für reward-quellen. Caller (bot-handler) baut
 * das objekt direkt aus dem twitch-event-payload und ruft awardStreamReward.
 *
 * Bei zukünftigen platforms (youtube super-chats, etc.) wird der `kind`-
 * tag erweitert. Die category-string-konvention ist dann z.B.
 * "youtube-superchat-tier1" — selbe enum (REVENUE_STREAM_REWARD), neuer
 * category-prefix.
 */
export type StreamRewardEvent =
  | {
      kind: "twitch-subscribe";
      tier: 1 | 2 | 3;
      /** Twitch-login (nicht display-name) des subscribers, kann anonym sein. */
      subscriberLogin: string | null;
      /** True wenn diese sub aus einem gift kam (sub.is_gift im event-payload). */
      isGift: boolean;
    }
  | {
      kind: "twitch-cheer";
      bits: number;
      /** Login des cheerers oder null bei anonymous-cheers. */
      cheererLogin: string | null;
      isAnonymous: boolean;
    }
  | {
      kind: "twitch-gift";
      /** Anzahl der gegifteten subs in diesem event. */
      total: number;
      tier: 1 | 2 | 3;
      /** Login des gifters oder null bei anonymous-gifts. */
      gifterLogin: string | null;
      isAnonymous: boolean;
    }
  | {
      kind: "twitch-hype-train-begin";
      /** Hype-train level (1-5). */
      level: number;
    };

/**
 * Result-shape von awardStreamReward. Bei skip (amount=0 oder unknown
 * kind) ist `transaction` null und `skipped` enthält den grund. Bei
 * success enthält `transaction` die geschriebene row und `amount` den
 * tatsächlichen reward-betrag (kann von einer naiven berechnung
 * abweichen wenn z.B. cheer-bits gerundet wurden).
 */
export type StreamRewardResult =
  | {
      ok: true;
      skipped: false;
      transaction: Transaction;
      amount: number;
      category: string;
    }
  | {
      ok: true;
      skipped: true;
      reason: string;
    };

// ─────────────────────────────────────────────────────────────────────────
// Helper: amount + category + description aus event berechnen
// ─────────────────────────────────────────────────────────────────────────

interface RewardComputation {
  amount: number;
  category: string;
  description: string;
  metadata: Record<string, unknown>;
}

/**
 * Pure function: berechnet reward-betrag, category-string und description
 * aus dem event-objekt. Keine DB-side-effects — testbar isoliert.
 *
 * Returnt null wenn der event-typ keinen reward triggert (z.B. cheer
 * unter dem schwellenwert). Caller (awardStreamReward) handled das als
 * skip.
 */
function computeReward(event: StreamRewardEvent): RewardComputation | null {
  switch (event.kind) {
    case "twitch-subscribe": {
      const amount = SUBSCRIBE_REWARDS_BY_TIER[event.tier];
      // is_gift=true bedeutet: twitch sendet ZUSÄTZLICH zur gift-batch
      // einen channel.subscribe für jeden gegifteten sub. Wir wollen das
      // NICHT doppelt zahlen — das gift-batch-event gibt schon den vollen
      // reward an den streamer. Skip die individual gift-subscribe-events.
      if (event.isGift) {
        return null;
      }
      const subscriberDisplay = event.subscriberLogin ?? "<anonym>";
      return {
        amount,
        category: `twitch-sub-tier${event.tier}`,
        description: `Twitch-Subscription tier ${event.tier} von ${subscriberDisplay}`,
        metadata: {
          platform: "twitch",
          subKind: "subscribe",
          tier: event.tier,
          subscriberLogin: event.subscriberLogin,
        },
      };
    }
    case "twitch-cheer": {
      // Floor-division durch 100: 250 bits = 2 × CHEER_REWARD = 100 VAM$,
      // 99 bits = 0 (skipped). Bewusst floor statt round damit wir nicht
      // \"50 bits zählen halb wie 100\" haben — discrete steps.
      const bucketsOf100 = Math.floor(event.bits / 100);
      const amount = bucketsOf100 * CHEER_REWARD_PER_100_BITS;
      if (amount <= 0) {
        return null;
      }
      const cheererDisplay = event.isAnonymous
        ? "<anonym>"
        : (event.cheererLogin ?? "<unknown>");
      return {
        amount,
        category: "twitch-cheer",
        description: `Twitch-Cheer ${event.bits} bits von ${cheererDisplay}`,
        metadata: {
          platform: "twitch",
          subKind: "cheer",
          bits: event.bits,
          cheererLogin: event.cheererLogin,
          isAnonymous: event.isAnonymous,
        },
      };
    }
    case "twitch-gift": {
      if (event.total <= 0) {
        return null;
      }
      const perSub = GIFT_REWARDS_BY_TIER[event.tier];
      const amount = event.total * perSub;
      const gifterDisplay = event.isAnonymous
        ? "<anonym>"
        : (event.gifterLogin ?? "<unknown>");
      return {
        amount,
        category: `twitch-gift-tier${event.tier}`,
        description: `Twitch-Gift: ${event.total}× tier ${event.tier} von ${gifterDisplay}`,
        metadata: {
          platform: "twitch",
          subKind: "gift",
          tier: event.tier,
          giftCount: event.total,
          gifterLogin: event.gifterLogin,
          isAnonymous: event.isAnonymous,
        },
      };
    }
    case "twitch-hype-train-begin": {
      // Defensiv: level kann theoretisch 0 oder negativ kommen wenn
      // twitch's payload mal merkwürdig ist. Clamp auf min 1.
      const level = Math.max(1, event.level);
      const amount = level * HYPE_TRAIN_BASE_BONUS;
      return {
        amount,
        category: `twitch-hype-train-l${level}`,
        description: `Twitch-Hype-Train (level ${level}) gestartet`,
        metadata: {
          platform: "twitch",
          subKind: "hype-train-begin",
          level,
        },
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API: awardStreamReward
// ─────────────────────────────────────────────────────────────────────────

/**
 * Schreibt einen reward auf das primary user-wallet des streamer-pilots.
 * Auto-creates das wallet wenn es noch nicht existiert.
 *
 * @param userId VAM-user-id des streamer-pilots
 * @param event reward-quelle (twitch-subscribe/cheer/gift/hype-train)
 * @returns success mit transaction-row, oder skip mit grund
 */
export async function awardStreamReward(
  userId: string,
  event: StreamRewardEvent,
): Promise<StreamRewardResult> {
  const computed = computeReward(event);
  if (!computed) {
    return {
      ok: true,
      skipped: true,
      reason: `${event.kind}: amount=0 oder gift-subscribe-individual (skip)`,
    };
  }

  // Verify user existiert. Sollte praktisch immer der fall sein
  // (bot-handler lookup'd den user vor dem call), aber defensiv für
  // races (user gerade gelöscht/unverlinkt mid-event).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    throw new Error(`awardStreamReward: user not found id=${userId}`);
  }

  // Wallet auto-bootstrap. getOrCreateWallet ist idempotent: wenn schon
  // existiert, returnt das existing wallet; sonst neu mit balance=0.
  const wallet = await getOrCreateWallet({
    ownerType: "USER",
    ownerUserId: userId,
    walletType: "primary",
  });

  // Single-leg revenue-transaction. Pattern wie REVENUE_PASSENGER —
  // geld kommt aus dem nichts (oder konzeptuell vom SYSTEM-treasury,
  // aber wir machen es nicht als transfer um audit-noise zu vermeiden).
  // Cast metadata zu Prisma.InputJsonValue: prisma's JSON-input-typ ist
  // recursive (kann strings/numbers/arrays/nested-objects), unser
  // Record<string, unknown> ist ein superset — alle werte die wir hier
  // setzen (strings, numbers, booleans, null) sind gültige JSON, der
  // cast ist also safe.
  const tx = await recordTransaction({
    walletId: wallet.id,
    amount: toDecimal(computed.amount),
    type: "REVENUE_STREAM_REWARD",
    category: computed.category,
    description: computed.description,
    metadata: computed.metadata as Prisma.InputJsonValue,
  });

  return {
    ok: true,
    skipped: false,
    transaction: tx,
    amount: computed.amount,
    category: computed.category,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test-helper exports (computeReward + constants public für unit-tests
// ohne DB-roundtrip)
// ─────────────────────────────────────────────────────────────────────────

export { computeReward };

/**
 * Convenience-helper für UI-display: gegeben einen category-string
 * aus einer Transaction mit type=REVENUE_STREAM_REWARD, returnt einen
 * human-readable display-label. Nutzt die category-konvention die
 * computeReward sets.
 */
export function describeStreamRewardCategory(category: string): string {
  // Format: "{platform}-{kind}[-{detail}]"
  if (category.startsWith("twitch-sub-tier")) {
    const tier = category.slice("twitch-sub-tier".length);
    return `Twitch-Sub Tier ${tier}`;
  }
  if (category === "twitch-cheer") {
    return "Twitch-Cheer (Bits)";
  }
  if (category.startsWith("twitch-gift-tier")) {
    const tier = category.slice("twitch-gift-tier".length);
    return `Twitch-Gift Tier ${tier}`;
  }
  if (category.startsWith("twitch-hype-train-l")) {
    const level = category.slice("twitch-hype-train-l".length);
    return `Twitch-Hype-Train (Level ${level})`;
  }
  return category;
}
