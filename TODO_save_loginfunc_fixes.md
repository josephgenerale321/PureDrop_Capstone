# TODO — save_loginfunc fixes (logic only, no UI/design changes)

Status legend: `[ ]` = pending, `[x]` = done

## Goal
Fix functional bugs in `components/main_layout/save_loginfunc.tsx` while
keeping the UI unchanged and all crash-safety guarantees intact (preview +
development builds).

## Steps
- [x] 1. Only auto-redirect when the session is genuinely being *restored*
       (read `getSavedLogin()` at mount) — prevents double navigation on
       manual login.
- [x] 2. Stop resetting `handledSessionRef` on `!currentUser` so a manual
       re-login in the same app run does not trigger another auto-redirect.
- [x] 3. Treat empty-string email/name as `null` in `getSavedLogin()`.
- [x] 4. Re-check `auth.currentUser` after the storage read resolves to close
       the race between the storage read and the auth listener.
- [x] 5. Verify all code paths remain crash-safe (try/catch on storage + auth
       read, `isMounted` guards, nullable `unsubscribe`).

## Network optimizations
- [x] 6. Cache-first profile name resolution: skip the Firestore `getDoc`
       network round-trip when the name is already cached (faster auto-login,
       works offline, one less request per app open).
- [x] 7. Dedupe per-user sync: `syncedUidRef` keeps the profile read + storage
       write to ONE sync per user per app run (token refresh / re-subscribe
       no longer re-hit the network).
- [x] 8. Re-entrancy guard: `syncingRef` prevents overlapping concurrent
       network reads when an auth event fires while a sync is in flight.
- [x] 9. Diff-based AsyncStorage writes: only persist values that actually
       changed, avoiding redundant writes on every auth signal.

## Optimistic instant reopen (fixes slow reopen after force-close)
- [x] 10. `SaveLoginSync` already navigates to `/regular_user/home` immediately
       from the saved-login marker (no network wait on the pre-login screen).
- [x] 11. `app/regular_user/_layout.jsx` auth gate now waits for a saved-login
       restore for a grace window (`AUTH_RESTORE_GRACE_MS = 8000`, matching the
       `SavedLoginWait` overlay timeout) instead of bouncing to `/login` the
       moment Firebase reports "no user" during the token refresh. The network
       wait happens behind a spinner, not a blocking alert/overlay.
- [x] 12. `markerPendingRef` closes the race between the auth listener firing
       "no user" and the async storage read that confirms a saved login exists.
- [x] 13. `graceTimerRef` guarantees the gate always falls back to `/login`
       (and clears a stale marker) after the grace window — never stuck forever.
- [x] 14. All new paths remain crash-safe: `isMounted` guards, try/catch on the
       storage read, and `clearGraceTimer()` on unmount.
