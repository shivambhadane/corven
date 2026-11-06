# CORVEN landing page

Static, dependency-free page (HTML, CSS, a little vanilla JS). All copy and artwork are original to CORVEN; nothing is copied from the third-party mirror in `/landing` or from the reference images in `/designs`.

## Design language
Follows a design brief (electric single-accent hero, restrained light surfaces, dark code cards, small radii, no shadows, generous 92/115px section rhythm). It is a language, not a copy: the accent (`#c23208`), wordmark, copy, tile graphic, dotted wave (`assets/wave.svg`, generated) and all examples are CORVEN's own.
- Tokens live at the top of `styles.css`. Change `--primary` to rebrand; keep white-on-primary contrast above 4.5:1.
- Fonts are self-hosted from `fonts/` (Inter, Source Serif 4, Geist Mono; SIL Open Font License, Latin subset). They stand in for the brief's commercial typefaces.
- Status colours (red/amber/green) appear only inside the illustrations.

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
