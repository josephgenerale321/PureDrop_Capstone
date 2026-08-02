# Floating Notification + Auto-Login Implementation

## Steps

- [x] 1. Implement `components/notifications/floating_notif.tsx` — crash-safe floating banner
- [x] 2. Wire `<FloatingNotification />` into `app/regular_user/_layout.jsx`
- [x] 3. Verify typecheck with `npx tsc --noEmit` — clean
- [x] 4. Verify preview build with `npx expo export --platform web` — exit 0

## Follow-up feedback: float on app open + auto-login

- [x] 5. Floating banner now shows the newest unread notification on app open
      (not just for notifications that arrive while running).
- [x] 6. Implement `components/main_layout/save_loginfunc.tsx` — saved-login marker,
      `getSavedLogin()` / `clearSavedLogin()`, and auto-redirect to
      `/regular_user/home` on app open when a session is restored.
- [x] 7. Mount `<SaveLoginSync />` in `app/_layout.tsx` (root).
- [x] 8. Clear the saved-login marker on explicit sign-out in
      `app/regular_user/signout/signout_modal.tsx`.
- [x] 9. Re-verify typecheck (`npx tsc --noEmit`) — exit 0 — and preview build
      (`npx expo export --platform web`) — exit 0.

