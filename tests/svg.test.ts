import cytoscape from 'cytoscape';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { exportSvg } from '../src/index.js';

const readBlob = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = reject;
		reader.readAsText(blob);
	});
const graphs: cytoscape.Core[] = [];
beforeEach(() => {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		measureText: () => ({ width: 10 }),
		drawImage: vi.fn(),
	} as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
		'data:image/png;base64,AAAA',
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	graphs.splice(0).forEach((core) => core.destroy());
});
const create = (draw: (ctx: CanvasRenderingContext2D) => void) => {
	const core = cytoscape({
		headless: true,
		styleEnabled: true,
		elements: [{ data: { id: 'n' } }],
	});
	graphs.push(core);
	core.$id('n').select();
	const usePaths = () => true;
	const renderer = Object.assign(
		(core as unknown as { renderer: () => object }).renderer(),
		{
			usePaths,
			flushRenderedStyleQueue: vi.fn(),
			getCachedZSortedEles: () => core.elements(),
			drawElements: draw,
		},
	);
	return { core, renderer, usePaths };
};
it('preserves paths, dashes, embedded PNG opacity and restores renderer/selection', async () => {
	const { core, renderer, usePaths } = create((ctx) => {
		expect(renderer.usePaths()).toBe(false);
		expect(core.$(':selected').length).toBe(0);
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(50, 30);
		ctx.setLineDash([6, 3]);
		ctx.stroke();
		ctx.save();
		ctx.setLineDash([]);
		ctx.restore();
		expect(ctx.getLineDash()).toEqual([6, 3]);
		ctx.globalAlpha = 0.25;
		const image = document.createElement('img');
		image.width = 20;
		image.height = 10;
		ctx.drawImage(image, 10, 20, 40, 20);
	});
	const blob = await exportSvg(core);
	const root = new DOMParser().parseFromString(
		await readBlob(blob),
		'image/svg+xml',
	);
	expect(root.querySelector('parsererror')?.textContent ?? '').toBe('');
	expect(blob.type).toBe('image/svg+xml');
	expect(root.querySelector('path')?.getAttribute('stroke-dasharray')).toBe(
		'6,3',
	);
	expect(root.querySelector('image')?.getAttribute('opacity')).toBe('0.25');
	expect(
		root
			.querySelector('image')
			?.getAttributeNS('http://www.w3.org/1999/xlink', 'href'),
	).toBe('data:image/png;base64,AAAA');
	expect(renderer.usePaths).toBe(usePaths);
	expect(core.$id('n').selected()).toBe(true);
});
it('restores renderer and selection if rendering throws', async () => {
	const { core, renderer, usePaths } = create(() => {
		throw new Error('Render failed');
	});
	await expect(exportSvg(core)).rejects.toThrow('Render failed');
	expect(renderer.usePaths).toBe(usePaths);
	expect(core.$id('n').selected()).toBe(true);
});
it('does not reveal nodes hidden by the consuming application', async () => {
	const { core } = create(() => {
		expect(core.$id('n').style('display')).toBe('none');
	});
	core.$id('n').style('display', 'none');
	await exportSvg(core);
	expect(core.$id('n').style('display')).toBe('none');
});
it('clips a CSS-scaled viewport area without changing camera', async () => {
	const { core } = create(() => {});
	core.zoom(2);
	core.pan({ x: -200, y: 50 });
	vi.spyOn(core, 'container').mockReturnValue({
		clientWidth: 1000,
		clientHeight: 800,
		getBoundingClientRect: () => ({ width: 500, height: 400 }),
	} as unknown as HTMLElement);
	const blob = await exportSvg(core, {
		area: { x: 100, y: 50, w: 200, h: 100 },
	});
	const root = new DOMParser().parseFromString(
		await readBlob(blob),
		'image/svg+xml',
	).documentElement;
	expect(root.getAttribute('width')).toBe('400');
	expect(root.getAttribute('height')).toBe('200');
	expect(root.querySelector('clipPath')).not.toBeNull();
	expect(core.zoom()).toBe(2);
	expect(core.pan()).toEqual({ x: -200, y: 50 });
});

it('temporarily bypasses cached node Path2D and restores its identity after failure', async () => {
	const { core } = create(() => {
		expect(scratch.pathCache).toBeNull();
		throw new Error('Render failed');
	});
	const scratch = (
		core.$id('n') as unknown as {
			_private: {
				rscratch: { pathCache?: unknown; pathCacheKey?: string };
			};
		}
	)._private.rscratch;
	const cached = {};
	scratch.pathCache = cached;
	scratch.pathCacheKey = 'same-node-shape';
	await expect(exportSvg(core)).rejects.toThrow('Render failed');
	expect(scratch.pathCache).toBe(cached);
	expect(scratch.pathCacheKey).toBe('same-node-shape');
});
