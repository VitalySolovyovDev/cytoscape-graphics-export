import type { Core, NodeSingular } from 'cytoscape';
import type { ExportArea } from '../types/public.js';
const IMAGE_WAIT_MS = 8000;
type TGraphicsExportCore = Core & {
	renderer: () => TExportRenderer;
	mutableElements: () => ReturnType<Core['elements']> & {
		boundingBox: (options?: {
			includeLabels?: boolean;
			includeOverlays?: boolean;
		}) => { x1: number; y1: number; w: number; h: number };
	};
};

type TCachedImage = HTMLImageElement & { error?: boolean };

type TExportRenderer = {
	usePaths: () => boolean;
	getCachedZSortedEles: () => readonly unknown[];
	flushRenderedStyleQueue: () => void;
	drawElements: (
		context: CanvasRenderingContext2D,
		elements: readonly unknown[],
	) => void;
	getCachedImage: (
		url: string,
		crossOrigin: string | null,
		onLoad: () => void,
	) => TCachedImage;
};

export type TStyledNode = NodeSingular & {
	pstyle: (name: string) => {
		value: unknown;
		pfValue: number;
		bypass?: boolean;
	};
};

export const asExportCore = (graphCore: Core): TGraphicsExportCore =>
	graphCore as TGraphicsExportCore;

export const clampRect = (
	rect: ExportArea,
	maxWidth: number,
	maxHeight: number,
): ExportArea => {
	const x = Math.max(0, Math.min(rect.x, maxWidth));
	const y = Math.max(0, Math.min(rect.y, maxHeight));
	const w = Math.max(1, Math.min(rect.w, maxWidth - x));
	const h = Math.max(1, Math.min(rect.h, maxHeight - y));
	return { x, y, w, h };
};

const collectBackgroundImageUrls = (node: NodeSingular): string[] => {
	const urls = (node as TStyledNode).pstyle('background-image')?.value;
	const list = Array.isArray(urls) ? urls : urls ? [urls] : [];

	return list
		.map((url) => String(url ?? '').trim())
		.filter((url) => url.length > 0 && url !== 'none');
};

const isExportableNode = (node: NodeSingular): boolean => {
	const styled = node as TStyledNode;
	return styled.pstyle('display')?.value !== 'none';
};

const isImageReady = (image: TCachedImage): boolean =>
	Boolean(image.complete && image.naturalWidth > 0 && !image.error);

const waitForImageReady = (image: TCachedImage): Promise<void> => {
	if (image.error || isImageReady(image)) return Promise.resolve();

	if (typeof image.decode === 'function') {
		return image.decode().then(
			() => undefined,
			() => undefined,
		);
	}

	return new Promise((resolve) => {
		const finish = () => resolve();
		image.addEventListener('load', finish, { once: true });
		image.addEventListener('error', finish, { once: true });
	});
};

const waitForBackgroundImages = async (graphCore: Core): Promise<void> => {
	const renderer = asExportCore(graphCore).renderer();
	if (typeof renderer.getCachedImage !== 'function') return;
	const pending = new Set<TCachedImage>();
	graphCore.nodes().forEach((node) => {
		if (!isExportableNode(node)) return;
		collectBackgroundImageUrls(node).forEach((url) => {
			const image = renderer.getCachedImage(
				url,
				'anonymous',
				() => undefined,
			);
			if (!isImageReady(image) && !image.error) pending.add(image);
		});
	});
	if (pending.size === 0) return;

	await Promise.race([
		Promise.all(Array.from(pending, waitForImageReady)),
		new Promise<void>((resolve) => {
			window.setTimeout(resolve, IMAGE_WAIT_MS);
		}),
	]);
};

/** Снимаем выделение и ждём картинки; выделение возвращаем даже при ошибке. */

export const withDrawingState = async <T>(
	core: Core,
	draw: () => Promise<T>,
): Promise<T> => {
	const selected = core.$(':selected');
	const paths = new Map<{ pathCache?: unknown }, unknown>();
	try {
		selected.unselect();
		await waitForBackgroundImages(core);
		// drawInscribedImage проверяет pathCache без usePaths и иначе сдвигает картинки к (0, 0).
		// Убираем node Path2D только на время рисования командами; затем возвращаем тот же объект.
		core.nodes().forEach((node) => {
			const scratch = (
				node as unknown as {
					_private: { rscratch: { pathCache?: unknown } };
				}
			)._private.rscratch;
			if (scratch.pathCache) {
				paths.set(scratch, scratch.pathCache);
				scratch.pathCache = null;
			}
		});
		return await draw();
	} finally {
		paths.forEach((path, scratch) => {
			scratch.pathCache = path;
		});
		selected.select();
	}
};
