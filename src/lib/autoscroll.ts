/**
 * How fast a scroller should move while something is dragged near its edge.
 *
 * The browser swallows wheel events for the length of a native drag, so a
 * card could not be dragged to an hour that was off screen without this. The
 * speed is zero outside the edge zone and grows linearly to `maxStep` at the
 * very edge, negative towards the top and positive towards the bottom, so a
 * pointer resting just inside the zone creeps and one pressed to the edge
 * moves at full speed.
 */
export const EDGE_PX = 72;
export const MAX_STEP_PX = 18;

export function edgeVelocity(
	pointerY: number,
	top: number,
	bottom: number,
	edge = EDGE_PX,
	maxStep = MAX_STEP_PX
): number {
	if (!(edge > 0) || bottom <= top) return 0;
	const fromTop = pointerY - top;
	const fromBottom = bottom - pointerY;
	if (fromTop < edge) return -maxStep * (1 - Math.max(0, fromTop) / edge);
	if (fromBottom < edge) return maxStep * (1 - Math.max(0, fromBottom) / edge);
	return 0;
}
