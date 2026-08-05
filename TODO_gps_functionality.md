# GPS Functionality Improvements

## Plan (approved)
1. **Fix "My Location" recenter** — add `center` + `recenterKey` props to `OsmTileMap` so the map actually moves when the recenter button is pressed (currently it silently does nothing).
2. **Live "Follow My Location" tracking** — add a toggle in `GpsMapModal` that uses `watchPositionAsync` to continuously update the pin + map center as the user moves.
3. **Persist last known GPS fix** — cache the last successful fix via `AsyncStorage` so reopening the map instantly centers on the last known location.

## Crash-safety (dev + preview)
- `watchPositionAsync` subscription removed on close/unmount (no leaks).
- All new calls wrapped in try/catch; permission/os failures fall back gracefully.
- AsyncStorage guarded so web/preview builds never crash.
- `OsmTileMap` center-sync effect guards against invalid/NaN values.

## Files to edit
- `lib/regular_user/creategps.ts` — persistence helpers + save on fix.
- `components/create_report/OsmTileMap.native.tsx` — `center`/`recenterKey` sync.
- `components/create_report/MapPicker.native.tsx` — pass through props.
- `components/create_report/MapPicker.tsx` / `MapPicker.web.tsx` — accept new props.
- `components/create_report/GpsMapModal.tsx` — follow-location toggle + pass center.
- `components/create_report/useCreateReportForm.ts` — follow logic, recenter key, persistence init, cleanup.
