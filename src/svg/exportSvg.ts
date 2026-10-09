import type { Core } from 'cytoscape';
import Canvas2Svg from 'canvas2svg';
import type { ExportArea } from '../types/public.js';
import { asExportCore, clampRect, withDrawingState } from '../internal/drawingState.js';
const EXPORT_BG = '#ffffff';
const SVG_MIME = 'image/svg+xml';
const SAFE_SVG_DISPLAY_PX = 8192;
const FULL_EXPORT_PADDING = 16;
const readSvgSize = (
	root: SVGSVGElement,
): { width: number; height: number } => {
	const width = Number.parseFloat(root.getAttribute('width') ?? '');
	const height = Number.parseFloat(root.getAttribute('height') ?? '');
	if (
		Number.isFinite(width) &&
		Number.isFinite(height) &&
		width > 0 &&
		height > 0
	) {
		return { width, height };
	}

	const viewBox = root
		.getAttribute('viewBox')
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (
		viewBox?.length === 4 &&
		Number.isFinite(viewBox[2]) &&
		Number.isFinite(viewBox[3]) &&
		viewBox[2] > 0 &&
		viewBox[3] > 0
	) {
		return { width: viewBox[2], height: viewBox[3] };
	}

	throw new Error('Не удалось определить размер SVG');
};

/** Настраивает кадр готового SVG: область обрезаем, полный рисунок ограничиваем по размеру отображения. */
const configureSvgFrame = (
	root: SVGSVGElement,
	frame: ExportArea,
	{ clip, limitDisplaySize }: { clip: boolean; limitDisplaySize: boolean },
): SVGSVGElement => {
	if (clip) {
		const ns = 'http://www.w3.org/2000/svg';
		const doc = root.ownerDocument;
		const clipId = 'me-export-area-clip';
		const cropped = doc.createElementNS(ns, 'svg');
		cropped.setAttributeNS(
			'http://www.w3.org/2000/xmlns/',
			'xmlns:xlink',
			'http://www.w3.org/1999/xlink',
		);
		// Сохраняем вложенный viewport: замена корневым viewBox меняет сглаживание дробных координат.
		const viewport = doc.createElementNS(ns, 'svg');
		viewport.setAttribute('width', String(frame.w));
		viewport.setAttribute('height', String(frame.h));
		viewport.setAttribute(
			'viewBox',
			`${frame.x} ${frame.y} ${frame.w} ${frame.h}`,
		);
		viewport.setAttribute('overflow', 'hidden');
		viewport.setAttribute('preserveAspectRatio', 'none');
		while (root.firstChild) viewport.appendChild(root.firstChild);
		// Явная граница обрезки скрывает части фигур и подписей за пределами выбранной области.
		const defs = doc.createElementNS(ns, 'defs');
		const clipPath = doc.createElementNS(ns, 'clipPath');
		clipPath.setAttribute('id', clipId);
		const rect = doc.createElementNS(ns, 'rect');
		rect.setAttribute('x', '0');
		rect.setAttribute('y', '0');
		rect.setAttribute('width', String(frame.w));
		rect.setAttribute('height', String(frame.h));
		clipPath.appendChild(rect);
		defs.appendChild(clipPath);
		cropped.appendChild(defs);
		const group = doc.createElementNS(ns, 'g');
		group.setAttribute('clip-path', `url(#${clipId})`);
		group.appendChild(viewport);
		cropped.appendChild(group);
		root = cropped;
		frame = { x: 0, y: 0, w: frame.w, h: frame.h };
	}
	// viewBox выбирает участок в исходных координатах, не меняя геометрию элементов.
	root.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.w} ${frame.h}`);
	root.setAttribute('overflow', clip ? 'hidden' : 'visible');
	root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
	// Большой полный рисунок уменьшаем только при отображении; SVG остаётся векторным.
	const scale = limitDisplaySize
		? Math.min(1, SAFE_SVG_DISPLAY_PX / Math.max(frame.w, frame.h))
		: 1;
	const width = frame.w * scale;
	const height = frame.h * scale;
	root.setAttribute(
		'width',
		String(limitDisplaySize ? +width.toFixed(2) : width),
	);
	root.setAttribute(
		'height',
		String(limitDisplaySize ? +height.toFixed(2) : height),
	);
	return root;
};

const toSvgBlob = (svg: string): Blob => {
	// Заголовок явно задаёт UTF-8 для подписей; уже существующий заголовок сохраняем.
	const markup = svg.startsWith('<?xml')
		? svg
		: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
	// Blob содержит байты SVG-файла и его MIME-тип для общего механизма сохранения.
	return new Blob([markup], {
		type: SVG_MIME,
	});
};

type TSvgDocument = Pick<
	Document,
	'createElement' | 'createElementNS' | 'createTextNode'
>;

/**
 * Canvas2SVG для каждой картинки создаёт canvas, рисует на нём одно изображение
 * и вызывает toDataURL(). Кэшируем этот PNG, сохраняя размеры и обрезку.
 * Кэш живёт только во время одной отрисовки; изменяемые источники CANVAS не кэшируем.
 */
const createRasterCachingDocument = (document: TSvgDocument): TSvgDocument => {
	const pngCache = new Map<string, string>();
	return {
		createElementNS: document.createElementNS.bind(document),
		createTextNode: document.createTextNode.bind(document),
		createElement: ((name: string) => {
			const element = document.createElement(name);
			if (name !== 'canvas') return element;
			const canvas = element as HTMLCanvasElement;
			const context = canvas.getContext('2d');
			if (!context) return canvas;
			const drawImage = context.drawImage.bind(context);
			const toDataURL = canvas.toDataURL.bind(canvas);
			let cacheKey: string | null = null;

			context.drawImage = (image, ...coordinates: number[]) => {
				cacheKey =
					image instanceof HTMLImageElement
						? JSON.stringify([
								image.src,
								canvas.width,
								canvas.height,
								coordinates,
							])
						: null;
				if (cacheKey && pngCache.has(cacheKey)) return;
				// Используем Reflect что бы упростить типизацию перегруженного метода drawImage, которому передаем number[]
				Reflect.apply(drawImage, context, [image, ...coordinates]);
			};
			// Canvas2SVG запрашивает PNG без параметров формата и качества.
			canvas.toDataURL = () => {
				const cached = cacheKey ? pngCache.get(cacheKey) : undefined;
				if (cached !== undefined) return cached;
				const png = toDataURL();
				if (cacheKey) pngCache.set(cacheKey, png);
				return png;
			};
			return canvas;
		}) as Document['createElement'],
	};
};

/** Canvas2SVG при каждом рисовании картинки создает вспомогательный canvas. Для тысяч сотен картинок это дорого.
 * Подключает кэш PNG на время рисования SVG. */
const withRasterImageCache = (
	context: CanvasRenderingContext2D,
	draw: () => void,
): void => {
	const svgContext = context as CanvasRenderingContext2D & {
		__document?: TSvgDocument;
	};
	// Canvas2SVG через svgContext.__document создаёт DOM-элементы, включая вспомогательные canvas.
	const document = svgContext.__document;
	if (!document) {
		draw();
		return;
	}
	try {
		svgContext.__document = createRasterCachingDocument(document);
		draw();
	} finally {
		svgContext.__document = document;
	}
};

type SvgCanvasContext = CanvasRenderingContext2D & {
	__currentElement: SVGElement;
	__closestGroupOrSvg: () => SVGElement;
	__document: TSvgDocument;
};

/** Canvas2SVG не записывает прозрачность картинок и пунктир; дополняем эти команды. */
const configureSvgDrawing = (context: SvgCanvasContext): void => {
	let dash: number[] = [];
	const dashStack: number[][] = [];
	const save = context.save.bind(context);
	const restore = context.restore.bind(context);
	context.save = () => {
		dashStack.push(dash.slice());
		save();
	};
	context.restore = () => {
		dash = dashStack.pop() ?? [];
		restore();
	};
	context.setLineDash = (segments) => {
		dash = Array.from(segments);
	};
	context.getLineDash = () => dash.slice();
	const stroke = context.stroke.bind(context);
	context.stroke = () => {
		stroke();
		if (dash.length)
			context.__currentElement.setAttribute(
				'stroke-dasharray',
				dash.join(','),
			);
	};
	context.drawImage = (image, ...coordinates: number[]) => {
		const source = image as HTMLImageElement | HTMLCanvasElement;
		let sx = 0,
			sy = 0,
			sw = source.width,
			sh = source.height;
		let dx: number, dy: number, dw: number, dh: number;
		if (coordinates.length === 2) {
			[dx, dy] = coordinates;
			dw = sw;
			dh = sh;
		} else if (coordinates.length === 4) {
			[dx, dy, dw, dh] = coordinates;
		} else if (coordinates.length === 8) {
			[sx, sy, sw, sh, dx, dy, dw, dh] = coordinates;
		} else throw new Error('Неподдерживаемые аргументы drawImage');
		// Встраиваем пиксели, чтобы файл не зависел от исходных URL и декодирования вложенного SVG.
		const canvas = context.__document.createElement(
			'canvas',
		) as HTMLCanvasElement;
		canvas.width = dw;
		canvas.height = dh;
		const raster = canvas.getContext('2d');
		if (!raster) throw new Error('Не удалось подготовить изображение');
		raster.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh);
		const element = context.__document.createElementNS(
			'http://www.w3.org/2000/svg',
			'image',
		);
		element.setAttribute('width', String(dw));
		element.setAttribute('height', String(dh));
		element.setAttribute('opacity', String(context.globalAlpha));
		element.setAttribute('preserveAspectRatio', 'none');
		element.setAttribute('transform', `translate(${dx}, ${dy})`);
		element.setAttributeNS(
			'http://www.w3.org/1999/xlink',
			'xlink:href',
			canvas.toDataURL(),
		);
		context.__closestGroupOrSvg().appendChild(element);
	};
};

/** Рисуем команды Cytoscape в SVG-контекст вместо экранного Canvas. */
const captureCytoscapeSvg = (
	core: Core,
	options: { width: number; height: number; full: boolean },
): SVGSVGElement => {
	const renderer = asExportCore(core).renderer();
	const originalUsePaths = renderer.usePaths;
	try {
		renderer.flushRenderedStyleQueue();
		// SVG-контекст принимает команды геометрии, а не браузерные объекты Path2D.
		renderer.usePaths = () => false;
		const svgContext = new Canvas2Svg({
			width: options.width,
			height: options.height,
		});
		const context = svgContext as unknown as SvgCanvasContext;
		configureSvgDrawing(context);
		context.fillStyle = EXPORT_BG;
		context.fillRect(0, 0, options.width, options.height);
		if (options.full) {
			const bounds = asExportCore(core).mutableElements().boundingBox();
			context.translate(-bounds.x1, -bounds.y1);
		} else {
			const pan = core.pan();
			context.translate(pan.x, pan.y);
			context.scale(core.zoom(), core.zoom());
		}
		withRasterImageCache(context, () =>
			renderer.drawElements(context, renderer.getCachedZSortedEles()),
		);
		const root = svgContext.getSvg();
		// XMLSerializer объявляет namespace сам; обычный атрибут Canvas2SVG может его дублировать.
		root.removeAttribute('xmlns');
		return root;
	} finally {
		renderer.usePaths = originalUsePaths;
	}
};

const captureAreaSvg = (graphCore: Core, area: ExportArea): SVGSVGElement => {
	// Рисуем текущий вид с его pan/zoom; выбранную область затем вырезаем из этого SVG.
	const container = graphCore.container();
	const bounds = container?.getBoundingClientRect();
	const svgWidth = container?.clientWidth ?? graphCore.width();
	const svgHeight = container?.clientHeight ?? graphCore.height();
	const svg = captureCytoscapeSvg(graphCore, {
		width: svgWidth,
		height: svgHeight,
		full: false,
	});

	// CSS-масштаб контейнера может отличаться от размера SVG, адаптируем.
	// координатаВSvg = координатаНаЭкране * размерSvg / размерНаЭкране
	const mapped =
		bounds && bounds.width > 0 && bounds.height > 0
			? {
					x: area.x * (svgWidth / bounds.width),
					y: area.y * (svgHeight / bounds.height),
					w: area.w * (svgWidth / bounds.width),
					h: area.h * (svgHeight / bounds.height),
				}
			: area;

	const size = readSvgSize(svg);
	const frame = clampRect(mapped, size.width, size.height);
	return configureSvgFrame(svg, frame, {
		clip: true,
		limitDisplaySize: false,
	});
};

const captureFullSvg = (graphCore: Core): SVGSVGElement => {
	const exportCore = asExportCore(graphCore);
	// allBb задаёт исходную систему координат; contentBb — итоговый кадр с подписями без подсветки.
	const allBb = exportCore.mutableElements().boundingBox();
	// contentBb — границы для итогового кадра: включают элементы и подписи, но исключают overlays
	// — дополнительные области подсветки вокруг элементов. Они могут расширять рамку.
	const contentBb = exportCore.mutableElements().boundingBox({
		includeLabels: true,
		includeOverlays: false,
	});

	const svg = captureCytoscapeSvg(graphCore, {
		width: Math.ceil(allBb.w),
		height: Math.ceil(allBb.h),
		full: true,
	});

	const pad = FULL_EXPORT_PADDING;
	// Задаём итоговый кадр по contentBb с небольшим отступом FULL_EXPORT_PADDING
	return configureSvgFrame(
		svg,
		{
			x: contentBb.x1 - allBb.x1 - pad,
			y: contentBb.y1 - allBb.y1 - pad,
			w: Math.max(1, contentBb.w) + pad * 2,
			h: Math.max(1, contentBb.h) + pad * 2,
		},
		{ clip: false, limitDisplaySize: true },
	);
};

const captureGraphicsSvgRoot = (
	graphCore: Core,
	area?: ExportArea | null,
): SVGSVGElement => {
	if (graphCore.elements().length === 0) {
		throw new Error('На схеме нет элементов для экспорта');
	}

	return area ? captureAreaSvg(graphCore, area) : captureFullSvg(graphCore);
};

/** Преобразуем готовое дерево SVG в текст файла. */
const serializeGraphicsSvg = (root: SVGSVGElement): string => {
	return new XMLSerializer().serializeToString(root);
};

const captureGraphicsSvg = (
	graphCore: Core,
	area?: ExportArea | null,
): string => serializeGraphicsSvg(captureGraphicsSvgRoot(graphCore, area));

export const exportSvg = (
	core: Core,
	options: { area?: ExportArea } = {},
): Promise<Blob> =>
	withDrawingState(core, async () =>
		toSvgBlob(captureGraphicsSvg(core, options.area)),
	);
