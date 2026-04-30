# Open Edge-Cases — Day-5 Pickup

Date: 2026-04-30
Status: Geparkt nach Day-4 Marathon
Session-Context: Ende Phase 5 (~22:30 Berlin), 12 commits geshipped

Beide Edge-Cases sind **nicht durch fehlenden Code blockiert** — der Code
für beide ist geshipped und code-verified. Was fehlt sind Test-Setups die
in der Day-4-Session nicht zugänglich waren. Day-5 sollte mit diesem Doc
einsteigen können ohne den ganzen Day-4-Transcript zu lesen.

## #1 — Popup-Blocker Live-Toggle Test

### Was ist das?

Pattern Z (SimBrief Popup) eröffnet einen Browser-Popup für die OFP-
generation. Wenn der User einen Popup-Blocker aktiv hat, erscheint
dieser blockiert. SimBrief's `simbrief.apiv1.js#LaunchSBworker` raised
einen native browser alert mit no-path-forward — der User klickt OK und
hat keine OFP.

### Was ist bereits geshipped?

Commit `fc9a992` (Day-4): symmetric Pattern α fallback hint auf
`/bookings/[id]` — sowohl im fresh-booking als auch im Plan-again state
zeigt VAM unter den dispatch-buttons:

> *"Popup blockiert? Im neuen Tab öffnen (Pattern α)"*

Click setzt `dispatchMode=alpha` im URL-param und lädt die page neu mit
Pattern α aktiv. User kann dann ohne Popup die OFP generieren.

### Was fehlt?

**Live-Verifikation dass der Pattern Z Popup im echten Browser geblockt
wird, der hint sichtbar ist, der click funktioniert, und Pattern α
erfolgreich die OFP generiert.**

Code-verify allein ist nicht ausreichend weil Popup-Blocker per Browser
+ per Domain konfiguriert werden, und der dev kann nicht sicher sein
dass die UI-message korrekt rendert ohne sie im echten geblockten state
zu sehen.

### Reproduction-Steps für Day-5

1. Chrome → Settings → Privacy and Security → Site Settings → Pop-ups
   and redirects → "Don't allow sites to send pop-ups or use redirects"
2. Stelle sicher dass `vam.kevindrack.de` nicht in der Allow-Liste ist
3. Login bei VAM, navigate zu einem Booking mit `Created` state
4. Klick "SimBrief Popup" (Pattern Z) button
5. Verify: Browser zeigt einen "Popup blockiert" indicator in der
   address-bar
6. Verify: SimBrief Popup öffnet **nicht**, but the page should remain
   functional
7. Verify: Der Pattern α fallback hint ist unter den dispatch-buttons
   sichtbar
8. Click den hint → page lädt mit `?dispatchMode=alpha`
9. Click "SimBrief Tab" (Pattern α) → SimBrief opens in new tab
10. Generate OFP → callback returns → cache populates → booking gets
    `SimBriefDispatched` state

### Acceptance-Criteria

- [ ] Popup-Blocker tatsächlich aktiv (verified via Chrome settings UI)
- [ ] Pattern Z Popup wird geblockt (verified via address-bar indicator)
- [ ] Page-state bleibt funktional (kein crash, no infinite loader)
- [ ] Pattern α fallback hint ist sichtbar
- [ ] Click triggert URL-param change und Pattern α button erscheint
- [ ] Pattern α dispatch + callback funktioniert wie üblich
- [ ] Cache + booking-state update korrekt am Ende

### Was könnte schief gehen?

- Hint zu klein / nicht prominent genug (UX issue, but not a bug)
- URL-param wird nicht gesetzt (regression in `_pattern-fallback-hint.tsx`)
- Pattern α button doesn't appear after URL-change (state-sync issue)
- Cookie-state vom user macht den dispatch reload zu zeit-stamp-mismatch

### Code-Locations

- Hint component: `apps/web/app/bookings/[id]/_pattern-fallback-hint.tsx`
  *(approximate path — search for "Popup blockiert" if name changed)*
- Hint usage: `apps/web/app/bookings/[id]/page.tsx` — beide states
  (fresh-booking + Plan-again)
- Pattern Z handler: `apps/web/lib/simbrief/dispatch.ts` —
  `dispatchPopup()` invokes simbrief.apiv1.js
- Pattern α URL-param parsing: same booking page query-param read

---

## #2 — `static_id` Guard mit 3rd-User-Test

### Was ist das?

SimBrief OFP callbacks enthalten ein `static_id` query-param das die
booking identifiziert. VAM matched den callback zur booking via
`static_id === booking.id`. Wenn ein malicious user den `static_id` in
der callback-URL manipuliert um eine fremde booking zu adressieren,
muss VAM das ablehnen.

### Was ist bereits geshipped?

Code-verified Phase A (Day-4 morning):

- `apps/web/app/api/simbrief/callback/route.ts` L184 + L334 enforce
  `static_id === booking.id` und reject mit 403 sonst.
- Booking-userId-scope check verifiziert dass der callback vom
  authentifizierten user-session geht der die booking owns.

Das funktioniert für den 1st und 2nd user (verified via Day-4 multi-
tenant test, commit `1ee1aa0`). Der 1st user kann nicht die booking des
2nd user updaten und vice versa.

### Was fehlt?

**3rd-user-test mit network-capture um zu verifizieren dass ein "user
in the middle" der den callback abfängt und re-issued mit anderer
`static_id` abgelehnt wird.**

Konkrete Frage: Wenn user A erfolgreich eine OFP generiert und VAM
sieht den callback `?static_id=A_booking`, was passiert wenn user B
nochmal denselben callback per HTTP-replay an VAM schickt? Sollte:
- Idempotent — derselbe callback wird ignoriert (cache existiert
  bereits, kein update)
- ODER: Reject — re-callbacks nach cache exists werden geblockt mit
  einem expliziten error

Das Verhalten ist im Code present aber nicht live-verified.

### Reproduction-Steps für Day-5

Setup needs:
- 3 verschiedene Test-User (User-A, User-B, User-C in der DB)
- Browser dev-tools network-tab oder ein Tool wie Burp Suite
- Two browser-sessions (z.B. Chrome regular + Chrome Incognito)

Test-Flow:
1. User-A logged in, creates Booking-A
2. User-A klickt Pattern Z, generiert OFP, callback fires
3. **Capture** den exact callback URL (network-tab in dev-tools)
4. User-B logged in (different session), creates Booking-B
5. User-B replay den **gestohlenen** Booking-A-callback an VAM
6. Verify: VAM rejects mit 403 oder ignoriert idempotent
7. Verify: Booking-B state ist unverändert
8. Verify: Booking-A's cache ist nicht überschrieben

Deeper test:
- User-C tries same replay attack auf Booking-A — same expected behavior
- Anonymous (no session) tries replay — definitely 403

### Acceptance-Criteria

- [ ] 3-User-Setup in DB präsent (User-A, User-B, User-C, jeweils mit
      airline-affiliation)
- [ ] User-B kann Booking-A's callback NICHT reusen — VAM returns 403
      (oder ignoriert mit no-op)
- [ ] User-B's eigene Booking-B state bleibt unverändert nach replay-
      attempt
- [ ] User-A's cache + booking-state bleibt unverändert
- [ ] Anonymous request mit gestohlenem callback → 403
- [ ] Audit-log zeigt den rejected attempt (nice-to-have, kein blocker)

### Was könnte schief gehen?

- callback-handler vergleicht `static_id` nicht stringent genug —
  z.B. parseInt-coercion lässt `static_id=42abc` als 42 durch
- Race-condition: 2 callbacks gleichzeitig für dieselbe booking —
  welche wins?
- session-cookies werden nicht geprüft → ein anonymer replay funktioniert
- cache-Idempotency ist falsch implementiert (z.B. cache wird über-
  schrieben statt only-on-first-success)

### Code-Locations

- Callback handler: `apps/web/app/api/simbrief/callback/route.ts`
- L184: Pattern α (tab-redirect callback) `static_id` check
- L334: Pattern Z (popup callback) `static_id` check
- Booking-scope check: same file, both handlers verify
  `booking.userId === session.user.id`

### Setup für Day-5

User-fixtures bereits in `prisma/seed.ts`:
- `user1@test.local` (ja, real users CrysaGaming)
- `user2@test.local` (Day-4 multi-tenant test fixture)

Für 3rd-user need:
```sql
INSERT INTO "User" (id, name, email, "discordId", "airlineId")
VALUES (
  'user3-test-id',
  'Test User 3',
  'user3@test.local',
  'discord-user3-stub',
  '<airlineId>'  -- can be same as User-A for stress-test
);
```

Or extend the seed-script mit `seedUser3()` flag.

---

## Day-5 Pickup Reihenfolge

Beide edge-cases sind low-risk (Code is in place) aber high-value (live
verification confidence). Empfohlen:

1. **#1 Popup-Blocker** zuerst — schneller (5 min Browser-config + 5 min
   click-through) und validates eine recently-shipped UX-feature.
2. **#2 static_id 3rd-user** danach — mehr setup-time (~15 min for
   user-seeding + network-capture-tooling) aber security-relevant.

Beide sollten in einer einzigen ~30-45min Day-5 session abzuhandeln
sein. Wenn beide green, dann sind alle Phase-2-edge-cases offiziell
geschlossen und Day-5 can move on zu neuen features.
