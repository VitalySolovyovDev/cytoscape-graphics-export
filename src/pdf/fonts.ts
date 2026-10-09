import type { jsPDF } from 'jspdf';
import type { PdfFonts } from '../types/public.js';

const arrayBufferToBinaryString = (buffer: ArrayBuffer): string => {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + chunkSize),
		);
	}
	return binary;
};

export const registerPdfFonts = (doc: jsPDF, fonts: PdfFonts): void => {
	if (!fonts.family?.trim()) throw new Error('PDF font family is required');
	const files = new Map<ArrayBuffer, string>();
	for (const style of ['normal', 'bold', 'italic', 'bolditalic'] as const) {
		const data = fonts[style];
		if (!data) continue;
		let file = files.get(data);
		if (!file) {
			file = `export-font-${files.size}.ttf`;
			doc.addFileToVFS(file, arrayBufferToBinaryString(data));
			files.set(data, file);
		}
		// Register exactly the styles supplied; reusing bytes is the caller's choice.
		doc.addFont(file, fonts.family, style, 'Identity-H');
	}
	doc.setFont(fonts.family, 'normal');
};

// Canvas font contains the size before px; zero-size text is not drawn.
export const pdfFontSize = (font: string): number =>
	Number.parseFloat(font.split('px')[0].trim().split(' ').at(-1) ?? '');

type FontContext = { font: string; ctx: { font: string } };

export const configurePdfFonts = (
	context: FontContext,
	nativeContext: FontContext,
	fonts: PdfFonts,
): void => {
	// jsPDF's own font property is fixed; override it on the drawing wrapper.
	Object.defineProperty(context, 'font', {
		get: () => nativeContext.font,
		set: (value: string) => {
			const end = value.indexOf('px');
			const font =
				end < 0 ? value : `${value.slice(0, end + 2)} "${fonts.family}"`;
			if (pdfFontSize(font) === 0) {
				nativeContext.ctx.font = font;
				return;
			}
			// Match the normal/bold/italic styles supported by jsPDF's Canvas plugin.
			const tokens = value.slice(0, end).trim().split(' ');
			tokens.pop(); // Last token is the font size, not its weight.
			const bold =
				tokens.includes('bold') || tokens.some((token) => Number(token) >= 700);
			const italic = tokens.includes('italic');
			const style = bold
				? italic
					? 'bolditalic'
					: 'bold'
				: italic
					? 'italic'
					: 'normal';
			if (!fonts[style])
				throw new Error(`Missing PDF font style: ${fonts.family} ${style}`);
			nativeContext.font = font;
		},
	});
};
