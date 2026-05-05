'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buyTrainingHours, withdrawEnrollment } from './actions';

interface Props {
  enrollmentId: string;
  hourlyRateGround: number;
  hourlyRateAir: number;
  hourlyRateSim: number | null;
  /** Aktueller wallet-balance des users zur visualisierung. */
  walletBalance: number;
}

/**
 * Hours-buying-form + withdraw-button für ein laufendes enrollment
 * (Welle 13E-12).
 *
 * Form-felder: theory, practical, sim hours (alle 0-50, default 0).
 * Live-cost-vorschau im footer: zeigt sum(hours × rate) und vergleicht
 * mit wallet-balance — pilot sieht VOR dem submit ob's reicht.
 *
 * Sim-input ist disabled wenn die schule keinen sim hat (rateSim=null) —
 * dann zeigen wir einen "—"-placeholder statt input.
 *
 * Withdraw-button ist als sekundär-action am footer mit confirm-prompt.
 */
export function EnrollmentManagement({
  enrollmentId,
  hourlyRateGround,
  hourlyRateAir,
  hourlyRateSim,
  walletBalance,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [hoursTheory, setHoursTheory] = useState('0');
  const [hoursPractical, setHoursPractical] = useState('0');
  const [hoursSim, setHoursSim] = useState('0');

  // Live-cost-calc. Treats invalid/empty input as 0 für defensive UX —
  // submit-button ist disabled bei sum=0 sodass der user es sowieso nicht
  // submitten kann.
  const t = parseFloat(hoursTheory) || 0;
  const p = parseFloat(hoursPractical) || 0;
  const s = parseFloat(hoursSim) || 0;
  const cost = t * hourlyRateGround + p * hourlyRateAir + s * (hourlyRateSim ?? 0);
  const sumHours = t + p + s;
  const canAfford = cost <= walletBalance;
  const canSubmit = sumHours > 0 && canAfford && !pending;

  function handleBuyHours(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        await buyTrainingHours({
          enrollmentId,
          hoursTheory: t,
          hoursPractical: p,
          hoursSim: s,
        });
        setSuccess(
          `${sumHours.toFixed(1)}h gebucht für ${cost.toFixed(2)} VAM$`,
        );
        setHoursTheory('0');
        setHoursPractical('0');
        setHoursSim('0');
        router.refresh();
        setTimeout(() => setSuccess(null), 5000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  }

  function handleWithdraw() {
    if (
      !confirm(
        'Enrollment wirklich abbrechen? Die bisher gezahlten Beträge werden NICHT erstattet.',
      )
    ) {
      return;
    }
    const reason = prompt('Grund für Abbruch (optional):') ?? '';
    setError(null);
    startTransition(async () => {
      try {
        await withdrawEnrollment({
          enrollmentId,
          reason: reason.trim() || null,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="px-3 py-2 rounded border bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="px-3 py-2 rounded border bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300 text-sm">
          ✓ {success}
        </div>
      )}

      <form onSubmit={handleBuyHours} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <HoursInput
            label="Theorie"
            value={hoursTheory}
            onChange={setHoursTheory}
            rate={hourlyRateGround}
            disabled={pending}
          />
          <HoursInput
            label="Flug"
            value={hoursPractical}
            onChange={setHoursPractical}
            rate={hourlyRateAir}
            disabled={pending}
          />
          {hourlyRateSim !== null ? (
            <HoursInput
              label="Sim"
              value={hoursSim}
              onChange={setHoursSim}
              rate={hourlyRateSim}
              disabled={pending}
            />
          ) : (
            <div>
              <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                Sim
              </label>
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded text-sm text-gray-400 italic">
                Nicht verfügbar
              </div>
            </div>
          )}
        </div>

        {/* Cost-summary */}
        <div className="px-4 py-3 rounded border bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              Gesamtkosten
            </span>
            <span className="font-mono font-semibold">
              {cost.toFixed(2)} VAM$
            </span>
          </div>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-500 mt-1">
            <span>Wallet-Balance</span>
            <span className="font-mono">{walletBalance.toFixed(2)} VAM$</span>
          </div>
          {!canAfford && cost > 0 && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">
              ⚠️ Nicht genug Geld. Fehlen {(cost - walletBalance).toFixed(2)} VAM$.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending
            ? 'Buchen…'
            : sumHours === 0
              ? 'Stunden eingeben'
              : `${sumHours.toFixed(1)}h buchen für ${cost.toFixed(2)} VAM$`}
        </button>
      </form>

      <div className="pt-3 border-t border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={pending}
          className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
        >
          Enrollment abbrechen (kein Refund)
        </button>
      </div>
    </div>
  );
}

function HoursInput({
  label,
  value,
  onChange,
  rate,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rate: number;
  disabled: boolean;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </label>
      <input
        type="number"
        min={0}
        max={50}
        step={0.5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-indigo-500 disabled:opacity-60"
      />
      <p className="text-[10px] text-gray-500 dark:text-gray-500 mt-0.5">
        {rate.toFixed(0)} VAM$/h
      </p>
    </div>
  );
}
