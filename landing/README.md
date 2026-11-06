# Transform9 Website Mirror

A complete, high-fidelity offline mirror of [Transform9](https://www.transform9.com/).

## Structure

- `index.html`: Main landing page
- `compare/index.html` & `compare.html`: Compare page
- `book-a-demo/index.html` & `book-a-demo.html`: Book a Demo page
- `case-studies/`: Case studies listing and individual study pages (`southern-bone-joint`, `the-orthopaedic-center`)
- `blog/`: Blog listing and all individual article pages
- `hipaa/`: HIPAA compliance page
- `privacy-policy/`: Privacy policy page
- `terms-of-use/`: Terms of use page
- `assets/`: Fully localized assets:
  - `css/`: Webflow CSS stylesheet with relative asset paths
  - `js/`: Webflow runtime, GSAP, ScrollTrigger, Lenis, Finsweet, and interactions scripts
  - `fonts/`: PolySans font files
  - `images/`: High-resolution logos, client badges, diagrams, icons, and thumbnails
  - `videos/`: Background video files (`Tablet-Final_mp4.mp4`, `Tablet-Final_webm.webm`)

## How to View

### Option 1: Python HTTP Server
```bash
cd landing
python3 -m http.server 3000
```
Then open `http://localhost:3000` in your browser.

### Option 2: Node.js Serve
```bash
cd landing
npx serve -l 3000 .
```

### Option 3: Direct File Open
You can also directly open `landing/index.html` in any browser.
