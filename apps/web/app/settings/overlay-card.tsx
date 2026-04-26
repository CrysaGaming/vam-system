'use client';

import { useState } from 'react';
import { rotateOverlayToken } from './actions';

export function OverlayCard({ token: initialToken }: { token: string }) {
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const overlayUrl = typeof window !== 'undefined'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* URL-Anzeige */}
      <div>
        <label className="block text-xs uppercase tracking-wider text-gray-500 mb-2">
          Deine Overlay-URL
        </label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            readOnly
            value={overlayUrl}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-gray-300 select-all"
            onClick={(e) => e.currentTarget.select()}
          />
          <button
            onClick={handleCopy}
            className={`px-4 py-2 rounded text-sm font-medium transition ${
              copied
                ? 'bg-green-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
          >
            {copied ? '✓ Kopiert' : 'Kopieren'}
          </button>
        </div>
      </div>

      {/* OBS-Anleitung */}
      <details className="bg-gray-800/50 rounded p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-300">
          📋 So fügst du das Overlay in OBS ein
        </summary>
        <ol style={{ marginTop: '0.75rem', paddingLeft: '1.25rem', listStyleType: 'decimal' }}
            className="text-sm text-gray-400 space-y-2">
          <li>OBS öffnen, in deine Szene wechseln</li>
          <li>Im Bereich <strong>Quellen</strong> auf das <strong>+</strong> klicken</li>
          <li><strong>Browser</strong> auswählen, Name vergeben (z.B. &quot;VAM Live&quot;)</li>
          <li>URL einfügen (oben kopieren)</li>
          <li>Breite: <strong>1920</strong>, Höhe: <strong>1080</strong></li>
          <li>Bei <strong>Eigene CSS</strong> nichts hinzufügen — Overlay ist transparent</li>
          <li>OK klicken — die Live-Bar erscheint oben im Bild</li>
        </ol>
        <p className="text-xs text-gray-500 mt-3">
          💡 Das Overlay zeigt nur Daten wenn du gerade aktiv auf VATSIM/IVAO fliegst.
        </p>
      </details>

      {/* Token-Rotation */}
      <div className="border-t border-gray-800 pt-4">
        {!showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="text-xs text-gray-500 hover:text-red-400 transition"
          >
            🔄 Token zurücksetzen (alte URL wird ungültig)
          </button>
        ) : (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
            <p className="text-sm text-red-300 mb-3">
              <strong>Token wirklich zurücksetzen?</strong>
              <br />
              <span className="text-xs">
                Die aktuelle URL wird ungültig. Du musst die neue URL in OBS aktualisieren.
              </span>
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={handleRotate}
                disabled={rotating}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-xs font-semibold text-white transition"
              >
                {rotating ? 'Wird zurückgesetzt...' : 'Ja, zurücksetzen'}
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={rotating}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-white transition"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}