# TODO: Fix google-services.json path + ensure no crash in preview/dev

## Steps
- [x] Fix `googleServicesFile` in `app.json` (`./path/to/google-services.json` → `./google-services.json`)
- [x] Confirm `push_notificationfunc.tsx` never crashes in preview/dev (FCM not configured is handled gracefully)
- [x] Verify config parses cleanly (`npx expo config --type public`)
- [ ] Rebuild dev client / EAS build so FCM creds are baked into native project
