# TODO: Create report crash-safety improvements

Goal: make the create-report flow never crash on preview/dev builds and
avoid duplicate/orphaned data.

## Steps
- [x] Add a double-submit guard (useRef) in `useCreateReportForm.handleSubmit`
      so a rapid double-tap cannot run two concurrent submit transactions.
- [x] Track uploaded storage paths and best-effort delete orphaned uploads on
      partial failure (non-blocking, wrapped in try/catch).
- [x] Wrap `launchPicker` ImagePicker calls in try/catch so a native picker
      failure never crashes the screen.
- [x] Safeguard `cleanupCachedAttachments` so `Promise.all` cannot reject and
      break `resetForm`/submit.
- [x] Type-check: `npx tsc --noEmit`
