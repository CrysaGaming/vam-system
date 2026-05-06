'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import { rotateOverlayToken } from './actions';

export function OverlayCard({ token: initialToken }: { token: string }) {
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const overlayUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/overlay/${token}`
      : `https://vam.kevindrack.de/overlay/${token}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    try {
      const newToken = await rotateOverlayToken();
      setToken(newToken);
      setShowConfirm(false);
    } catch (err) {
      console.error('Rotate failed:', err);
      alert('Fehler beim Token-Rotate');
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* URL-Anzeige */}
      <div>
        <Label
          htmlFor="overlay-url"
          className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground"
        >
          Deine Overlay-URL
        </Label>
        <div className="flex gap-2">
          <Input
            id="overlay-url"
            type="text"
            readOnly
            value={overlayUrl}
            className="flex-1 select-all font-mono"
            onClick={(e) => e.currentTarget.select()}
          />
          <Button
            type="button"
            onClick={handleCopy}
            className={cn(
              copied
                ? 'bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700',
            )}
          >
            {copied ? '✓ Kopiert' : 'Kopieren'}
          </Button>
        </div>
      </div>

      {/* OBS-Anleitung */}
      <details className="rounded bg-muted/50 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          📋 So fügst du das Overlay in OBS ein
        </summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>OBS öffnen, in deine Szene wechseln</li>
          <li>
            Im Bereich <strong>Quellen</strong> auf das <strong>+</strong>{' '}
            klicken
          </li>
          <li>
            <strong>Browser</strong> auswählen, Name vergeben (z.B. &quot;VAM
            Live&quot;)
          </li>
          <li>URL einfügen (oben kopieren)</li>
          <li>
            Breite: <strong>1920</strong>, Höhe: <strong>1080</strong>
          </li>
          <li>
            Bei <strong>Eigene CSS</strong> nichts hinzufügen — Overlay ist
            transparent
          </li>
          <li>OK klicken — die Live-Bar erscheint oben im Bild</li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          💡 Das Overlay zeigt nur Daten wenn du gerade aktiv auf VATSIM/IVAO
          fliegst.
        </p>
      </details>

      {/* Token-Rotation */}
      <div className="border-t border-border pt-4">
        {!showConfirm ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowConfirm(true)}
            className="text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
          >
            🔄 Token zurücksetzen (alte URL wird ungültig)
          </Button>
        ) : (
          <Alert
            variant="destructive"
            className="border-red-500/30 bg-red-500/10"
          >
            <AlertDescription className="text-red-700 dark:text-red-300">
              <p className="mb-3 text-sm">
                <strong>Token wirklich zurücksetzen?</strong>
                <br />
                <span className="text-xs">
                  Die aktuelle URL wird ungültig. Du musst die neue URL in OBS
                  aktualisieren.
                </span>
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRotate}
                  disabled={rotating}
                  className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
                >
                  {rotating ? 'Wird zurückgesetzt...' : 'Ja, zurücksetzen'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowConfirm(false)}
                  disabled={rotating}
                >
                  Abbrechen
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
