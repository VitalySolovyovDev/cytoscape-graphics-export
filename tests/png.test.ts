import cytoscape from "cytoscape";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { exportPng } from "../src/index.js";

let core: cytoscape.Core;
const png = new Blob(["png"], { type: "image/png" });
const cropped = new Blob(["cropped"], { type: "image/png" });
let drawImage: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
	core = cytoscape({
		headless: true,
		styleEnabled: true,
		elements: [{ data: { id: "n" } }],
	});
	core.$id("n").select();
	drawImage = vi.fn();
	close = vi.fn();
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn(async () => ({ width: 1000, height: 800, close })),
	);
	vi.spyOn(core, "container").mockReturnValue({
		clientWidth: 700,
		clientHeight: 500,
		getBoundingClientRect: () => ({ width: 700, height: 500 }),
	} as unknown as HTMLElement);
	vi.spyOn(core, "png").mockImplementation(() => {
		expect(core.$(":selected").length).toBe(0);
		return Promise.resolve(png) as never;
	});
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		drawImage,
	} as unknown as CanvasRenderingContext2D);
	vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
		(callback) => callback(cropped),
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	core.destroy();
});

it("exports full PNG without changing visibility, camera or cached paths", async () => {
	core.$id("n").style("opacity", 0);
	const scratch = (
		core.$id("n") as unknown as {
			_private: { rscratch: { pathCache: unknown } };
		}
	)._private.rscratch;
	const path = {};
	scratch.pathCache = path;
	const camera = { zoom: core.zoom(), pan: core.pan() };
	expect(await exportPng(core)).toBe(png);
	expect(core.png).toHaveBeenCalledWith({
		full: true,
		maxWidth: 8192,
		maxHeight: 8192,
		bg: "#ffffff",
		output: "blob-promise",
	});
	expect(scratch.pathCache).toBe(path);
	expect(core.$id("n").style("opacity")).toBe("0");
	expect({ zoom: core.zoom(), pan: core.pan() }).toEqual(camera);
	expect(core.$id("n").selected()).toBe(true);
	expect(close).toHaveBeenCalledOnce();
});

it("crops an area at 2x resolution and clips it to raster bounds", async () => {
	expect(
		await exportPng(core, { area: { x: 450, y: 350, w: 100, h: 100 } }),
	).toBe(cropped);
	expect(drawImage).toHaveBeenCalledWith(
		expect.anything(),
		900,
		700,
		100,
		100,
		0,
		0,
		100,
		100,
	);
	expect(core.png).toHaveBeenCalledWith({
		full: false,
		scale: 2,
		maxWidth: 1400,
		maxHeight: 1000,
		bg: "#ffffff",
		output: "blob-promise",
	});
	expect(close).toHaveBeenCalledTimes(2);
	expect(core.$id("n").selected()).toBe(true);
});

it("maps CSS-scaled container coordinates into the raster", async () => {
	vi.spyOn(core, "container").mockReturnValue({
		clientWidth: 700,
		clientHeight: 500,
		getBoundingClientRect: () => ({ width: 1400, height: 1000 }),
	} as unknown as HTMLElement);
	await exportPng(core, { area: { x: 100, y: 50, w: 200, h: 100 } });
	expect(drawImage).toHaveBeenCalledWith(
		expect.anything(),
		100,
		50,
		200,
		100,
		0,
		0,
		200,
		100,
	);
});

it("restores selection when native PNG export rejects", async () => {
	vi.mocked(core.png).mockReturnValue(
		Promise.reject(new Error("Canvas security error")) as never,
	);
	await expect(exportPng(core)).rejects.toThrow("Canvas security error");
	expect(core.$id("n").selected()).toBe(true);
});

it("closes the bitmap and restores selection when crop drawing fails", async () => {
	drawImage.mockImplementation(() => {
		throw new Error("Drawing failed");
	});
	await expect(
		exportPng(core, { area: { x: 0, y: 0, w: 100, h: 100 } }),
	).rejects.toThrow("Drawing failed");
	expect(close).toHaveBeenCalledTimes(2);
	expect(core.$id("n").selected()).toBe(true);
});

it("reports a PNG encoding failure and restores selection", async () => {
	vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback) =>
		callback(null),
	);
	await expect(
		exportPng(core, { area: { x: 0, y: 0, w: 100, h: 100 } }),
	).rejects.toThrow("Unable to encode");
	expect(core.$id("n").selected()).toBe(true);
});

it("rejects an empty graph before native PNG drawing", async () => {
	core.elements().remove();
	await expect(exportPng(core)).rejects.toThrow("no elements");
	expect(core.png).not.toHaveBeenCalled();
});
