# Add "Rejected" Report Status — Task Tracker

## Goal
Add a new `Rejected` report status (red styling, matching the existing Pending/Resolving/Approved pattern) to BOTH the mobile app and admin panel, including the push notification flow.

## Admin Panel (PureDrop_Admin/PureDop_Admin)
- [x] 1. `reportsService.js` — add `rejected: 'Rejected'` to STATUS_LABELS
- [x] 2. `ReportDetailsPanel.jsx` — add `'Rejected'` to STATUS_OPTIONS
- [x] 3. `ReportsSummary.jsx` — add Rejected pill
- [x] 4. `useReportsData.jsx` — add `rejected` to summary reducer
- [x] 5. `reports.css` — add `.admin-report-summary-pill-rejected` + `.report-status-rejected`

## Mobile App (PureDrop_Capstone-main)
- [x] 6. `app/regular_user/my_report/index.tsx` — normalizeStatus add rejected
- [x] 7. `app/regular_user/all_reports/all_reportlist.tsx` — normalizeStatus add rejected
- [x] 8. `app/regular_user/view_allrep/viewallreports.tsx` — normalizeStatus add rejected
- [x] 9. `app/regular_user/view_reportuser.tsx` — normalizeStatus add rejected
- [x] 10. `components/notifications/notif_func.tsx` — normalizeStatus + buildMessage add rejected
- [x] 11. `app/regular_user/notifications/notification_main.tsx` — status color/icon/wrap add rejected
- [x] 12. `components/notifications/notif_styles.ts` — add statusWrapRejected style
- [x] 13. `supabase/functions/send-report-push/index.ts` — normalizeStatus + buildPushBody add rejected

## Verification
- [x] 14. Type-check mobile app (`npx tsc --noEmit`) — EXIT=0 ✅
- [x] 15. Verify admin build (`npm run build`) — ✓ built in 4.06s ✅
