import type { Core } from "cytoscape";
import type { ExportArea } from "../types/public.js";
import {
	clampRect,
	waitForBackgroundImages,
} from "../internal/drawingState.js";

const EXPORT_BG = "#ffffff";
const MAX_EXPORT_PX = 8192;
const AREA_EXPORT_SCALE = 2;
const PNG_MIME = "image/png";

type TPngFrame = {
	blob: Blob;
	width: number;
	height: number;
};

const pngToBlob = async (
	graphCore: Core,
	options: Parameters<Core["png"]>[0],
): Promise<Blob> => {
	const result = graphCore.png({
		...options,
		output: "blob-promise",
		bg: options?.bg ?? EXPORT_BG,
	});

	return result as Promise<Blob>;
};

const readPngFrame = async (blob: Blob): Promise<TPngFrame> => {
	const bitmap = await createImageBitmap(blob);
	const frame = { blob, width: bitmap.width, height: bitmap.height };
	bitmap.close();
	return frame;
};

const cropPng = async (frame: TPngFrame, rect: ExportArea): Promise<Blob> => {
	const crop = clampRect(rect, frame.width, frame.height);
	const bitmap = await createImageBitmap(frame.blob);
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(crop.w);
	canvas.height = Math.round(crop.h);
	const ctx = canvas.getContext("2d");

	if (!ctx) {
		bitmap.close();
		throw new Error("Unable to create a canvas");
	}

	try {
		ctx.drawImage(
			bitmap,
			crop.x,
			crop.y,
			canvas.width,
			canvas.height,
			0,
			0,
			canvas.width,
			canvas.height,
		);
	} finally {
		bitmap.close();
	}

	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(result) =>
				result
					? resolve(result)
					: reject(new Error("Unable to encode the PNG image")),
			PNG_MIME,
		);
	});
};

const captureGraphicsPng = async (
	graphCore: Core,
	area?: ExportArea | null,
): Promise<Blob> => {
	if (graphCore.elements().length === 0) {
		throw new Error("The graph has no elements to export");
	}

	if (area) {
		const container = graphCore.container();
		const width = container?.clientWidth ?? graphCore.width();
		const bounds = container?.getBoundingClientRect();
		const ratioX = bounds?.width ? width / bounds.width : 1;
		const height = container?.clientHeight ?? graphCore.height();
		const ratioY = bounds?.height ? height / bounds.height : 1;
		const blob = await pngToBlob(graphCore, {
			full: false,
			scale: AREA_EXPORT_SCALE,
			maxWidth: Math.round(width * AREA_EXPORT_SCALE),
			maxHeight: Math.round(height * AREA_EXPORT_SCALE),
			bg: EXPORT_BG,
		});
		const frame = await readPngFrame(blob);
		return cropPng(frame, {
			x: area.x * ratioX * AREA_EXPORT_SCALE,
			y: area.y * ratioY * AREA_EXPORT_SCALE,
			w: area.w * ratioX * AREA_EXPORT_SCALE,
			h: area.h * ratioY * AREA_EXPORT_SCALE,
		});
	}

	const blob = await pngToBlob(graphCore, {
		full: true,
		maxWidth: MAX_EXPORT_PX,
		maxHeight: MAX_EXPORT_PX,
		bg: EXPORT_BG,
	});
	const frame = await readPngFrame(blob);
	if (frame.width < 1 || frame.height < 1) {
		throw new Error("The graph has no elements to export");
	}
	return frame.blob;
};

export const exportPng = async (
	core: Core,
	options: { area?: ExportArea } = {},
): Promise<Blob> => {
	const selected = core.$(":selected");
	try {
		selected.unselect();
		await waitForBackgroundImages(core);
		// PNG использует штатный Canvas renderer; его Path2D-кэш не нужно обходить.
		return await captureGraphicsPng(core, options.area);
	} finally {
		selected.select();
	}
};
