'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

type TabKey = 'profile' | 'connections' | 'simbrief' | 'overlay' | 'acars';

const TABS: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'profile', label: 'Profil', icon: '👤' },
  { key: 'connections', label: 'Verbindungen', icon: '🔗' },
  { key: 'simbrief', label: 'SimBrief', icon: '✈️' },
  { key: 'overlay', label: 'OBS-Overlay', icon: '🎬' },
  // Welle 9 (ACARS Phase 2-5): pairing-flow + status for the desktop-
  // client. The client itself is a separate Electron-app project; this
  // tab is the web-side configuration surface.
  { key: 'acars', label: 'ACARS', icon: '📡' },
];

interface Props {
  profileContent: React.ReactNode;
  connectionsContent: React.ReactNode;
  simbriefContent: React.ReactNode;
  overlayContent: React.ReactNode;
  acarsContent: React.ReactNode;
}

/**
 * Tab-navigation for /settings. Server-renders all panel content (the
 * parent server component does data-fetching + passes ReactNodes), and
 * the client just toggles which panel is visible.
 *
 * URL-Hash-Sync: `/settings#profile` lands directly on the Profil tab.
 * Tab-clicks update the hash so the user can deep-link or browser-back.
 * Default tab on no-hash is "profile".
 *
 * Implementation choice: visibility-toggle via CSS rather than
 * conditional render, so React doesn't tear down + re-mount each
 * panel on tab-switch (preserves any inline form-draft-state).
 */
export function SettingsTabs({
  profileContent,
  connectionsContent,
  simbriefContent,
  overlayContent,
  acarsContent,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('profile');
  const [mounted, setMounted] = useState(false);

  // Read hash on mount + sync on hash-change. The mounted-flag is to
  // avoid a hydration-mismatch warning since SSR doesn't have access
  // to window.location.hash.
  useEffect(() => {
    setMounted(true);

    function syncFromHash() {
      const hash = window.location.hash.slice(1);
      if (TABS.some((t) => t.key === hash)) {
        setActiveTab(hash as TabKey);
      }
    }
    syncFromHash();

    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  function handleTabClick(key: TabKey) {
    setActiveTab(key);
    // Push the hash so back-button works. history.replaceState avoids
    // polluting history with every click — alternative would be just
    // assigning location.hash but that pushes a new entry per click.
    window.history.replaceState(null, '', `#${key}`);
  }

  // Until mounted, render with profile-tab active to match SSR.
  const visibleTab = mounted ? activeTab : 'profile';

  return (
    <>
      {/* Tab-bar — sticky-ish at the top of the content. Horizontal-scroll
          on narrow viewports (mobile) so all 4 tabs remain reachable. */}
      <nav
        className="mb-6 flex gap-1 overflow-x-auto border-b border-border"
        role="tablist"
        aria-label="Settings sections"
      >
        {TABS.map((tab) => {
          const isActive = visibleTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              onClick={() => handleTabClick(tab.key)}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition',
                isActive
                  ? 'border-indigo-500 text-indigo-700 dark:text-white'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div
        role="tabpanel"
        id="tabpanel-profile"
        aria-labelledby="tab-profile"
        hidden={visibleTab !== 'profile'}
      >
        {profileContent}
      </div>
      <div
        role="tabpanel"
        id="tabpanel-connections"
        aria-labelledby="tab-connections"
        hidden={visibleTab !== 'connections'}
      >
        {connectionsContent}
      </div>
      <div
        role="tabpanel"
        id="tabpanel-simbrief"
        aria-labelledby="tab-simbrief"
        hidden={visibleTab !== 'simbrief'}
      >
        {simbriefContent}
      </div>
      <div
        role="tabpanel"
        id="tabpanel-overlay"
        aria-labelledby="tab-overlay"
        hidden={visibleTab !== 'overlay'}
      >
        {overlayContent}
      </div>
      <div
        role="tabpanel"
        id="tabpanel-acars"
        aria-labelledby="tab-acars"
        hidden={visibleTab !== 'acars'}
      >
        {acarsContent}
      </div>
    </>
  );
}
