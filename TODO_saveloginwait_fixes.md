# TODO — saveloginwait fixes (logic only, no design/UI changes)

Status legend: `[ ]` = pending, `[x]` = done

## Goal
Fix functional bugs in `components/login/backend/saveloginwait.tsx` while
keeping the UI (overlay/card/spinner styles) and crash-safety guarantees
(preview + development builds) fully intact.

## Steps
- [x] 1. Track whether Firebase already reported a user (`userSeenRef`) to close
       the race between the `onAuthStateChanged` listener and the async
       `getSavedLogin()` read (`boot()` must not flash the overlay when a user
       arrived while storage was still resolving).
- [x] 2. Guard the overlay so it can only ever be shown once per mount
       (`shownRef`).
- [x] 3. Clear the pending safety timeout inside `hide()` so an already-dismissed
       overlay does not schedule a redundant `setVisible(false)` later.
- [x] 4. Tear down the `onAuthStateChanged` subscription as soon as
       `getSavedLogin()` confirms there is no saved login, instead of keeping a
       useless listener alive.
- [x] 5. Verify all code paths remain crash-safe (try/catch on storage + auth
       read, nullable `unsubscribe`, `isMounted` guards, null render when not
       visible).

