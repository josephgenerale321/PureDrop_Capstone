# Home Screen Refactor — Move CSS + Backend into `components/home/`

Refactor `app/regular_user/home.jsx` so that the styles (CSS) and the backend
(auth/Firestore logic) live in `components/home/`, following the same
convention already used by `create_report/`, `notifications/`, and `main_layout/`.

## Steps
- [x] 1. Create `components/home/home_styles.ts` — move the full `StyleSheet.create`
      (CSS) from `home.jsx`, exported as `styles`.
- [x] 2. Create `components/home/useHomeDashboard.ts` — move the auth/Firestore
      backend logic from `home.jsx` into a typed hook `useHomeDashboard()`
      (auth state, user doc fetch, loading state, `/login` redirect).
- [x] 3. Create `components/home/HomeContent.tsx` — move the UI JSX from `home.jsx`
      into a presentational component that consumes `{ user, loading }` and
      imports `styles` from `./home_styles`.
- [x] 4. Rewrite `app/regular_user/home.jsx` as a thin wrapper that composes the
      hook + component (mirrors `createreport.tsx` pattern).
- [x] 5. Verify with typecheck — `npx tsc --noEmit` (must exit 0) — `EXIT=0` confirmed.

