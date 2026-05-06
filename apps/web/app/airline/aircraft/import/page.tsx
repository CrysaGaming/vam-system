import { prisma } from '@vam/db';
import { requireAirlineManagerWithAirlinePage } from '@/lib/roles';
import Link from 'next/link';
import { ImportForm } from './import-form';

/**
 * /airline/aircraft/import — CSV-bulk-import für aircraft (Welle 6 commit
 * 6A-3). Server-component macht nur auth-gate; das eigentliche upload/parse/
 * preview/confirm-flow lebt in der ImportForm client-component weil
 * filesystem-API + UI-state nur client-side existieren.
 *
 * Pattern analog zu /airline/routes/import — selber 2-step flow (upload →
 * preview → confirm) und identische CSV-parser-implementation. Die
 * unterschiede:
 *  - 4 spalten statt 7 (registration, type, home_icao, status)
 *  - Aircraft-type catalog-resolve passiert serverside (CSV-spalte
 *    bleibt ein simpler ICAO-string, hybrid-fallback wenn nicht im catalog)
 *  - Dedup auf registration global (nicht pro-airline) weil
 *    Aircraft.registration ist global @unique
 */
export default async function ImportAircraftPage() {
  const user = await requireAirlineManagerWithAirlinePage();
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/airline/aircraft"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              ← Zurück zur Aircraft-Verwaltung
            </Link>
            <h1 className="text-3xl font-bold tracking-tight mt-2">
              CSV-Import: Aircraft
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Importiere mehrere aircraft auf einmal aus einer CSV-datei.
              Maximal 500 aircraft pro datei.
            </p>
          </div>
          <a
            href="/templates/aircraft-import-template.csv"
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
                  href="/templates/aircraft-import-template.csv"
                  download
                  className="text-indigo-600 dark:text-indigo-400 underline"
                >
                  Template-CSV
                </a>{' '}
                herunter. Sie enthält alle pflicht- und optionalen spalten
                mit beispielzeilen einer fictional flotte (Boeing 737s,
                A320neos, A350s). Öffne sie in Excel, Google Sheets,
                LibreOffice Calc oder einem text-editor.
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
                        registration
                      </td>
                      <td className="py-2 pr-4 text-red-600 dark:text-red-400">
                        ✓ Pflicht
                      </td>
                      <td className="py-2">
                        Aircraft-Registration (z.B. D-AIBC, N12345,
                        G-XBJB). 2-10 zeichen, A-Z + 0-9 + Bindestrich.
                        Muss global einmalig sein — wenn die registration
                        bereits in deiner oder einer anderen airline
                        existiert, wird die zeile übersprungen.
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        type
                      </td>
                      <td className="py-2 pr-4 text-red-600 dark:text-red-400">
                        ✓ Pflicht
                      </td>
                      <td className="py-2">
                        ICAO type-code (3-4 zeichen, z.B. B738, A20N,
                        A359, CRJ9). Wenn der type im{' '}
                        <Link
                          href="/aircraft-types"
                          className="text-indigo-600 dark:text-indigo-400 underline"
                        >
                          Aircraft-Type-Catalog
                        </Link>{' '}
                        existiert, wird das Aircraft automatisch
                        verlinkt (für Specs wie Range, Capacity).
                        Sonst wird der text als Free-Text gespeichert.
                      </td>
                    </tr>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        home_icao
                      </td>
                      <td className="py-2 pr-4 text-gray-500">Optional</td>
                      <td className="py-2">
                        Home-Hub des aircraft (4-zeichen ICAO, z.B.
                        EDDF). Muss im Airport-Catalog existieren und
                        active=true sein. Leer lassen wenn das aircraft
                        keinem festen hub zugeordnet ist.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 font-mono text-indigo-600 dark:text-indigo-400">
                        status
                      </td>
                      <td className="py-2 pr-4 text-gray-500">Optional</td>
                      <td className="py-2">
                        Status: <code>ACTIVE</code>, <code>MAINTENANCE</code>,{' '}
                        <code>STORED</code> oder <code>RETIRED</code>.
                        Default: <code>ACTIVE</code>. Akzeptiert auch
                        deutsche aliasses (aktiv, wartung, eingelagert,
                        außer dienst).
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
                <li>Bearbeite die zeilen mit deiner flotte</li>
                <li>
                  <strong>Datei → Speichern unter</strong>
                </li>
                <li>
                  Wähle dateityp:{' '}
                  <strong>CSV UTF-8 (durch trennzeichen getrennt) (*.csv)</strong>
                </li>
                <li>
                  ⚠️ <strong>Wichtig:</strong> Nicht das normale &ldquo;CSV
                  (Trennzeichen-getrennt)&rdquo; wählen — das nutzt windows-1252
                  encoding und macht umlaute kaputt.
                </li>
              </ol>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                4. Hochladen und prüfen
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Nach dem upload zeigen wir dir eine vorschau-tabelle mit
                allen zeilen. Beim klick auf{' '}
                <strong>Importieren</strong> wird jede zeile validiert
                und als{' '}
                <span className="text-green-600 dark:text-green-400 font-semibold">
                  ✓ angelegt
                </span>
                ,{' '}
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  ⚠ skip
                </span>{' '}
                (bereits vorhanden) oder{' '}
                <span className="text-red-600 dark:text-red-400 font-semibold">
                  ✗ fehler
                </span>{' '}
                markiert. Fehlerhafte zeilen werden übersprungen, valide
                werden importiert.
              </p>
            </section>

            <section>
              <h3 className="font-semibold text-base mb-2">
                5. Häufige fehler
              </h3>
              <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 leading-relaxed">
                <li>
                  <strong>&ldquo;Airport nicht im Catalog&rdquo;</strong> — Tippfehler
                  im home_icao. EDDF ≠ EDFF. Lass das feld leer wenn
                  unsicher.
                </li>
                <li>
                  <strong>&ldquo;Registration ungültig&rdquo;</strong> — Format ist
                  2-10 zeichen, nur A-Z 0-9 und bindestriche. Leerzeichen
                  sind nicht erlaubt.
                </li>
                <li>
                  <strong>&ldquo;Existiert bereits in deiner Flotte&rdquo;</strong>{' '}
                  — Diese registration ist schon angelegt. Wird
                  übersprungen, kein fehler.
                </li>
                <li>
                  <strong>&ldquo;Existiert bereits bei anderer Airline&rdquo;</strong>{' '}
                  — Aircraft-registrations sind global eindeutig (eine
                  echte D-AIBC kann nicht zwei airlines gehören). Falls
                  dein Aircraft denselben tail wie eine andere airline
                  hat, wähle eine eindeutige fiction-registration.
                </li>
                <li>
                  <strong>&ldquo;Status ungültig&rdquo;</strong> — Nur ACTIVE,
                  MAINTENANCE, STORED, RETIRED (oder lowercase/deutsche
                  varianten). &ldquo;Active&rdquo; und &ldquo;aktiv&rdquo; gehen,
                  &ldquo;in_betrieb&rdquo; nicht.
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
