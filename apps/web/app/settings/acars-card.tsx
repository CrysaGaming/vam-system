'use client';

import { useEffect, useState, useTransition } from 'react';
import type { NetworkType } from '@vam/db';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  requestPairingCode,
  disconnectAcars,
  setPreferredNetwork,
  type AcarsStatus,
} from './acars-actions';

interface Props {
  initial: AcarsStatus;
  vatsimLinked: boolean;
  ivaoLinked: boolean;
}

/**
 * /settings ACARS card (Welle 9 commit 9D).
 *
 * Five sub-sections:
 *   1. Pairing-status header — "Connected" badge if paired-and-online,
 *      "Paired" if paired-but-offline (>30s since last heartbeat),
 *      "Not paired" if no token at all.
 *   2. Active flight info — only when isOnline AND we have a session
 *      (callsign + dep→arr + phase + simulator + client version).
 *   3. Pairing-code display — appears after user clicks "Pair Device".
 *      Shows the 9-char code in a chunky monospace block with a 15-min
 *      countdown. Disappears when consumed (paired flips to true) or
 *      expired (countdown hits 0).
 *   4. Pair / Disconnect button — switches based on `paired`.
 *   5. Preferred-network picker — segmented 3-button control. VATSIM/IVAO
 *      only enabled if the corresponding account is linked.
 *
 * Why the live `now`-tick: countdown + lastSeen-relative-time both need
 * to re-render once per second to feel alive. A single setInterval
 * driving a `now` state is cheaper than mounting two independent timers.
 *
 * Why no auto-refresh of `status`: when the user pairs the desktop-client
 * and starts flying, the card needs to reflect that. We don't poll —
 * router.refresh() after disconnect/pair-code-consumed would be one
 * approach, but for v1 the user can just hit reload. Polling could come
 * later if it's noticeably awkward.
 */
export function AcarsCard({ initial, vatsimLinked, ivaoLinked }: Props) {
  const [status] = useState<AcarsStatus>(initial);

  const [pairingCode, setPairingCode] = useState<{
    code: string;
    expiresAt: Date;
  } | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingPending, startPairing] = useTransition();

  const [disconnectPending, startDisconnect] = useTransition();
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [optimisticNetwork, setOptimisticNetwork] = useState<NetworkType>(
    status.preferredNetwork,
  );
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkPending, startNetworkChange] = useTransition();

  // Live `now`-tick for countdown + relative-time. Once per second is
  // smooth enough; we only mount the interval when there's something
  // time-sensitive to display (active code or paired status with a
  // recent last-seen).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function handlePair() {
    setPairingError(null);
    startPairing(async () => {
      try {
        const result = await requestPairingCode();
        setPairingCode({ code: result.code, expiresAt: result.expiresAt });
      } catch (err) {
        setPairingError(
          err instanceof Error ? err.message : 'Fehler beim Generieren',
        );
      }
    });
  }

  function handleDisconnect() {
    if (
      !window.confirm(
        'ACARS-Client trennen? Alle aktiven heartbeats vom client schlagen ab sofort fehl. Du kannst dich jederzeit neu pairen.',
      )
    ) {
      return;
    }
    setDisconnectError(null);
    startDisconnect(async () => {
      try {
        await disconnectAcars();
        setPairingCode(null);
        // Force a hard reload to pick up the new server state — the
        // status-prop is initial, so without a reload the card would
        // still show "paired".
        window.location.reload();
      } catch (err) {
        setDisconnectError(
          err instanceof Error ? err.message : 'Fehler beim Trennen',
        );
      }
    });
  }

  function handleNetworkChange(newNetwork: NetworkType) {
    if (newNetwork === optimisticNetwork || networkPending) return;
    const previous = optimisticNetwork;
    setOptimisticNetwork(newNetwork);
    setNetworkError(null);
    startNetworkChange(async () => {
      const result = await setPreferredNetwork({ network: newNetwork });
      if (!result.ok) {
        setOptimisticNetwork(previous);
        setNetworkError(result.error);
      }
    });
  }

  // Countdown for active pairing-code. When it reaches 0, auto-clear
  // so the card returns to "Pair Device" state without user action.
  const codeSecondsLeft = pairingCode
    ? Math.max(0, Math.floor((pairingCode.expiresAt.getTime() - now) / 1000))
    : 0;
  useEffect(() => {
    if (pairingCode && codeSecondsLeft === 0) {
      setPairingCode(null);
    }
  }, [pairingCode, codeSecondsLeft]);

  return (
    <section className="flex flex-col gap-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">
            ACARS-Client
          </h2>
          <StatusBadge paired={status.paired} isOnline={status.isOnline} />
        </div>
        <p className="text-sm text-muted-foreground">
          Eigene Desktop-App liest dein simulator-telemetrie und schickt sie
          an VAM. Foundation für auto-PIREPs, höhere live-tracking-präzision,
          und stream-overlay-quality. Pair-Code in der App eingeben —
          danach läuft alles automatisch.
        </p>
      </header>

      {/* ─── Active session info ──────────────────────────────────── */}
      {status.isOnline && status.activeSession && (
        <div className="space-y-2 rounded border border-green-500/30 bg-green-500/5 p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-green-700 dark:text-green-300">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
              Live im flug
            </div>
            {status.activeSession.currentPhase && (
              <span className="font-mono text-xs uppercase tracking-wider text-green-700 dark:text-green-300">
                {status.activeSession.currentPhase}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-foreground">
            {status.activeSession.callsign && (
              <Field
                label="Callsign"
                value={status.activeSession.callsign}
                mono
              />
            )}
            {(status.activeSession.departureIcao ||
              status.activeSession.arrivalIcao) && (
              <Field
                label="Route"
                value={`${status.activeSession.departureIcao ?? '???'} → ${status.activeSession.arrivalIcao ?? '???'}`}
                mono
              />
            )}
            {status.activeSession.aircraftRegistration && (
              <Field
                label="Aircraft"
                value={`${status.activeSession.aircraftRegistration}${
                  status.activeSession.aircraftType
                    ? ` · ${status.activeSession.aircraftType}`
                    : ''
                }`}
                mono
              />
            )}
            {status.activeSession.acarsSimulator && (
              <Field
                label="Sim"
                value={`${status.activeSession.acarsSimulator}${
                  status.activeSession.acarsClientVersion
                    ? ` · v${status.activeSession.acarsClientVersion}`
                    : ''
                }`}
                mono
              />
            )}
          </div>
        </div>
      )}

      {/* ─── Last-seen line for paired-but-offline case ───────────── */}
      {status.paired && !status.isOnline && status.lastSeenAt && (
        <p className="text-xs text-muted-foreground">
          Zuletzt gesehen: {formatRelativeTime(status.lastSeenAt, now)}
        </p>
      )}

      {/* ─── Pairing-code display ─────────────────────────────────── */}
      {pairingCode && (
        <div className="space-y-3 rounded border border-indigo-500/30 bg-indigo-500/5 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-xs uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              Pair-Code
            </div>
            <CountdownDisplay seconds={codeSecondsLeft} />
          </div>
          <div className="select-all py-3 text-center font-mono text-2xl font-bold tracking-[0.2em] sm:text-3xl">
            {pairingCode.code}
          </div>
          <p className="text-xs text-muted-foreground">
            In der ACARS-App: <strong>Pair Device</strong> klicken und diesen
            code eingeben. Code bleibt 15 minuten gültig.
          </p>
        </div>
      )}
      {pairingError && (
        <p className="text-xs text-red-600 dark:text-red-400">{pairingError}</p>
      )}

      {/* ─── Pair / Disconnect actions ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {!status.paired && !pairingCode && (
          <Button
            type="button"
            onClick={handlePair}
            disabled={pairingPending}
            className="bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700"
          >
            {pairingPending ? 'Generiere…' : 'Pair Device'}
          </Button>
        )}
        {!status.paired && pairingCode && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePair}
            disabled={pairingPending}
          >
            {pairingPending ? 'Generiere…' : 'Neuen code generieren'}
          </Button>
        )}
        {status.paired && (
          <Button
            type="button"
            variant="outline"
            onClick={handleDisconnect}
            disabled={disconnectPending}
            className="border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-400"
          >
            {disconnectPending ? 'Trenne…' : 'Trennen'}
          </Button>
        )}
        {status.paired && status.pairedAt && (
          <span className="text-xs text-muted-foreground">
            Gepaired am{' '}
            {new Date(status.pairedAt).toLocaleDateString('de-DE', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
      </div>
      {disconnectError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {disconnectError}
        </p>
      )}

      {/* ─── Preferred network ─────────────────────────────────────── */}
      <div className="space-y-2 border-t border-border pt-2">
        <div className="space-y-1">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
            Default-Network
          </h3>
          <p className="text-xs text-muted-foreground">
            Was die ACARS-App beim verbinden announct. VATSIM/IVAO brauchen
            verknüpften account (siehe Verbindungen-tab).
          </p>
        </div>
        <div
          className={cn(
            'inline-flex overflow-hidden rounded-md border border-input',
            networkPending && 'opacity-60',
          )}
          role="radiogroup"
          aria-label="Preferred network"
        >
          <NetworkButton
            value="Offline"
            label="Offline"
            current={optimisticNetwork}
            disabled={networkPending}
            onChange={handleNetworkChange}
          />
          <NetworkButton
            value="VATSIM"
            label="VATSIM"
            current={optimisticNetwork}
            disabled={networkPending || !vatsimLinked}
            onChange={handleNetworkChange}
            tone="blue"
            hint={!vatsimLinked ? 'Account nicht verknüpft' : undefined}
          />
          <NetworkButton
            value="IVAO"
            label="IVAO"
            current={optimisticNetwork}
            disabled={networkPending || !ivaoLinked}
            onChange={handleNetworkChange}
            tone="emerald"
            hint={!ivaoLinked ? 'Account nicht verknüpft' : undefined}
          />
        </div>
        {networkError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {networkError}
          </p>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────

function StatusBadge({
  paired,
  isOnline,
}: {
  paired: boolean;
  isOnline: boolean;
}) {
  if (!paired) {
    return (
      <Badge
        variant="outline"
        className="border-gray-500/30 bg-gray-500/15 text-gray-700 dark:text-gray-400"
      >
        Nicht gepaired
      </Badge>
    );
  }
  if (isOnline) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-green-500/30 bg-green-500/15 text-green-700 dark:text-green-400"
      >
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
        Online
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
    >
      Gepaired · offline
    </Badge>
  );
}

function CountdownDisplay({ seconds }: { seconds: number }) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  const isWarning = seconds < 60;
  return (
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        isWarning
          ? 'text-red-700 dark:text-red-400'
          : 'text-indigo-700 dark:text-indigo-300',
      )}
    >
      {seconds === 0
        ? 'abgelaufen'
        : `${min}:${sec.toString().padStart(2, '0')}`}
    </span>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={mono ? 'font-mono font-medium' : 'font-medium'}>
        {value}
      </div>
    </div>
  );
}

function NetworkButton({
  value,
  label,
  current,
  disabled,
  onChange,
  tone,
  hint,
}: {
  value: NetworkType;
  label: string;
  current: NetworkType;
  disabled: boolean;
  onChange: (n: NetworkType) => void;
  tone?: 'blue' | 'emerald';
  hint?: string;
}) {
  const isActive = current === value;
  const activeClasses =
    tone === 'blue'
      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40'
      : tone === 'emerald'
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
        : 'bg-muted text-foreground border-border';
  const inactiveClasses =
    'text-muted-foreground hover:bg-muted hover:text-foreground';

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      disabled={disabled}
      title={hint}
      onClick={() => onChange(value)}
      className={cn(
        'border-r border-input px-3 py-1.5 text-xs font-medium transition last:border-r-0 disabled:cursor-not-allowed',
        isActive ? activeClasses : inactiveClasses,
      )}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * "vor 5 sek", "vor 12 min", "vor 3 std", "vor 2 tagen".
 * Used for paired-but-offline last-seen line. Tick from parent re-renders
 * this on every second so it stays current.
 */
function formatRelativeTime(then: Date, nowMs: number): string {
  const deltaMs = nowMs - new Date(then).getTime();
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `vor ${sec} sek`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `vor ${hr} std`;
  const days = Math.floor(hr / 24);
  return `vor ${days} ${days === 1 ? 'tag' : 'tagen'}`;
}
