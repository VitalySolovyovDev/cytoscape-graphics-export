# Cytoscape Graphics Export

Browser-only SVG and PDF export for Cytoscape.js. PDF uses a direct jsPDF drawing adapter; SVG uses an independent renderer integration with MIT-licensed Canvas2SVG. It does not use cytoscape-svg or svg2pdf.

## Install

```sh
npm install @vitaly.solovyov.dev/cytoscape-graphics-export cytoscape@3.32.0
```

## Export

```ts
import { exportSvg, exportPdf } from '@vitaly.solovyov.dev/cytoscape-graphics-export';

const svg = await exportSvg(cy);
const areaSvg = await exportSvg(cy, {
  area: { x: 100, y: 50, w: 600, h: 400 },
});

const [normal, italic] = await Promise.all(
  ['/fonts/Roboto.ttf', '/fonts/Roboto-Italic.ttf'].map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load font: ${url}`);
    return response.arrayBuffer();
  }),
);
const pdf = await exportPdf(cy, { fonts: { normal, italic } });
```

Both functions return `Promise<Blob>`. They do not download files. With no `area`, the entire graph is exported. `area` uses CSS pixels relative to the container's displayed top-left corner, including CSS container scaling, and is clipped to the viewport. The caller controls filenames, download UI and clipboard.

## Requirements and limitations

- Tested with Cytoscape **3.32.0**, a browser DOM and the Canvas renderer. Internal renderer APIs are used; other Cytoscape versions are not supported yet.
- PDF fonts are supplied by the caller as TTF `ArrayBuffer`s. The first release is tested with Roboto normal and italic. PDF uses normal for bold and italic for bolditalic, matching the current renderer integration; it does not synthesize bold.
- The caller prepares application-specific visibility/LOD before export and restores it afterwards. Export does not reveal hidden application nodes.
- Selection is temporarily cleared and restored. Renderer settings are restored even if drawing fails; cached node Path2D objects are temporarily bypassed (Cytoscape otherwise offsets background images) and restored with the same identity. Edge path caches are retained. Camera position and zoom are not changed.
- Calls for the same `Core` must be serialized by the caller. Heavy drawing runs on the browser main thread; the caller should show its busy indicator before starting.
- Background images must be browser-readable, with appropriate CORS permissions. Export waits up to eight seconds for pending images; unreadable raster images may cause a Canvas security error.
- A complete loaded graph is required for full export. Node.js, headless rendering and server-side export are not supported.
- Large SVGs retain vector geometry while their display dimensions are capped at 8192 px. PDF dimensions are uniformly scaled to fit jsPDF's 14400 pt page limit.
- SVG images are embedded as PNG to preserve their exported appearance without depending on external image URLs. PDF remains vector for paths and text, with embedded raster images.

## Development

Use Node.js 22.15 or newer. npm 11 is recommended (npm 10.9's dependency resolver failed on the development dependency graph).

```sh
npm ci
npm run check
npm test
npm run build
npm run example
npm pack --dry-run
npm pack
```

The example is a synthetic graph with full/area SVG and PDF buttons. Supply your local Roboto normal/italic TTF files for PDF. No application models or fonts are included in the published archive.

`prepack` checks types, runs tests and builds `dist`. The published files are `dist`, this README, LICENSE and THIRD_PARTY_LICENSES.md. The package uses ESM and publishes TypeScript declarations.

## License

MIT. See [LICENSE](./LICENSE) and [third-party licenses](./THIRD_PARTY_LICENSES.md).

## Source layout

- `src/index.ts`: public API.
- `src/types`: public types and third-party declarations.
- `src/svg`: SVG export.
- `src/pdf`: PDF export and arc geometry.
- `src/internal`: shared drawing state and renderer helpers.
