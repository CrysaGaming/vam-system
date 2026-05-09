/**
 * Track 4 #30 — GET /api/wallet/export
 *
 * Liefert die aktuelle Wallet-Tx-View als CSV-download (filter-aware).
 * Honored alle URL-params identisch zur /wallet-page (type, cat, from, to)
 * via shared parseWalletFilters-helper. Was der user in der UI sieht,
 * landet im download — keine semantischen abweichungen.
 *
 * # Auth + Gating
 *
 * Identisch zur Wallet-page: session required + economyEnabled muss
 * sowohl beim user als auch bei der airline ON sein. Bei !showWallet
 * wird 403 zurückgegeben (statt redirect wie bei der page) weil ein
 * download-endpoint kein sinnvolles fallback-rendering hat — der user
 * bekommt einen klaren error zurück.
 *
 * # Take-cap
 *
 * Wallet-page nutzt getUserTransactions mit take=PAGE_SIZE (25).
 * Hier nutzen wir prisma direkt mit take=10000 (sanity-cap). Der
 * 100-row-cap in getUserTransactions ist für die UI-pagination,
 * der Export-use-case will alle matching rows. 10000 ist großzügig
 * genug für years of activity bei gleichzeitig vernünftiger memory-
 * pressure (10k * ~200 bytes/row ≈ 2 MB, easy).
 *
 * # CSV-Format
 *
 * - Encoding: UTF-8 mit BOM (\\uFEFF) damit Excel das automatisch
 *   als UTF-8 erkennt — sonst zeigt Excel umlaute kaputt an.
 * - Separator: `;` (German-locale-default in Excel; comma würde mit
 *   den dezimal-trennern in formatVamCurrency kollidieren wenn man's
 *   reformatted, deshalb für DE-locale konsistenz).
 * - Quoting: RFC-4180-style — felder mit `;`/`"`/`\\n` werden in `"`
 *   gewrapped und embedded `"` zu `""` escaped.
 * - Datum: `YYYY-MM-DD HH:mm:ss` UTC. Klar lesbar in Excel und sortierbar.
 * - Beträge: plain decimal-string mit `.` als trenner. Kein VAM$-symbol
 *   (würde parsing brechen) — die spalte heißt "Betrag (VAM$)" damit
 *   die unit aus dem header klar ist.
 * - Spalten: Datum (UTC), Typ, Kategorie, Beschreibung, Betrag (VAM$),
 *   Balance (VAM$). German-headers matching die UI.
 *
 * # Filename
 *
 * `transactions-YYYY-MM-DD.csv` mit dem heutigen UTC-datum. So sehen
 * mehrere downloads im downloads-folder unterscheidbar aus statt
 * generic "export.csv".
 */

import { auth } from "@/auth";
import { prisma } from "@vam/db";
import { NextResponse } from "next/server";
import { TRANSACTION_TYPE_DISPLAY } from "../../../wallet/tx-display";
import { parseWalletFilters } from "../../../wallet/filters";

/**
 * RFC-4180-style CSV-field-escape. Wraps in `"` und escaped embedded
 * `"` zu `""` wenn das field eines der special-chars enthält.
 *
 * Conservative: wrappt auch wenn nur `;` drin ist. Excel rendert
 * gequotete und un-gequotete fields identisch, also kein UX-impact.
 */
function csvEscape(value: string): string {
  if (/[";\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Format a Date als CSV-readable UTC-timestamp: `YYYY-MM-DD HH:mm:ss`.
 *
 * Verwendet getUTC* statt toISOString() weil ISO mit `T` und `Z`
 * zwar kompakter ist aber in Excel weniger angenehm zu lesen ist.
 */
function formatCsvDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/**
 * YYYY-MM-DD UTC-string fürs Filename-stamping.
 */
function todayUtcStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: { select: { economyEnabled: true } } },
  });

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Gating: beide flags müssen ON sein (matched die page-semantik).
  // Im API-context geben wir 403 zurück — die page macht hier einen
  // redirect, aber CSV-download mit redirect wäre vom browser nicht
  // sinnvoll handlebar.
  const showWallet = !!(user.economyEnabled && user.airline?.economyEnabled);
  if (!showWallet) {
    return NextResponse.json(
      { error: "Economy ist nicht aktiviert" },
      { status: 403 },
    );
  }

  // Filter via shared parser (option #30): identische semantik zur
  // /wallet-page. Das URL-param-set ist 1:1 dasselbe — der UI-link
  // kopiert die filter direkt in die download-URL.
  const url = new URL(request.url);
  const { effectiveType, fromDate, toDate } = parseWalletFilters(
    url.searchParams,
  );

  // Wallet-lookup. Wenn der user noch keine wallet hat, gibt's nix
  // zu exportieren — leerer CSV mit nur dem header zurück.
  const wallet = await prisma.wallet.findFirst({
    where: {
      ownerType: "USER",
      ownerUserId: user.id,
      walletType: "primary",
    },
    select: { id: true },
  });

  // Build die transaction-query identisch zur getUserTransactions-
  // semantik aber ohne den 100-row-cap. Take=10000 als sanity-limit
  // damit ein bug oder ein angreifer nicht das ganze ledger zieht.
  // Real-world: ein aktiver pilot hat ~5-50 tx/monat, also reicht
  // 10000 für 16+ jahre kontinuierlicher activity.
  const TAKE_CAP = 10_000;
  const transactions = wallet
    ? await prisma.transaction.findMany({
        where: {
          walletId: wallet.id,
          // type: undefined wird von Prisma korrekt als "kein filter"
          // behandelt. Bei array → Prisma macht IN-clause. Bei single
          // string → exact match.
          ...(effectiveType !== undefined && {
            type: Array.isArray(effectiveType)
              ? { in: effectiveType }
              : effectiveType,
          }),
          ...((fromDate || toDate) && {
            createdAt: {
              ...(fromDate && { gte: fromDate }),
              ...(toDate && { lt: toDate }),
            },
          }),
        },
        orderBy: { createdAt: "desc" },
        take: TAKE_CAP,
      })
    : [];

  // CSV-aufbau. Header in deutsch + units im column-namen damit der
  // user die zahlen ohne extra-context interpretieren kann. Decimal-
  // werte via .toString() — Decimal serializes mit `.` als trenner
  // (default), kein VAM$-symbol, ready zum direkt-importieren in Excel
  // als zahl-spalte.
  const lines: string[] = [];
  lines.push(
    [
      "Datum (UTC)",
      "Typ",
      "Kategorie",
      "Beschreibung",
      "Betrag (VAM$)",
      "Balance (VAM$)",
    ]
      .map(csvEscape)
      .join(";"),
  );

  for (const tx of transactions) {
    const display = TRANSACTION_TYPE_DISPLAY[tx.type];
    lines.push(
      [
        formatCsvDateUtc(tx.createdAt),
        display.label,
        display.category,
        tx.description,
        tx.amount.toString(),
        tx.balanceAfter.toString(),
      ]
        .map(csvEscape)
        .join(";"),
    );
  }

  // BOM + CRLF-line-endings. CRLF ist RFC-4180-konform und Windows-
  // Excel-friendly. BOM ist der UTF-8-marker den Excel braucht um
  // umlaute korrekt zu interpretieren.
  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${todayUtcStamp()}.csv"`,
      // Kein cache: filter-state landet in der URL, jede unique-URL
      // entspricht einem unique export; cache wäre nur sinnvoll wenn
      // ein user dieselbe URL mehrmals fetched, aber das ist nicht
      // der typische flow.
      "Cache-Control": "no-store",
    },
  });
}
