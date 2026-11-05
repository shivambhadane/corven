# CORVEN landing page

Static, dependency-free page (HTML, CSS, a little vanilla JS). All copy and artwork are original to CORVEN; nothing is copied from the third-party mirror in `/landing` or from the reference images in `/designs`.

```bash
cd apps/landing
python3 -m http.server 3000   # then open http://localhost:3000
```

Deploy as-is to any static host (Vercel: root directory `apps/landing`, no build command).

## Keeping it honest
- The **Status** table in `index.html` must match what is actually built; update it when a module merges. The date in its heading is manual.
- The incident graph is an **illustration** (labelled as such). Do not present it as real output until the containment engine exists.
- No customer logos, testimonials or metrics are included, because none exist yet. Do not add placeholder ones.
- The page makes no claim beyond `docs/` (see "Explicit Product Limitations" in the PRD).
