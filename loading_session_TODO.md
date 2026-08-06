# Loading Session — Component Relocation Tracker

## Goal
Move the crash-safe `SavedLoginWait` session-restore loading overlay into
`components/loading/restore_session/loading_session.tsx`, update imports, and
delete the old `components/login/backend/saveloginwait.tsx`.

## Steps
- [x] 1. Populate `components/loading/restore_session/loading_session.tsx` with SavedLoginWait (corrected imports)
- [x] 2. Update import in `app/index.tsx`
- [x] 3. Update import in `app/start.jsx`
- [x] 4. Update import in `app/login/index.tsx`
- [x] 5. Delete old `components/login/backend/saveloginwait.tsx`
- [ ] 6. Type-check with `npx tsc --noEmit`
- [x] 7. Verify no remaining `saveloginwait` references
