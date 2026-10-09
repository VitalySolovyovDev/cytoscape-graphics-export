import cytoscape from 'cytoscape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPdf } from '../src/index.js';
const fonts = { normal: new ArrayBuffer(0), italic: new ArrayBuffer(0) };
const checkpoint = vi.hoisted(() => ({
	inspect: (_options?: { format: number[] }) => {},
}));
vi.mock('jspdf', () => ({
	jsPDF: class {
		constructor(options: { format: number[] }) {
			checkpoint.inspect(options);
			throw new Error('Drawing failed');
		}
	},
}));

const graphs: cytoscape.Core[] = [];
const createGraph = (visible: boolean, zoom = 0.5) => {
	const cy = cytoscape({
		headless: true,
		styleEnabled: true,
		zoom,
		style: [{ selector: 'node', style: { opacity: 0.6 } }],
		elements: [
			{ data: { id: 'result', type: 'result' } },
			{ data: { id: 'fault', type: 'fault' } },
			{ data: { id: 'other' } },
		],
	});
	graphs.push(cy);
	cy.scratch('calculationElementsVisible', visible);
	cy.nodes().style('opacity', 0);
	cy.nodes().style('events', 'no');
	cy.$id('result').select();
	const renderer = (
		cy as cytoscape.Core & {
			renderer: () => { flushRenderedStyleQueue: () => void };
		}
	).renderer();
	renderer.flushRenderedStyleQueue = () => {};
	return cy;
};

afterEach(() => {
	vi.restoreAllMocks();
	checkpoint.inspect = () => {};
	for (const cy of graphs.splice(0)) cy.destroy();
});

describe('full PDF page sizing', () => {
	it.each([
		10000, 30000,
	])('fits graph extent %i without the SVG display limit', async (extent) => {
		const cy = createGraph(false, 1);
		cy.$id('result').position({ x: -1000, y: -500 });
		cy.$id('fault').position({ x: extent - 1000, y: 1500 });
		cy.$id('other').position({ x: 0, y: 0 });
		const inspected = vi.fn((options?: { format: number[] }) => {
			const bbox = cy
				.elements()
				.boundingBox({ includeLabels: true, includeOverlays: false });
			const graphWidth = bbox.w + 32;
			const graphHeight = bbox.h + 32;
			const [width, height] = options?.format ?? [];
			expect(width).toBeGreaterThan(8192 * 0.75);
			expect(width).toBeLessThanOrEqual(14400);
			expect(width / height).toBeCloseTo(graphWidth / graphHeight, 10);
			if (extent === 10000)
				expect(width).toBeCloseTo(graphWidth * 0.75, 10);
			else expect(width).toBe(14400);
		});
		checkpoint.inspect = inspected;
		await expect(
			exportPdf(cy, {
				fonts,
			}),
		).rejects.toThrow('Drawing failed');
		expect(inspected).toHaveBeenCalledOnce();
	});
});

describe('PDF area page sizing', () => {
	it.each([
		0.5, 2,
	])('keeps the selected screen size at zoom %s', async (zoom) => {
		const cy = createGraph(true, zoom);
		cy.pan({ x: -200, y: 150 });
		vi.spyOn(cy, 'width').mockReturnValue(1200);
		vi.spyOn(cy, 'height').mockReturnValue(900);
		const inspected = vi.fn((options?: { format: number[] }) => {
			expect(options?.format).toEqual([450, 300]);
		});
		checkpoint.inspect = inspected;
		await expect(
			exportPdf(cy, {
				fonts,
				area: { x: 100, y: 50, w: 600, h: 400 },
			}),
		).rejects.toThrow('Drawing failed');
		expect(inspected).toHaveBeenCalledOnce();
	});
	it('maps CSS container scaling and clamps the area to the viewport', async () => {
		const cy = createGraph(false, 2);
		const container = {
			clientWidth: 1000,
			clientHeight: 800,
			getBoundingClientRect: () => ({ width: 500, height: 400 }),
		} as unknown as HTMLElement;
		vi.spyOn(cy, 'container').mockReturnValue(container);
		const inspected = vi.fn((options?: { format: number[] }) => {
			expect(options?.format).toEqual([150, 300]);
		});
		checkpoint.inspect = inspected;
		await expect(
			exportPdf(cy, {
				fonts,
				area: { x: 400, y: 200, w: 200, h: 300 },
			}),
		).rejects.toThrow('Drawing failed');
		expect(inspected).toHaveBeenCalledOnce();
	});
});
