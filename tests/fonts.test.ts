import type { jsPDF } from 'jspdf';
import { expect, it, vi } from 'vitest';
import { configurePdfFonts, registerPdfFonts } from '../src/pdf/fonts.js';

it('registers the supplied family and each distinct style without substitution', () => {
	const fonts = {
		family: 'Graph Font',
		normal: new ArrayBuffer(1),
		bold: new ArrayBuffer(2),
		italic: new ArrayBuffer(3),
		bolditalic: new ArrayBuffer(4),
	};
	const doc = { addFileToVFS: vi.fn(), addFont: vi.fn(), setFont: vi.fn() };
	registerPdfFonts(doc as unknown as jsPDF, fonts);
	expect(doc.addFileToVFS).toHaveBeenCalledTimes(4);
	expect(doc.addFont.mock.calls.map((call) => call.slice(1))).toEqual([
		['Graph Font', 'normal', 'Identity-H'],
		['Graph Font', 'bold', 'Identity-H'],
		['Graph Font', 'italic', 'Identity-H'],
		['Graph Font', 'bolditalic', 'Identity-H'],
	]);
	expect(doc.setFont).toHaveBeenCalledWith('Graph Font', 'normal');
});

it('does not register missing styles; reuses bytes only when explicitly supplied', () => {
	const normal = new ArrayBuffer(2);
	const doc = { addFileToVFS: vi.fn(), addFont: vi.fn(), setFont: vi.fn() };
	registerPdfFonts(doc as unknown as jsPDF, {
		family: 'Example',
		normal,
		bold: normal,
	});
	expect(doc.addFileToVFS).toHaveBeenCalledOnce();
	expect(doc.addFont.mock.calls.map((call) => call[2])).toEqual([
		'normal',
		'bold',
	]);
	expect(doc.addFont.mock.calls[0][0]).toBe(doc.addFont.mock.calls[1][0]);
});

it('requires an explicit family', () => {
	expect(() =>
		registerPdfFonts({} as jsPDF, { family: '', normal: new ArrayBuffer(1) }),
	).toThrow('family is required');
});

it.each([
	'bold 18px Arial',
	'700 18px Arial',
	'italic 18px Arial',
	'italic bold 18px Arial',
])('reports a missing style instead of silently substituting it: %s', (font) => {
	const native = { font: '', ctx: { font: '' } };
	const context = Object.create(native) as typeof native;
	configurePdfFonts(context, native, {
		family: 'Example',
		normal: new ArrayBuffer(1),
	});
	expect(() => {
		context.font = font;
	}).toThrow('Missing PDF font style');
});

it('quotes family names with spaces and preserves supplied bold/italic styles', () => {
	const data = new ArrayBuffer(1);
	const native = { font: '', ctx: { font: '' } };
	const context = Object.create(native) as typeof native;
	configurePdfFonts(context, native, {
		family: 'Graph Font',
		normal: data,
		bolditalic: data,
	});
	context.font = 'italic bold 18px Arial';
	expect(native.font).toBe('italic bold 18px "Graph Font"');
});

it('accepts zero-size hidden text without requiring its unused style', () => {
	const native = { font: '', ctx: { font: '' } };
	const context = Object.create(native) as typeof native;
	configurePdfFonts(context, native, {
		family: 'Example',
		normal: new ArrayBuffer(1),
	});
	context.font = 'italic 0px Arial';
	expect(native.ctx.font).toBe('italic 0px "Example"');
	expect(native.font).toBe('');
});
