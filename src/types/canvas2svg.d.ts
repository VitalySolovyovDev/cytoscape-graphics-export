declare module 'canvas2svg' {
	export default class Canvas2Svg {
		constructor(options: { width: number; height: number });
		getSvg(): SVGSVGElement;
	}
}
