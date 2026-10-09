import cytoscape from 'cytoscape';
import { withDrawingState } from '../src/internal/drawingState.js';
// @ts-ignore Cytoscape does not publish types for internal renderer modules.
import images from '../node_modules/cytoscape/src/extensions/renderer/canvas/drawing-images.mjs';
import { expect, it, vi } from 'vitest';
// @ts-ignore Cytoscape does not publish types for its internal renderer modules.
import renderer from '../node_modules/cytoscape/src/extensions/renderer/canvas/drawing-edges.mjs';

it('bypasses cached paths for PDF and reuses them when usePaths is restored', () => {
	const points = [0, 0, 100, 50];
	const cachedPath = {};
	const scratch = {
		pathCacheKey: points.join('$'),
		pathCache: cachedPath,
		edgeType: 'straight',
	};
	const edge = {
		_private: { rscratch: scratch },
		pstyle: () => ({ pfValue: 0 }),
	};
	const context = {
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
	};
	const originalUsePaths = () => true;
	const drawing = { usePaths: originalUsePaths };
	drawing.usePaths = () => false;
	renderer.drawEdgePath.call(drawing, edge, context, points, 'solid');
	expect(context.moveTo).toHaveBeenCalledWith(0, 0);
	expect(context.lineTo).toHaveBeenCalledWith(100, 50);
	expect(context.stroke).toHaveBeenLastCalledWith();
	expect(scratch.pathCache).toBe(cachedPath);
	expect(scratch.pathCacheKey).toBe(points.join('$'));
	drawing.usePaths = originalUsePaths;
	context.beginPath.mockClear();
	context.lineTo.mockClear();
	renderer.drawEdgePath.call(drawing, edge, context, points, 'solid');
	expect(context.beginPath).not.toHaveBeenCalled();
	expect(context.lineTo).not.toHaveBeenCalled();
	expect(context.stroke).toHaveBeenLastCalledWith(cachedPath);
});

it('draws node images in graph coordinates despite an existing screen Path2D', async () => {
	const core = cytoscape({
		headless: true,
		styleEnabled: true,
		layout: { name: 'preset' },
		elements: [{ data: { id: 'node' }, position: { x: 100, y: 200 } }],
		style: [{ selector: 'node', style: { 'background-clip': 'none' } }],
	});
	try {
		const node = core.$id('node');
		const scratch = (
			node as unknown as {
				_private: { rscratch: { pathCache?: unknown } };
			}
		)._private.rscratch;
		const cached = {};
		scratch.pathCache = cached;
		const drawImage = vi.fn();
		const context = { globalAlpha: 1, drawImage };
		const image = { width: 10, height: 10 };
		const drawing = {
			safeDrawImage: images.safeDrawImage,
			getImgSmoothing: () => true,
			setImgSmoothing: vi.fn(),
		};
		await withDrawingState(core, async () => {
			images.drawInscribedImage.call(drawing, context, image, node, 0, 1);
		});
		expect(drawImage).toHaveBeenCalledWith(
			image,
			0,
			0,
			10,
			10,
			95,
			195,
			10,
			10,
		);
		expect(scratch.pathCache).toBe(cached);
	} finally {
		core.destroy();
	}
});
