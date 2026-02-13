# Mouse Skip Detector

Web app to detect and measure cursor movement skips (jumps) using browser pointer events.

Repository: [https://github.com/alopezo/mouse-skip-detector](https://github.com/alopezo/mouse-skip-detector)

## Features

- Single-screen test area with real-time trajectory drawing.
- Countdown before capture starts.
- Skip detection based on adaptive movement thresholds.
- Metrics panel with skip density per distance.
- Session report dialog on `Stop`.
- Methodology dialog.
- JSON export for sessions and reports.

## Stack

- Vite
- React
- TypeScript
- Canvas 2D

## Getting Started

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

Open: [http://127.0.0.1:4173/](http://127.0.0.1:4173/)

## Build

```bash
npm run build
```

The production output is generated in `dist/`.

## Deploy to GitHub Pages

If using a repository project page (`https://alopezo.github.io/mouse-skip-detector/`):

1. Set `base` in `vite.config.ts` to:
   - `base: '/mouse-skip-detector/'`
2. Add a GitHub Actions workflow to build and deploy `dist/`.
3. In repository settings, set Pages source to `GitHub Actions`.

## License

Licensed under the Apache License 2.0. See [`LICENSE`](LICENSE).
