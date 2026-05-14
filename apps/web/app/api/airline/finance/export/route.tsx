/**
 * Welle F / F3 — Airline-Finance-Export endpoint.
 *
 * GET /api/airline/finance/export?period=30d|90d|1y|all&format=pdf|csv
 *
 * Returns either a PDF binary (single-page A4 financial-report) or a
 * CSV stream of all transactions in the period. The PDF is for executive
 * summaries; the CSV is for analysis in Excel/Numbers/whatever.
 *
 * # Auth (3 layers, mirroring /airline/finance page)
 *
 *   1. auth() — session required
 *   2. role — must be in AIRLINE_MANAGER_ROLES + must belong to an airline
 *   3. economy — user.airline.economyEnabled must be true (otherwise
 *      finance-page itself isn't accessible, so export is moot)
 *
 * Returns JSON {error} with 401/403/404 codes for auth failures so
 * fetch-callers can render proper UI errors instead of redirects (which
 * downloads/file-saves can't follow).
 *
 * # Format negotiation
 *
 * `?format=pdf` (default) → application/pdf via @react-pdf/renderer
 *   buffer. Detail-list capped to 100 newest transactions; a truncation-
 *   note in the PDF points users to the CSV-export for the full history.
 * `?format=csv` → text/csv with the full unrestricted tx-list. Same
 *   columns as the wallet-page table: Date, Type, Category, Description,
 *   Amount, BalanceAfter. UTF-8 with BOM for Excel-compat.
 *
 * # Period
 *
 *  - 30d (default): now - 30d
 *  - 90d: now - 90d
 *  - 1y: now - 365d
 *  - all: new Date(0) — beginning of time
 *
 * Custom date-range (from/to ISO timestamps) deferred until UI calls for
 * it — the 4 presets cover ~95% of admin-use-cases.
 *
 * # Why route-handler and not server-action
 *
 * Same rationale as /api/pireps/[id]/logbook: server-actions return JSON
 * via RPC and can't stream binary responses. Browser-downloads need real
 * HTTP responses with proper Content-Type + Content-Disposition. Route-
 * handlers are the right primitive.
 *
 * # Performance
 *
 * PDF render: ~500ms cold, ~100-200ms warm. CSV build: ~50ms for 10k tx
 * (in-memory string concat — fine at this scale). No server-side cache;
 * each request is a fresh render. If high-volume usage ever materializes,
 * S3-cache via content-hash is the obvious next step.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  prisma,
  formatVamCurrency,
  getAirlineWalletExtended,
  getAirlineTransactions,
  type TransactionType,
} from '@vam/db';
import { isAirlineManagerRole } from '@/lib/roles';
import { TRANSACTION_TYPE_DISPLAY } from '@/app/wallet/tx-display';
import {
  FinanceReportPdf,
  type FinanceReportData,
} from '@/lib/finance/report-pdf';

type Period = '30d' | '90d' | '1y' | 'all';
type Format = 'pdf' | 'csv';

const PERIOD_LABELS: Record<Period, string> = {
  '30d': '30 Tage',
  '90d': '90 Tage',
  '1y': '1 Jahr',
  all: 'Gesamt',
};

function parsePeriod(raw: string | null): Period {
  if (raw === '90d' || raw === '1y' || raw === 'all') return raw;
  return '30d';
}

function parseFormat(raw: string | null): Format {
  return raw === 'csv' ? 'csv' : 'pdf';
}

function periodToSince(period: Period): Date {
  switch (period) {
    case '30d':
      return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    case '1y':
      return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    case 'all':
      return new Date(0);
  }
}

/** Escape a CSV field per RFC 4180. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: Request) {
  // ─── Auth layer 1 — session ────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }

  // ─── Auth layer 2 — role + airline membership ─────────────────────
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, airline: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User nicht gefunden.' }, { status: 404 });
  }
  if (!user.role || !isAirlineManagerRole(user.role.name)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }
  if (!user.airline) {
    return NextResponse.json(
      { error: 'Keine Airline zugeordnet.' },
      { status: 403 },
    );
  }

  // ─── Auth layer 3 — economy enabled ───────────────────────────────
  if (!user.airline.economyEnabled) {
    return NextResponse.json(
      { error: 'Economy nicht aktiviert für diese Airline.' },
      { status: 403 },
    );
  }

  // ─── Param parsing ────────────────────────────────────────────────
  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams.get('period'));
  const format = parseFormat(url.searchParams.get('format'));
  const since = periodToSince(period);
  const until = new Date();

  // ─── Data fetch ───────────────────────────────────────────────────
  // For PDF we cap detail at 100; for CSV we want the full list. We
  // fetch the full list once for CSV-path and aggregations, then slice
  // to 100 for the PDF detail-rows. With our scale (~10k tx max per
  // airline-year), the single fetch is fine — pagination would only
  // help at the >50k-tx scale.
  const [walletExt, txResult] = await Promise.all([
    getAirlineWalletExtended(user.airline.id),
    getAirlineTransactions(user.airline.id, {
      fromDate: since,
      toDate: until,
      take: 100000, // effectively unlimited for our scale
    }),
  ]);

  const allTx = txResult.rows;
  const totalTxCount = txResult.totalCount;

  // Compute aggregates in-memory from the full list. Single pass.
  // We exclude TRANSFER_IN/OUT from revenue/expense totals because
  // those are internal book-moves, not real revenue/expense. Easy to
  // re-include if needed — keep the toggle here visible.
  type TypeBucket = {
    count: number;
    sumPositive: number; // raw cents-ish (we use .toNumber() for sums)
    sumNegative: number; // absolute value
  };
  const byTypeMap = new Map<TransactionType, TypeBucket>();
  let revenueSum = 0;
  let expenseSum = 0; // absolute

  for (const tx of allTx) {
    const amount = Number(tx.amount); // Decimal → number; OK at our scale
    const existing = byTypeMap.get(tx.type) ?? {
      count: 0,
      sumPositive: 0,
      sumNegative: 0,
    };
    existing.count += 1;
    if (amount > 0) {
      existing.sumPositive += amount;
      // Only "real" inflows count as revenue (exclude TRANSFER_IN)
      if (tx.type !== 'TRANSFER_IN') {
        revenueSum += amount;
      }
    } else if (amount < 0) {
      existing.sumNegative += Math.abs(amount);
      if (tx.type !== 'TRANSFER_OUT') {
        expenseSum += Math.abs(amount);
      }
    }
    byTypeMap.set(tx.type, existing);
  }
  const netSum = revenueSum - expenseSum;

  // ─── CSV branch ───────────────────────────────────────────────────
  if (format === 'csv') {
    const header = [
      'Datum',
      'Typ',
      'Typ-Label',
      'Kategorie',
      'Beschreibung',
      'Betrag',
      'Saldo danach',
      'PIREP-ID',
      'Booking-ID',
    ].join(',');

    const lines: string[] = [header];
    for (const tx of allTx) {
      const typeInfo = TRANSACTION_TYPE_DISPLAY[tx.type];
      const dateIso = tx.createdAt.toISOString();
      lines.push(
        [
          csvEscape(dateIso),
          csvEscape(tx.type),
          csvEscape(typeInfo.label),
          csvEscape(tx.category),
          csvEscape(tx.description),
          csvEscape(tx.amount.toString()),
          csvEscape(tx.balanceAfter.toString()),
          csvEscape(tx.pirepId ?? ''),
          csvEscape(tx.bookingId ?? ''),
        ].join(','),
      );
    }

    // UTF-8 BOM for Excel (helps it auto-detect encoding for umlauts in
    // type-labels + descriptions). Without BOM, Excel often misreads
    // UTF-8 as latin-1.
    const csvBody = '\uFEFF' + lines.join('\r\n') + '\r\n';

    const filename = `finance-${user.airline.icao}-${period}.csv`;
    return new NextResponse(csvBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  }

  // ─── PDF branch ───────────────────────────────────────────────────
  const top100 = allTx.slice(0, 100);

  // Convert in-memory aggregations to PDF-data shape with proper currency
  // formatting. `formatVamCurrency` returns a string like "1,234.56 VAM"
  // (or german locale equivalent depending on the helper).
  const byType: FinanceReportData['byType'] = Array.from(byTypeMap.entries())
    .map(([type, bucket]) => ({
      type,
      typeLabel: TRANSACTION_TYPE_DISPLAY[type].label,
      count: bucket.count,
      // null when bucket has zero — PDF renders as "—" via ?? '—'.
      // Avoids visually-noisy "0,00 VAM$" cells in the rollup.
      sumPositive: bucket.sumPositive > 0 ? formatVamCurrency(bucket.sumPositive) : null,
      sumNegative: bucket.sumNegative > 0 ? formatVamCurrency(bucket.sumNegative) : null,
    }))
    // Sort by total-touches desc for natural reading order.
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.typeLabel.localeCompare(b.typeLabel),
    );

  const transactions: FinanceReportData['transactions'] = top100.map((tx) => {
    const amount = Number(tx.amount);
    return {
      id: tx.id,
      createdAt: tx.createdAt,
      type: tx.type,
      typeLabel: TRANSACTION_TYPE_DISPLAY[tx.type].label,
      category: tx.category,
      description: tx.description,
      // Show as signed value for context. formatVamCurrency on negative
      // returns e.g. "-250.00 VAM" so the sign is already there.
      amount: formatVamCurrency(amount),
      balanceAfter: formatVamCurrency(Number(tx.balanceAfter)),
      isInflow: amount > 0,
    };
  });

  const data: FinanceReportData = {
    airline: {
      name: user.airline.name,
      icao: user.airline.icao,
      iata: user.airline.iata,
    },
    period: {
      label: PERIOD_LABELS[period],
      from: since,
      to: until,
    },
    closingBalance: formatVamCurrency(Number(walletExt.balance)),
    totalRevenue: formatVamCurrency(revenueSum),
    totalExpenses: formatVamCurrency(expenseSum),
    totalNet:
      (netSum < 0 ? '-' : '') + formatVamCurrency(Math.abs(netSum)),
    totalTxCount,
    byType,
    transactions,
  };

  // Dynamic import for @react-pdf/renderer same as pirep-logbook route.
  // Avoids pulling the entire renderer into the cold-start bundle for
  // routes that don't call this endpoint.
  const { renderToBuffer } = await import('@react-pdf/renderer');
  const pdfBuffer = await renderToBuffer(<FinanceReportPdf data={data} />);

  const filename = `finance-${user.airline.icao}-${period}.pdf`;
  return new NextResponse(pdfBuffer as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBuffer.byteLength),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  });
}
