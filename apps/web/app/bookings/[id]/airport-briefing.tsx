import { getAirportBriefing, type AirportBriefing } from '@vam/db';

/**
 * Track 5 #19 (Section D) — Airport-Briefing UI.
 *
 * Server-component die für DEP+ARR jeweils eine briefing-spalte rendert,
 * inkl. runways, ATC-frequencies, ILS-approach-aids. Direkt nach dem
 * AlternatePicker eingebunden — der pilot hat dann alle pre-flight-
 * infos in einer logischen reihenfolge: weather → alternates → briefing.
 *
 * # Conditional rendering
 *
 *   - Beide briefings null → section komplett hidden (z.B. obscure ICAOs
 *     ohne ourAirports-detaildaten)
 *   - Eine seite null → placeholder mit "keine briefing-daten" + ICAO
 *   - Per-sektion empty (z.B. 0 runways) → sub-section hidden, not
 *     placeholdered (sparse-row UX > redundant "keine RWYs"-rows)
 *
 * # Performance
 *
 * Promise.all über beide briefings parallel — 8 DB-queries total
 * (4 pro briefing) aber alle auf 1 roundtrip-batch zusammen. <100ms typisch.
 *
 * # Why no client interactivity?
 *
 * Pure read-only display. Pilot will die info sehen + ggf. copy-pasten
 * in MCDU/PFD. Keine sort/filter UI nötig (V2 wenn jemand 20+ frequencies
 * an mega-hubs sehen will).
 */

const FREQ_TYPE_LABELS: Record<string, string> = {
  ATIS: 'ATIS',
  INFO: 'INFO',
  AFIS: 'AFIS',
  FSS: 'FSS',
  CLEARANCE: 'DEL',
  GND: 'GND',
  TWR: 'TWR',
  CTAF: 'CTAF',
  RADIO: 'RADIO',
  DEP: 'DEP',
  APP: 'APP',
  RADAR: 'RADAR',
};

function freqLabel(type: string): string {
  return FREQ_TYPE_LABELS[type] ?? type;
}

function formatLength(ft: number | null): string {
  if (ft === null) return '—';
  const m = Math.round(ft * 0.3048);
  return `${ft.toLocaleString('en-US')}ft / ${m.toLocaleString('de-DE')}m`;
}

export async function AirportBriefingCard({
  departureIcao,
  arrivalIcao,
}: {
  departureIcao: string;
  arrivalIcao: string;
}) {
  const [dep, arr] = await Promise.all([
    getAirportBriefing(departureIcao),
    getAirportBriefing(arrivalIcao),
  ]);

  // Falls beide null sind → section hidden (selten, würde nur passieren
  // wenn OurAirports-detail-import für beide airports nicht durchlief)
  if (!dep && !arr) return null;

  return (
    <section className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wider text-gray-500 font-semibold">
          📋 Airport-Briefing
        </h2>
        <p className="text-[10px] text-gray-400">
          RWYs · Frequencies · ILS · aus OurAirports
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BriefingColumn briefing={dep} fallbackIcao={departureIcao} />
        <BriefingColumn briefing={arr} fallbackIcao={arrivalIcao} />
      </div>

      <p className="text-[10px] text-gray-400 mt-3">
        Statische daten aus OurAirports — keine NOTAMs/temporary changes.
        Verifiziere für ACTIVE-ops immer aktuelle AIP + ATIS.
      </p>
    </section>
  );
}

function BriefingColumn({
  briefing,
  fallbackIcao,
}: {
  briefing: AirportBriefing | null;
  fallbackIcao: string;
}) {
  if (!briefing) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-md p-3">
        <p className="font-mono font-bold text-base text-gray-900 dark:text-gray-100">
          {fallbackIcao}
        </p>
        <p className="text-xs text-gray-400 italic mt-1">
          Keine briefing-daten verfügbar
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-3">
      {/* Header: ICAO + name + elevation */}
      <div>
        <p className="font-mono font-bold text-base text-gray-900 dark:text-gray-100">
          {briefing.icao}
          {briefing.airportName && (
            <span className="font-sans font-normal text-xs text-gray-500 ml-2">
              {briefing.airportName}
            </span>
          )}
        </p>
        <p className="text-[10px] text-gray-500 mt-0.5">
          {briefing.city && <>{briefing.city} · </>}
          {briefing.country}
          {briefing.elevationFt !== null && (
            <>
              {' '}· Elev{' '}
              <span className="font-mono">
                {briefing.elevationFt.toLocaleString('en-US')}ft
              </span>
            </>
          )}
        </p>
      </div>

      {/* Runways */}
      {briefing.runways.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5 font-semibold">
            🛬 Runways ({briefing.runways.length})
          </p>
          <ul className="space-y-1">
            {briefing.runways.map((rwy) => (
              <li
                key={rwy.ident}
                className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-300"
              >
                <span className="font-mono font-bold w-16 shrink-0">
                  {rwy.ident}
                </span>
                <span className="font-mono tabular-nums text-gray-600 dark:text-gray-400 flex-1">
                  {formatLength(rwy.lengthFt)}
                </span>
                {rwy.surface && (
                  <span className="text-[10px] uppercase text-gray-500">
                    {rwy.surface}
                  </span>
                )}
                {rwy.lighted && (
                  <span title="Lighted">✦</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Frequencies */}
      {briefing.frequencies.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5 font-semibold">
            📻 Frequencies
          </p>
          <ul className="space-y-1">
            {briefing.frequencies.map((f, i) => (
              <li
                key={`${f.type}-${f.frequencyMhz}-${i}`}
                className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-300"
              >
                <span className="font-mono font-bold w-12 shrink-0 text-indigo-600 dark:text-indigo-400">
                  {freqLabel(f.type)}
                </span>
                <span className="font-mono tabular-nums w-16 shrink-0">
                  {f.frequencyMhz.toFixed(3)}
                </span>
                {f.description && (
                  <span className="text-[10px] text-gray-500 truncate">
                    {f.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ILS Navaids */}
      {briefing.ilsNavaids.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5 font-semibold">
            📡 ILS ({briefing.ilsNavaids.length})
          </p>
          <ul className="space-y-1">
            {briefing.ilsNavaids.map((n) => (
              <li
                key={n.ident}
                className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-300"
              >
                <span className="font-mono font-bold w-12 shrink-0 text-amber-700 dark:text-amber-400">
                  {n.ident}
                </span>
                {n.frequencyMhz !== null && (
                  <span className="font-mono tabular-nums w-16 shrink-0">
                    {n.frequencyMhz.toFixed(3)}
                  </span>
                )}
                <span className="text-[10px] text-gray-500 truncate">
                  {n.name}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Empty-state fallback wenn ALLE drei sektionen leer sind
          (sehr selten, würde z.B. bei einem airfield ohne OurAirports-
          detail-daten vorkommen). */}
      {briefing.runways.length === 0 &&
        briefing.frequencies.length === 0 &&
        briefing.ilsNavaids.length === 0 && (
          <p className="text-[10px] text-gray-400 italic">
            Keine RWY/Freq/Navaid-daten verfügbar
          </p>
        )}
    </div>
  );
}
