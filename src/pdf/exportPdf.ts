import type { Core } from 'cytoscape';
import { jsPDF } from 'jspdf';
import type { ExportArea, PdfFonts } from '../types/public.js';
import { asExportCore, clampRect, withDrawingState } from '../internal/drawingState.js';
import { drawArcTo, type TPoint } from './arc.js';
import { registerPdfFonts, configurePdfFonts, pdfFontSize } from './fonts.js';
const EXPORT_BG = '#ffffff';
const FULL_EXPORT_PADDING = 16;
const MAX_PDF_PT = 14400;
const PX_TO_PT = 72 / 96;
const PNG_MIME = 'image/png';
type TPdfDrawingContext = CanvasRenderingContext2D & {
	autoPaging: boolean;
	path: unknown[];
	ctx: { fillOpacity: number; strokeOpacity: number; font: string };
};

type TApplyPdfOpacity = (fillOpacity?: number) => void;

/** Создаем ф-ю применения параметров прозрачности с кэшированием однотипных вариантов */
const createPdfOpacitySetter = (
	context: TPdfDrawingContext,
	doc: jsPDF,
): TApplyPdfOpacity => {
	// Кэш параметров непрозрачности PDF: повторяющиеся заливки и контуры
	// используют один GState вместо создания объекта для каждого элемента.
	const opacityStates = new Map<string, ReturnType<jsPDF['GState']>>();
	const applyOpacity = (fillOpacity = context.ctx.fillOpacity) => {
		const opacity = fillOpacity * context.globalAlpha;
		const strokeOpacity = context.ctx.strokeOpacity * context.globalAlpha;
		const key = `${opacity},${strokeOpacity}`;
		let state = opacityStates.get(key);
		if (!state) {
			state = doc.GState({ opacity, 'stroke-opacity': strokeOpacity });
			opacityStates.set(key, state);
		}
		// Явно применяем непрозрачность: Canvas-плагин jsPDF сам её не переносит в PDF.
		doc.setGState(state);
	};
	return applyOpacity;
};

const configurePdfOpacity = (
	context: TPdfDrawingContext,
	applyOpacity: TApplyPdfOpacity,
) => {
	// Сохраняем оригиналы, чтобы обёртки вызывали jsPDF, а не сами себя.
	const originalFill: () => void = context.fill;
	const originalStroke: () => void = context.stroke;
	const originalFillRect = context.fillRect;
	const originalStrokeRect = context.strokeRect;
	context.fill = () => {
		if (context.path.length === 0) return;
		applyOpacity();
		originalFill.call(context);
	};
	context.stroke = () => {
		if (context.path.length === 0) return;
		applyOpacity();
		originalStroke.call(context);
	};
	context.fillRect = (x, y, width, height) => {
		applyOpacity();
		originalFillRect.call(context, x, y, width, height);
	};
	context.strokeRect = (x, y, width, height) => {
		applyOpacity();
		originalStrokeRect.call(context, x, y, width, height);
	};
};

const getPdfTextOffset = (
	context: TPdfDrawingContext,
	text: string,
): number => {
	// Сдвиг к левому краю текста: половина ширины для center, вся ширина для right/end.
	switch (context.textAlign) {
		case 'center':
			return context.measureText(text).width / 2;
		case 'right':
		case 'end':
			return context.measureText(text).width;
		default:
			return 0;
	}
};

const configurePdfText = (
	context: TPdfDrawingContext,
	applyOpacity: TApplyPdfOpacity,
) => {
	const canvasContext = document.createElement('canvas').getContext('2d');
	if (!canvasContext)
		throw new Error('Не удалось создать контекст измерения текста');
	// Используем браузерную ширину текста, чтобы сохранить выравнивание подписей.
	context.measureText = (text) => {
		canvasContext.font = context.font;
		return canvasContext.measureText(text);
	};
	// Сдвигаем текст и передаём left, чтобы jsPDF не выравнивал его повторно.
	// После рисования возвращаем исходное выравнивание.
	const originalFillText = context.fillText;
	const originalStrokeText = context.strokeText;

	context.fillText = (text, x, y, maxWidth) => {
		if (pdfFontSize(context.font) === 0) return;
		const offset = getPdfTextOffset(context, text);
		const align = context.textAlign;
		context.textAlign = 'left';
		try {
			applyOpacity();
			originalFillText.call(context, text, x - offset, y, maxWidth);
		} finally {
			context.textAlign = align;
		}
	};

	context.strokeText = (text, x, y, maxWidth) => {
		if (pdfFontSize(context.font) === 0) return;
		const offset = getPdfTextOffset(context, text);
		const align = context.textAlign;
		context.textAlign = 'left';
		try {
			applyOpacity();
			originalStrokeText.call(context, text, x - offset, y, maxWidth);
		} finally {
			context.textAlign = align;
		}
	};
};

/**
 * Настраиваем контекст для отрисовки линий
 * Подготавливает построение геометрии Cytoscape в PDF
 * Добавляет отсутствующий в jsPDF arcTo.
 * */
const configurePdfPaths = (context: TPdfDrawingContext) => {
	// Запоминаем текущую точку: она нужна для расчёта скругления в arcTo.
	let currentPoint: TPoint | null = null;
	// Сохраняем методы jsPDF до замены: обёртки вызывают их с тем же контекстом через call.
	const begin = context.beginPath;
	const move = context.moveTo;
	const line = context.lineTo;
	// Новый контур не продолжает предыдущий: его начальная точка ещё не задана.
	context.beginPath = () => {
		currentPoint = null;
		begin.call(context);
	};
	// Перемещение задаёт текущую точку без рисования отрезка.
	context.moveTo = (x, y) => {
		currentPoint = { x, y };
		move.call(context, x, y);
	};
	context.lineTo = (x, y) => {
		// Без начальной точки Canvas начинает контур здесь; для jsPDF вызываем moveTo.
		if (!currentPoint) context.moveTo(x, y);
		else {
			currentPoint = { x, y };
			line.call(context, x, y);
		}
	};
	// Для обеих кривых запоминаем конечную точку (x, y).
	const quadratic = context.quadraticCurveTo;
	context.quadraticCurveTo = (cx, cy, x, y) => {
		currentPoint = { x, y };
		quadratic.call(context, cx, cy, x, y);
	};
	const bezier = context.bezierCurveTo;
	context.bezierCurveTo = (ax, ay, bx, by, x, y) => {
		currentPoint = { x, y };
		bezier.call(context, ax, ay, bx, by, x, y);
	};
	const arc = context.arc;
	context.arc = (x, y, radius, start, end, counterclockwise) => {
		arc.call(context, x, y, radius, start, end, counterclockwise);
		// arc получает центр и углы; вычисляем конец дуги, откуда продолжится следующий участок.
		currentPoint = {
			x: x + radius * Math.cos(end),
			y: y + radius * Math.sin(end),
		};
	};
	// arcTo строит скругление от текущей точки; drawArcTo заменяет его командами lineTo и arc.
	context.arcTo = (x1, y1, x2, y2, radius) =>
		drawArcTo(context, currentPoint, x1, y1, x2, y2, radius);
};

/** Подготавливает изображения Cytoscape для PDF.
 * Обрезает и масштабирует их через Canvas, затем передаёт jsPDF готовый PNG.
 * */
const configurePdfImages = (
	context: TPdfDrawingContext,
	doc: jsPDF,
	applyOpacity: TApplyPdfOpacity,
) => {
	// jsPDF повторно запрашивает сведения об одном PNG; кэш сохраняем результат разбора на время экспорта.
	const imageProperties = new Map<
		string,
		ReturnType<jsPDF['getImageProperties']>
	>();
	const getImageProperties = doc.getImageProperties;
	// Ключом служит PNG-строка; остальные виды источников обрабатывает исходный метод.
	doc.getImageProperties = (source) => {
		if (typeof source !== 'string')
			return getImageProperties.call(doc, source);
		let value = imageProperties.get(source);
		if (!value) {
			value = getImageProperties.call(doc, source);
			imageProperties.set(source, value);
		}
		return value;
	};
	// Для каждого источника храним PNG-копии с разной обрезкой и размером, чтобы не готовить их повторно.
	const rasterImages = new Map<CanvasImageSource, Map<string, string>>();

	// Сохраняем исходный drawImage jsPDF: после подготовки PNG он разместит картинку в PDF.
	const drawImage: (
		image: CanvasImageSource,
		x: number,
		y: number,
		width: number,
		height: number,
	) => void = context.drawImage;

	context.drawImage = (image, ...coordinates: number[]) => {
		const source = image as CanvasImageSource & {
			width: number;
			height: number;
			nodeName: string;
		};
		let sourceX = 0,
			sourceY = 0,
			sourceWidth = source.width,
			sourceHeight = source.height;
		let targetX: number,
			targetY: number,
			targetWidth: number,
			targetHeight: number;
		// 2 координаты — позиция; 4 — позиция и размер; 8 — ещё и область обрезки источника.
		if (coordinates.length === 2) {
			[targetX, targetY] = coordinates;
			targetWidth = sourceWidth;
			targetHeight = sourceHeight;
		} else if (coordinates.length === 4) {
			[targetX, targetY, targetWidth, targetHeight] = coordinates;
		} else if (coordinates.length === 8) {
			[
				sourceX,
				sourceY,
				sourceWidth,
				sourceHeight,
				targetX,
				targetY,
				targetWidth,
				targetHeight,
			] = coordinates;
		} else {
			throw new Error('Неподдерживаемые аргументы drawImage');
		}

		let cache: Map<string, string> | undefined;
		// Cytoscape создаёт вспомогательные Canvas для кэша отрисованных элементов и слоёв.
		// кэш может меняться, а изображение на холсте может оставаться прежним, по этому не кэшируем source CANVAS
		if (source.nodeName !== 'CANVAS') {
			cache = rasterImages.get(image);
			if (!cache) {
				cache = new Map();
				rasterImages.set(image, cache);
			}
		}

		// Ключ учитывает обрезку и размер, положение на странице не меняет изображение.
		const key = JSON.stringify([
			sourceX,
			sourceY,
			sourceWidth,
			sourceHeight,
			targetWidth,
			targetHeight,
		]);

		let png = cache?.get(key);
		if (!png) {
			// На отдельном Canvas вырезаем нужную часть картинки и приводим её
			// к заданному размеру, затем передаём результат в jsPDF как PNG.
			const canvas = document.createElement('canvas');
			canvas.width = targetWidth;
			canvas.height = targetHeight;
			const raster = canvas.getContext('2d');
			if (!raster || !canvas.width || !canvas.height)
				throw new Error('Не удалось подготовить изображение');

			raster.drawImage(
				image,
				sourceX,
				sourceY,
				sourceWidth,
				sourceHeight,
				0,
				0,
				targetWidth,
				targetHeight,
			);
			// PNG сохраняет прозрачный фон изображения; строка также служит ключом для сведений jsPDF.
			png = canvas.toDataURL(PNG_MIME);
			cache?.set(key, png);
		}
		// Картинка учитывает globalAlpha, но не прозрачность цвета предыдущей заливки.
		applyOpacity(1);
		// Передаём готовый PNG в исходный метод jsPDF; приведение типа нужно из-за типизации Canvas API.
		drawImage.call(
			context,
			png as unknown as CanvasImageSource,
			targetX,
			targetY,
			targetWidth,
			targetHeight,
		);
	};
};

/** Дополняем Canvas API jsPDF для точного рисования Cytoscape.
 * Кэшируем варианты Opacity и изображения, сохраняя кэши на один экспорт. */
const createPdfDrawingContext = (doc: jsPDF, fonts: PdfFonts): TPdfDrawingContext => {
	const nativeContext = doc.context2d as unknown as TPdfDrawingContext;
	// Наследуем Canvas API jsPDF, чтобы переопределить только методы
	// и свойства, требующие поправок для renderer Cytoscape.
	const context = Object.create(nativeContext) as TPdfDrawingContext;
	// Отключаем автосоздание страниц: весь кадр должен остаться на одной.
	context.autoPaging = false;
	const applyOpacity = createPdfOpacitySetter(context, doc);
	configurePdfFonts(context, nativeContext, fonts);
	configurePdfOpacity(context, applyOpacity);
	configurePdfText(context, applyOpacity);
	configurePdfPaths(context);
	configurePdfImages(context, doc, applyOpacity);
	return context;
};

type TPdfFrame = {
	frame: ExportArea;
	pixelsPerGraphUnit: number;
};

const getFullPdfFrame = (graphCore: Core): TPdfFrame => {
	// Полная схема не зависит от камеры. Подписи включаем, чтобы они не обрезались;
	// подсветку взаимодействия исключаем, чтобы она не увеличивала страницу.
	const bbox = asExportCore(graphCore)
		.mutableElements()
		.boundingBox({ includeLabels: true, includeOverlays: false });
	const frame = {
		x: bbox.x1 - FULL_EXPORT_PADDING,
		y: bbox.y1 - FULL_EXPORT_PADDING,
		w: Math.max(1, bbox.w) + FULL_EXPORT_PADDING * 2,
		h: Math.max(1, bbox.h) + FULL_EXPORT_PADDING * 2,
	};
	return { frame, pixelsPerGraphUnit: 1 };
};

const getAreaPdfFrame = (graphCore: Core, area: ExportArea): TPdfFrame => {
	// Overlay задаёт область в CSS px относительно контейнера. Учитываем его
	// отображаемый размер, затем отменяем преобразование камеры: экран = граф * zoom + pan.
	const container = graphCore.container();
	const bounds = container?.getBoundingClientRect();
	const viewportWidth = container?.clientWidth ?? graphCore.width();
	const viewportHeight = container?.clientHeight ?? graphCore.height();
	const ratioX = bounds?.width ? viewportWidth / bounds.width : 1;
	const ratioY = bounds?.height ? viewportHeight / bounds.height : 1;
	const rect = clampRect(
		{
			x: area.x * ratioX,
			y: area.y * ratioY,
			w: area.w * ratioX,
			h: area.h * ratioY,
		},
		viewportWidth,
		viewportHeight,
	);
	const zoom = graphCore.zoom();
	const pan = graphCore.pan();
	const frame = {
		x: (rect.x - pan.x) / zoom,
		y: (rect.y - pan.y) / zoom,
		w: rect.w / zoom,
		h: rect.h / zoom,
	};
	// Размер страницы области соответствует выбранному экранному прямоугольнику.
	return { frame, pixelsPerGraphUnit: zoom };
};

/**
 * Renderer Cytoscape рассчитывает формы, подписи и порядок наложения элементов;
 * наш контекст записывает его Canvas-команды сразу в PDF. Это позволяет не создавать
 * большой SVG и не обходить его повторно конвертером ради тех же фигур.
 * Вызывающий код выбирает стили; подготовка экспорта ждёт фоновые картинки.
 * Здесь размещаем граф на одной странице и запускаем рисование.
 *
 * Координаты и размеры элементов: https://js.cytoscape.org/#eles.boundingBox
 * Canvas-команды в PDF: https://parallax.github.io/jsPDF/docs/module-context2d.html
 * Внутренний renderer (версия проекта):
 * https://github.com/cytoscape/cytoscape.js/tree/v3.32.0/src/extensions/renderer
 */
const captureGraphicsPdf = async (
	graphCore: Core,
	fonts: PdfFonts,
	area?: ExportArea | null,
): Promise<Blob> => {
	if (graphCore.elements().length === 0) {
		throw new Error('На схеме нет элементов для экспорта');
	}
	const core = asExportCore(graphCore);
	const { frame, pixelsPerGraphUnit } = area
		? getAreaPdfFrame(graphCore, area)
		: getFullPdfFrame(graphCore);
	// Единый масштаб переводит граф в points и сохраняет пропорции фигур.
	// При превышении предела jsPDF уменьшаем весь кадр, а не обрезаем страницу.
	// Источник: https://parallax.github.io/jsPDF/docs/jspdf.js.html
	const scale = Math.min(
		PX_TO_PT * pixelsPerGraphUnit,
		MAX_PDF_PT / Math.max(frame.w, frame.h),
	);
	const width = frame.w * scale;
	const height = frame.h * scale;
	// Пользователь экспортирует одну схему, поэтому создаём одну страницу её размера.
	// Ориентация согласована с width/height, чтобы jsPDF не поменял стороны местами.
	// Сжатие и исключение неиспользованных шрифтов сокращают размер готового файла.
	const doc = new jsPDF({
		orientation: width >= height ? 'landscape' : 'portrait',
		unit: 'pt',
		format: [width, height],
		compress: true,
		putOnlyUsedFonts: true,
	});
	// В PDF встраиваем TTF, переданные вызывающим приложением.
	registerPdfFonts(doc, fonts);
	// createPdfDrawingContext дополняет Canvas API jsPDF:
	// измеряет текст через canvas, реализует arcTo и согласует
	// рисование изображений. Это позволяет renderer Cytoscape рисовать
	// через PDF-контекст с геометрией фигур и подписей.
	const context = createPdfDrawingContext(doc, fonts);
	const renderer = core.renderer();
	const originalUsePaths = renderer.usePaths;
	try {
		// Стили могли измениться перед экспортом. Пересчитываем зависимую от них
		// геометрию renderer, иначе рисование может использовать прежние размеры
		// и положения подписей из кэша.
		renderer.flushRenderedStyleQueue();
		// Path2D — объект браузера, который PDF-контекст не умеет читать. Отключаем
		// этот режим, чтобы renderer передал геометрию
		// обычными командами moveTo/lineTo/arc, которые адаптер может записать в PDF.
		renderer.usePaths = () => false;

		// Фон должен закрыть всю страницу, включая поля. Рисуем его до scale/translate:
		// иначе прямоугольник тоже уменьшится и сдвинется вместе со схемой.
		context.fillStyle = EXPORT_BG;
		context.fillRect(0, 0, width, height);
		// Ограничиваем рисунок страницей до преобразования координат. Рисуем все
		// элементы: в область может попадать часть связи, подписи или картинки,
		// даже если сам узел находится снаружи. Обрезка сохраняет эти пересечения.
		doc.rect(0, 0, width, height, null);
		doc.clip();
		doc.discardPath();
		context.scale(scale, scale);
		// Начало кадра переносим к началу страницы; отрицательные координаты допустимы.
		context.translate(-frame.x, -frame.y);
		// Порядок обхода влияет на перекрытия: нарисованное позже закрывает предыдущее.
		// Берём порядок самого renderer, чтобы узлы, связи и подписи перекрывали друг
		// друга так же, как на экране, а не в случайном порядке коллекции.
		renderer.drawElements(context, renderer.getCachedZSortedEles());
		// Blob передаёт готовые байты вызывающему коду: он использует общий механизм
		// сохранения для всех форматов. Эта функция отвечает только за содержимое PDF.
		return doc.output('blob');
	} finally {
		// Использован renderer открытой схемы, а не отдельная копия для экспорта.
		// Поэтому обязательно возвращаем его режим, в том числе при ошибке: иначе
		// экранная отрисовка останется без оптимизации Path2D. Кэши строятся заново.
		renderer.usePaths = originalUsePaths;
	}
};

export const exportPdf = (
	core: Core,
	options: { area?: ExportArea; fonts: PdfFonts },
): Promise<Blob> =>
	withDrawingState(core, () =>
		captureGraphicsPdf(core, options.fonts, options.area),
	);
