export type ExportArea = {
	x: number;
	y: number;
	w: number;
	h: number;
};

/** One embedded family for PDF text; supply each style used by the graph. */
export type PdfFonts = {
	family: string;
	normal: ArrayBuffer;
	bold?: ArrayBuffer;
	italic?: ArrayBuffer;
	bolditalic?: ArrayBuffer;
};
