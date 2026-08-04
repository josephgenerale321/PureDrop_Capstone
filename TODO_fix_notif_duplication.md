# TODO: Fix notification duplication (floating banner + system notification)

## Root Cause
- `floating_notif.tsx` and `system_notif.tsx` use component-instance refs
  (`appOpenResolvedRef` + `knownIdsRef`) for dedup. When the layout remounts
  (navigation re-render, tab switch, Fast Refresh), those refs reset, causing
  the same notification to be re-presented → duplicate.

## Steps
- [ ] Move "already presented" dedup to module-level `Set` in `floating_notif.tsx`.
- [ ] Move "already presented" dedup to module-level `Set` in `system_notif.tsx`.
- [ ] Keep crash-safe (no new native modules / imports).
- [ ] Verify with `npx tsc --noEmit`.
