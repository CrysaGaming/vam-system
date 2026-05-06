import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { ImportForm } from './import-form';

/**
 * /airline/routes/import — CSV-bulk-import für routes. Server-component
 * macht nur auth-gate; das eigentliche upload/parse/preview/confirm-
 * flow lebt in der ImportForm client-component weil filesystem-API + UI-
 * state nur client-side existieren.
 *
 * Layout:
 *  - Anleitung-section oben (collapsible — defaults open beim ersten
 *    besuch, user kann zuklappen wenn er die anleitung kennt)
 *  - Template-download als prominent-button
 *  - File-upload-zone darunter
 *  - Preview-tabelle nach upload
 *  - Confirm-button + result-screen nach insert
 *
 * Anleitung ist absichtlich inline (statt /docs page) weil der admin
 * sie genau hier braucht — context-switching zu einer separaten doc-
 * seite und zurück ist friction. Lange anleitung wird durch <details>
 * aufgeklappt nur wenn gewünscht.
 */
export default async function ImportRoutesPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/airline/routes"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Zurück zur Routen-Verwaltung
            </Link>
            <h1 className="text-3xl font-bold tracking-tight mt-2">
              CSV-Import: Routes
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Importiere mehrere routes auf einmal aus einer CSV-datei.
              Maximal 500 routes pro datei.
            </p>
          </div>
          <a
            href="/templates/routes-import-template.csv"
            download
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition"
          >
            📥 Template herunterladen
          </a>
        </div>

        {/* Anleitung — collapsible, defaults open */}
        <details
          open
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-sm"
        >
          <summary className="cursor-pointer px-6 py-4 font-semibold text-lg select-none hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-t-xl">
            📖 Anleitung — so funktioniert der CSV-Import
          </summary>
          <div className="px-6 pb-6 space-y-5 text-sm">
            <section>
              <h3 className="font-semibold text-base mb-2">
                1. Template herunterladen
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Lade die{' '}
                <a
                  href="/templates/routes-import-template.csv"
                  download
                  className="text-indigo-600 dark:text-indigo-400 underline"
                >
                  Template-CSV
                </a>{' '}
                herunter. Sie enthält alle pflicht- und optionalen spalten
                mit beispielzeilen einer fictional airline. Öffne sie in
                Excel, Google Sheets, LibreOffice Calc oder einem
                text-editor.
              </p>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                2. Spalten erklärung
              </h3>
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 pr-4 font-semibold">
                        Spalte
                      </th>
                      <th className="text-left py-2 pr-4 font-semibold">
                        Pflicht?
                      </th>
                      <th className="text-left py-2 font-semibold">
                        Beschreibung
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-600 dark:text-gray-400">
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        flight_number
                      </td>
                      <td className="py-2 pr-4 text-red-600 dark:text-red-400">
                        ✓ Pflicht
                      </td>
                      <td className="py-2">
                        Flugnummer (z.B. KK101). Format: 2-3 buchstaben +
                        1-4 zahlen + optional 1 buchstabe. Muss innerhalb
                        deiner airline einmalig sein.
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        departure_icao
                      </td>
                      <td className="py-2 pr-4 text-red-600 dark:text-red-400">
                        ✓ Pflicht
                      </td>
                      <td className="py-2">
                        ICAO-code des abflughafens (4 zeichen, z.B. LSZH
                        für Zürich). IATA-code (FRA) wird auch akzeptiert,
                        aber ICAO ist eindeutiger.
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        arrival_icao
                      </td>
                      <td className="py-2 pr-4 text-red-600 dark:text-red-400">
                        ✓ Pflicht
                      </td>
                      <td className="py-2">
                        ICAO-code des zielflughafens. Muss anders sein als
                        departure_icao.
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        aircraft_type
                      </td>
                      <td className="py-2 pr-4 text-gray-500">Optional</td>
                      <td className="py-2">
                        ICAO type-code des fluggeräts (3-4 zeichen, z.B.
                        B738 für Boeing 737-800, A20N für A320neo, A359
                        für A350-900). Pilot kann eigene livery nutzen —
                        wir tracken nur den typ.
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        estimated_minutes
                      </td>
                      <td className="py-2 pr-4 text-gray-500">Optional</td>
                      <td className="py-2">
                        Geschätzte flugzeit in minuten. Wenn leer:
                        auto-berechnet aus distanz (450 kt cruise + 25 min
                        taxi/climb/descent overhead).
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        distance_nm
                      </td>
                      <td className="py-2 pr-4 text-gray-500">Optional</td>
                      <td className="py-2">
                        Distanz in nautical miles. Wenn leer:
                        auto-berechnet aus airport-koordinaten via
                        haversine-formel.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        active
                      </td>
                      <td className="py-2 pr-4 text-gray-500">Optional</td>
                      <td className="py-2">
                        Ob die route aktiv ist. Default: <code>true</code>.
                        Akzeptiert: true/false, 1/0, ja/nein, yes/no,
                        wahr/falsch, aktiv.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                3. CSV in Excel speichern
              </h3>
              <ol className="list-decimal list-inside space-y-1 text-gray-600 dark:text-gray-400 leading-relaxed">
                <li>Bearbeite die zeilen mit deinen routes</li>
                <li>
                  <strong>Datei → Speichern unter</strong>
                </li>
                <li>
                  Wähle dateityp:{' '}
                  <strong>CSV UTF-8 (durch trennzeichen getrennt) (*.csv)</strong>
                </li>
                <li>
                  ⚠️ <strong>Wichtig:</strong> Nicht das normale "CSV
                  (Trennzeichen-getrennt)" wählen — das nutzt windows-1252
                  encoding und macht umlaute/sonderzeichen kaputt.
                </li>
              </ol>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                4. Hochladen und prüfen
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Nach dem upload zeigen wir dir eine vorschau-tabelle mit
                allen zeilen. Jede zeile ist als{' '}
                <span className="text-green-600 dark:text-green-400 font-semibold">
                  ✓ valide
                </span>
                ,{' '}
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  ⚠ skip
                </span>{' '}
                (bereits vorhanden) oder{' '}
                <span className="text-red-600 dark:text-red-400 font-semibold">
                  ✗ fehler
                </span>{' '}
                markiert. Du kannst dann bestätigen — nur valide zeilen
                werden importiert, fehlerhafte übersprungen.
              </p>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                5. Häufige fehler
              </h3>
              <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 leading-relaxed">
                <li>
                  <strong>"Airport nicht gefunden"</strong> — Tippfehler
                  im ICAO-code. LSZH ≠ LSHZ. Prüfe via{' '}
                  <a
                    href="https://www.world-airport-codes.com/"
                    className="text-indigo-600 dark:text-indigo-400 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    world-airport-codes.com
                  </a>
                  .
                </li>
                <li>
                  <strong>"Flugnummer ungültig"</strong> — Format ist 2-3
                  buchstaben + 1-4 zahlen. KK1 ist zu kurz, KKK12345 zu
                  lang.
                </li>
                <li>
                  <strong>Umlaute/Sonderzeichen kaputt</strong> — CSV mit
                  UTF-8 encoding speichern (siehe schritt 3).
                </li>
                <li>
                  <strong>"Existiert bereits"</strong> — Diese flight-
                  number ist schon in deiner airline angelegt. Wird
                  übersprungen, kein fehler.
                </li>
              </ul>
            </section>
          </div>
        </details>

        {/* Upload-form */}
        <ImportForm />
      </div>
    </main>
  );
}
