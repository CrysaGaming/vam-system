/**
 * Welle F / F3 — Airline-Finance-Report PDF document.
 *
 * Single-page A4 financial-summary für eine airline über einen frei-
 * wählbaren zeitraum (30d/90d/1y/custom). Renderable serverside via
 * @react-pdf/renderer.renderToBuffer().
 *
 * # Layout (top to bottom)
 *
 * 1. Header-band: Airline-logo + name + ICAO + report-period
 * 2. KPI-grid (4-col): Opening-balance, total-revenue, total-expenses,
 *    closing-balance (with net-delta highlighted)
 * 3. Summary-by-category: stacked-table (category × type) showing
 *    revenue-streams + expense-streams aggregated by tx-type
 * 4. Detail-list (capped to top-100 transactions by date desc): date,
 *    type-label, description, amount, balance-after
 * 5. Footer: generated-at-timestamp + "VAM Finance Report"
 *
 * # Why @react-pdf/renderer
 *
 * Same rationale as pirep-logbook-pdf.tsx (which is the reference impl
 * for our PDF-stack). Deterministic A4 output, no font-registration
 * drama (uses Helvetica + Courier from base14), <100KB per report,
 * renderToBuffer is fine for our scale.
 *
 * # Truncation strategy
 *
 * If totalCount > 100, the detail-list shows top-100 newest + a
 * "+N weitere transactions" line at the bottom. For full history,
 * the user is pointed to the CSV-export. PDFs are for executive
 * summaries, CSVs are for analysis.
 */

import { Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import type { Transaction, TransactionType } from '@vam/db';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type FinanceReportData = {
  airline: {
    name: string;
    icao: string;
    iata: string | null;
  };
  period: {
    label: string; // human readable e.g. "30 Tage", "Q3 2026", "Gesamt"
    from: Date;
    to: Date;
  };
  /** Closing balance at end of period (= current balance). */
  closingBalance: string;
  /** Sum of inflows (positive amounts) in period. */
  totalRevenue: string;
  /** Sum of outflows (absolute |amount|) in period. */
  totalExpenses: string;
  /** Net = revenue - expenses. May be negative. */
  totalNet: string;
  /** Total tx-count in period (may exceed transactions.length when truncated). */
  totalTxCount: number;
  /**
   * Per-type rollup. Used for the "Summary by category" table.
   */
  byType: Array<{
    type: TransactionType;
    typeLabel: string; // human label from TRANSACTION_TYPE_DISPLAY
    count: number;
    /** Formatted sum of inflows for this type, or null if there were none (rendered as "—"). */
    sumPositive: string | null;
    /** Formatted absolute sum of outflows for this type, or null if there were none. */
    sumNegative: string | null;
  }>;
  /** Detail-list, capped to top-N by date desc. */
  transactions: Array<{
    id: string;
    createdAt: Date;
    type: TransactionType;
    typeLabel: string;
    category: string;
    description: string;
    amount: string; // formatted with sign
    balanceAfter: string;
    isInflow: boolean;
  }>;
};

// ─────────────────────────────────────────────────────────────────────
// Styles — keep it sober for a financial document. Black & white +
// subtle grays + a single accent for the airline-name. No emoji
// (PDF rendering of emoji is unreliable across viewers).
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 32,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#1a1a1a',
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    paddingBottom: 12,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  airlineName: { fontSize: 18, fontWeight: 'bold' },
  airlineIcao: { fontSize: 10, color: '#666666', marginTop: 2, fontFamily: 'Courier' },
  reportTitle: { fontSize: 14, fontWeight: 'bold' },
  periodLine: { fontSize: 9, color: '#666666', marginTop: 2 },

  kpiGrid: {
    flexDirection: 'row',
    marginBottom: 18,
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 4,
    padding: 8,
  },
  kpiLabel: { fontSize: 8, color: '#888888', textTransform: 'uppercase', marginBottom: 4 },
  kpiValue: { fontSize: 13, fontWeight: 'bold', fontFamily: 'Courier' },
  kpiValuePositive: { color: '#0a7a3e' },
  kpiValueNegative: { color: '#b81d24' },

  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 4,
    marginBottom: 6,
    paddingBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#dddddd',
  },

  table: { marginBottom: 14 },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#cccccc',
    paddingBottom: 4,
    marginBottom: 2,
  },
  tableHeaderCell: { fontSize: 8, color: '#666666', textTransform: 'uppercase', fontWeight: 'bold' },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f0f0f0',
  },
  tableCell: { fontSize: 9 },
  tableCellRight: { fontSize: 9, textAlign: 'right' },
  tableCellMono: { fontSize: 9, fontFamily: 'Courier' },
  tableCellMonoRight: { fontSize: 9, fontFamily: 'Courier', textAlign: 'right' },

  amountPositive: { color: '#0a7a3e', fontFamily: 'Courier' },
  amountNegative: { color: '#b81d24', fontFamily: 'Courier' },

  truncationNote: {
    fontSize: 8,
    color: '#888888',
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
  },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: '#dddddd',
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: '#999999',
  },
});

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function fmtDateTime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────────────

export function FinanceReportPdf({ data }: { data: FinanceReportData }) {
  const isProfit = !data.totalNet.startsWith('-');

  return (
    <Document
      title={`${data.airline.icao} Finance Report ${data.period.label}`}
      author="VAM System"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.airlineName}>{data.airline.name}</Text>
              <Text style={styles.airlineIcao}>
                {data.airline.icao}
                {data.airline.iata ? ` / ${data.airline.iata}` : ''}
              </Text>
            </View>
            <View>
              <Text style={styles.reportTitle}>Finanzbericht</Text>
              <Text style={styles.periodLine}>
                {data.period.label} · {fmtDate(data.period.from)} – {fmtDate(data.period.to)}
              </Text>
            </View>
          </View>
        </View>

        {/* KPIs */}
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Einnahmen</Text>
            <Text style={[styles.kpiValue, styles.kpiValuePositive]}>{data.totalRevenue}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Ausgaben</Text>
            <Text style={[styles.kpiValue, styles.kpiValueNegative]}>−{data.totalExpenses}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Netto</Text>
            <Text style={[styles.kpiValue, isProfit ? styles.kpiValuePositive : styles.kpiValueNegative]}>
              {data.totalNet}
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Endsaldo</Text>
            <Text style={styles.kpiValue}>{data.closingBalance}</Text>
          </View>
        </View>

        {/* Summary by category */}
        <Text style={styles.sectionTitle}>Aufschlüsselung nach Typ</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Typ</Text>
            <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Anzahl</Text>
            <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Einnahmen</Text>
            <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Ausgaben</Text>
          </View>
          {data.byType.length === 0 ? (
            <Text style={[styles.tableCell, { padding: 4, color: '#888888', textAlign: 'center' }]}>
              Keine Transaktionen im Zeitraum.
            </Text>
          ) : (
            data.byType.map((t) => (
              <View key={t.type} style={styles.tableRow}>
                <Text style={[styles.tableCell, { flex: 3 }]}>{t.typeLabel}</Text>
                <Text style={[styles.tableCellRight, { flex: 1 }]}>{t.count}</Text>
                <Text style={[styles.tableCellMonoRight, { flex: 2 }, styles.amountPositive]}>
                  {t.sumPositive ?? '—'}
                </Text>
                <Text style={[styles.tableCellMonoRight, { flex: 2 }, styles.amountNegative]}>
                  {t.sumNegative ?? '—'}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Detail list */}
        <Text style={styles.sectionTitle}>
          Transaktionen (neueste zuerst, max. {data.transactions.length})
        </Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Datum</Text>
            <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Typ</Text>
            <Text style={[styles.tableHeaderCell, { flex: 5 }]}>Beschreibung</Text>
            <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Betrag</Text>
            <Text style={[styles.tableHeaderCell, { flex: 2, textAlign: 'right' }]}>Saldo</Text>
          </View>
          {data.transactions.length === 0 ? (
            <Text style={[styles.tableCell, { padding: 4, color: '#888888', textAlign: 'center' }]}>
              Keine Transaktionen im Zeitraum.
            </Text>
          ) : (
            data.transactions.map((tx) => (
              <View key={tx.id} style={styles.tableRow}>
                <Text style={[styles.tableCellMono, { flex: 2 }]}>{fmtDate(tx.createdAt)}</Text>
                <Text style={[styles.tableCell, { flex: 3 }]}>{tx.typeLabel}</Text>
                <Text style={[styles.tableCell, { flex: 5 }]}>{tx.description}</Text>
                <Text
                  style={[
                    styles.tableCellMonoRight,
                    { flex: 2 },
                    tx.isInflow ? styles.amountPositive : styles.amountNegative,
                  ]}
                >
                  {tx.amount}
                </Text>
                <Text style={[styles.tableCellMonoRight, { flex: 2 }]}>{tx.balanceAfter}</Text>
              </View>
            ))
          )}
          {data.totalTxCount > data.transactions.length && (
            <Text style={styles.truncationNote}>
              + {data.totalTxCount - data.transactions.length} weitere Transaktionen — vollständige
              Liste via CSV-Export verfügbar
            </Text>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>VAM System · Finanzbericht</Text>
          <Text>Erstellt: {fmtDateTime(new Date())} UTC</Text>
        </View>
      </Page>
    </Document>
  );
}

// Make Transaction-type referenceable so route-handler can import the
// shape without pulling react-pdf into its module-graph.
export type { Transaction };
