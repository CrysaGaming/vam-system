import { getUserWalletStats, formatVamCurrency, Decimal } from "@vam/db";
import Link from "next/link";

interface Props {
  userId: string;
}

/**
 * Welle 13D-2 — Dashboard-WalletCard.
 *
 * Zeigt aktuellen wallet-balance + delta-since-yesterday-UTC. Wird
 * NUR gerendert wenn beide economy-flags ON sind (user.economyEnabled
 * && airline.economyEnabled) — diese gating-prüfung passiert im
 * caller (dashboard/page.tsx). Diese komponente selber prüft nicht
 * mehr, weil sie `userId` bekommt und keinen zugriff auf die airline-
 * relation hat (würde extra-query bedeuten).
 *
 * State-machine:
 *   - hasWallet=false → "Wallet wird beim nächsten Flug erstellt"
 *     (frisch-aktivierter user, noch kein approved PIREP gehabt).
 *     Balance + delta = 0 — wir zeigen das aber nicht prominent
 *     sondern als sub-text, damit der user nicht denkt "ich hab 0
 *     verdient" sondern "ich hab noch nicht angefangen".
 *
 *   - hasWallet=true && txCount=0 → theoretisch unmöglich (wallet
 *     wird nur bei approved-PIREP angelegt + erste tx gleichzeitig
 *     gebucht), aber defensive UI: zeige gleich wie hasWallet=false.
 *
 *   - hasWallet=true && txCount>0 → normaler stats-mode mit balance
 *     groß + delta klein darunter. Delta-color: green wenn positiv,
 *     red wenn negativ, gray wenn 0.
 *
 * Design-konvention: matched die anderen dashboard-sections (bg-white
 * dark:bg-gray-900, rounded-lg, border, p-6, h2 small-caps).
 */
export async function WalletCard({ userId }: Props) {
  const stats = await getUserWalletStats(userId);

  const hasActivity = stats.hasWallet && stats.txCount > 0;
  const deltaIsPositive = stats.deltaSinceYesterday.gt(0);
  const deltaIsNegative = stats.deltaSinceYesterday.lt(0);
  // eslint-disable-next-line no-nested-ternary
  const deltaColor = deltaIsPositive
    ? "text-green-600 dark:text-green-400"
    : deltaIsNegative
      ? "text-red-600 dark:text-red-400"
      : "text-gray-500 dark:text-gray-500";
  // eslint-disable-next-line no-nested-ternary
  const deltaArrow = deltaIsPositive ? "↑" : deltaIsNegative ? "↓" : "—";

  // Display-formatting: formatVamCurrency erwartet einen DecimalInput und
  // returned z.B. "1.234,56 VAM$". Für delta: absolute-value formatieren
  // (vorzeichen kommt durch arrow + farbe), sonst stünde da z.B.
  // "↑ -100,00 VAM$" was confusing wäre bei minus-vor-betrag-anzeige.
  const balanceFormatted = formatVamCurrency(stats.balance);
  const deltaAbs = stats.deltaSinceYesterday.abs();
  const deltaFormatted = formatVamCurrency(deltaAbs as Decimal);

  return (
    <section className="md:col-span-1 bg-white dark:bg-gray-900 rounded-lg p-6 border border-gray-200 dark:border-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm uppercase tracking-wider text-gray-500">
          Wallet
        </h2>
        <Link
          href="/wallet"
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
        >
          Details →
        </Link>
      </div>

      {hasActivity ? (
        <>
          <p className="text-2xl font-bold tabular-nums">{balanceFormatted}</p>
          <p className={`text-sm font-semibold mt-2 tabular-nums ${deltaColor}`}>
            {deltaArrow} {deltaFormatted}
            <span className="text-xs font-normal text-gray-500 dark:text-gray-500 ml-2">
              heute
            </span>
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold tabular-nums text-gray-400 dark:text-gray-600">
            {balanceFormatted}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            Dein Wallet wird beim nächsten approved PIREP automatisch
            erstellt — Salary, Revenue und Expenses werden dann
            gebucht.
          </p>
        </>
      )}
    </section>
  );
}
