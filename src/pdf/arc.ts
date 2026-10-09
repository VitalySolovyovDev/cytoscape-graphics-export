export type TPoint = { x: number; y: number };

/**
 * jsPDF не реализует Canvas.arcTo. Строим скругление угла: от текущей точки
 * к (x1, y1), затем к (x2, y2). Прямая заканчивается в точке касания окружности.
 * Источник математики скруглений: https://raw.org/math/geometry/rounded-corners-on-path-segment/
 */
export const drawArcTo = (
	context: CanvasRenderingContext2D,
	currentPoint: TPoint | null,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	radius: number,
): void => {
	if (!currentPoint) {
		context.moveTo(x1, y1);
		return;
	}
	const incomingLength = Math.hypot(currentPoint.x - x1, currentPoint.y - y1);
	const outgoingLength = Math.hypot(x2 - x1, y2 - y1);
	if (!incomingLength || !outgoingLength || !radius) {
		context.lineTo(x1, y1);
		return;
	}
	// Единичные векторы из вершины угла к предыдущей и следующей точке.
	const incoming = {
		x: (currentPoint.x - x1) / incomingLength,
		y: (currentPoint.y - y1) / incomingLength,
	};
	const outgoing = {
		x: (x2 - x1) / outgoingLength,
		y: (y2 - y1) / outgoingLength,
	};
	const crossProduct = incoming.x * outgoing.y - incoming.y * outgoing.x;
	if (Math.abs(crossProduct) < 1e-12) {
		context.lineTo(x1, y1);
		return;
	}
	const angle = Math.acos(
		Math.max(
			-1,
			Math.min(1, incoming.x * outgoing.x + incoming.y * outgoing.y),
		),
	);
	const tangentDistance = radius / Math.tan(angle / 2);
	const start = {
		x: x1 + incoming.x * tangentDistance,
		y: y1 + incoming.y * tangentDistance,
	};
	const end = {
		x: x1 + outgoing.x * tangentDistance,
		y: y1 + outgoing.y * tangentDistance,
	};
	const normal =
		crossProduct < 0
			? { x: incoming.y, y: -incoming.x }
			: { x: -incoming.y, y: incoming.x };
	const center = {
		x: start.x + normal.x * radius,
		y: start.y + normal.y * radius,
	};
	context.lineTo(start.x, start.y);
	context.arc(
		center.x,
		center.y,
		radius,
		Math.atan2(start.y - center.y, start.x - center.x),
		Math.atan2(end.y - center.y, end.x - center.x),
		crossProduct > 0,
	);
};
