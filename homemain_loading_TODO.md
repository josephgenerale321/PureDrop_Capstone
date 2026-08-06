# Home Main Loading — Component Consolidation Tracker

## Goal
Move the homepage circular loading spinner into
`components/loading/homepage/homemain_loading.tsx`, remove the old inline
`ActivityIndicator` blocks, and use the new crash-safe component.

## Steps
- [x] 1. Populate `components/loading/homepage/homemain_loading.tsx` with `HomeMainLoading`
- [x] 2. Use it in `components/home/HomeContent.tsx` (replace inline loading block)
- [x] 3. Use it in `app/regular_user/_layout.jsx` (replace inline auth loading block)
- [ ] 4. Type-check with `npx tsc --noEmit`
- [ ] 5. Verify no stray inline homepage spinners remain
