# Cytoscape Graphics Export

Browser-only SVG, PDF and PNG export for Cytoscape.js. PDF uses a direct jsPDF drawing adapter; SVG uses an independent renderer integration with MIT-licensed Canvas2SVG. It does not use cytoscape-svg or svg2pdf.

## Install

```sh
npm install cytoscape-graphics-export cytoscape@3.32.0
```

## Export

```ts
import { exportSvg, exportPdf, exportPng } from 'cytoscape-graphics-export';

const svg = await exportSvg(cy);
const png = await exportPng(cy);
const areaPng = await exportPng(cy, {
  area: { x: 100, y: 50, w: 600, h: 400 },
});
const areaSvg = await exportSvg(cy, {
  area: { x: 100, y: 50, w: 600, h: 400 },
});

const [normal, bold, italic, bolditalic] = await Promise.all(
  ['/fonts/Example-Regular.ttf', '/fonts/Example-Bold.ttf',
   '/fonts/Example-Italic.ttf', '/fonts/Example-BoldItalic.ttf'].map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load font: ${url}`);
    return response.arrayBuffer();
  }),
);
const pdf = await exportPdf(cy, { fonts: { family: 'Example', normal, bold, italic, bolditalic } });
```

All three functions return `Promise<Blob>`. They do not download files. With no `area`, the entire graph is exported. `area` uses CSS pixels relative to the container's displayed top-left corner, including CSS container scaling, and is clipped to the viewport. The caller controls filenames, download UI and clipboard.

## Requirements and limitations

- Tested with Cytoscape **3.32.0**, a browser DOM and the Canvas renderer. Internal renderer APIs are used; other Cytoscape versions are not supported yet.
- PDF text uses the supplied `fonts.family`. Provide `normal` and any `bold`, `italic` or `bolditalic` TTF `ArrayBuffer`s used by the graph. Missing styles produce an error; the package does not synthesize or substitute styles. Make the family available in the browser too, so text measurements match the embedded font.
- Export preserves the graph's current styles and visibility. Prepare any desired visibility changes before calling export.
- Selection is temporarily cleared and restored. Renderer settings are restored even if drawing fails; in SVG/PDF, cached node Path2D objects are temporarily bypassed (Cytoscape otherwise offsets background images) and restored with the same identity. Edge path caches are retained. Camera position and zoom are not changed.
- Calls for the same `Core` must be serialized by the caller. Heavy drawing runs on the browser main thread; the caller should show its busy indicator before starting.
- Background images must be browser-readable, with appropriate CORS permissions. Export waits up to eight seconds for pending images; unreadable raster images may cause a Canvas security error.
- A complete loaded graph is required for full export. Node.js, headless rendering and server-side export are not supported.
- PNG uses the native Cytoscape Canvas renderer with a white background. Full PNG is capped at 8192 px per side; area PNG is exported at 2x viewport resolution.
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

The example is a synthetic graph with full/area SVG, PDF and PNG buttons. Supply your local Roboto normal/italic TTF files for PDF. No application models or fonts are included in the published archive.

`prepack` checks types, runs tests and builds `dist`. The published files are `dist`, this README, LICENSE and THIRD_PARTY_LICENSES.md. The package uses ESM and publishes TypeScript declarations.

## License

MIT. See [LICENSE](./LICENSE) and [third-party licenses](./THIRD_PARTY_LICENSES.md).

## Source layout

- `src/index.ts`: public API.
- `src/types`: public types and third-party declarations.
- `src/svg`: SVG export.
- `src/png`: PNG capture and cropping.
- `src/pdf`: PDF export and arc geometry.
- `src/internal`: shared drawing state and renderer helpers.

## Migration from 1.x

`PdfFonts` now requires `family` and registers only explicitly supplied styles. Add `family` and provide the styles used by your graph. To intentionally retain 1.x substitution, pass the same normal buffer as `bold` and the same italic buffer as `bolditalic`; this decision belongs to the caller. SVG and PNG APIs are unchanged.
