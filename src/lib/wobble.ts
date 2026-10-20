/**
 * The celebration's motion (v0.16.68–0.16.69, the user's design, 21 Oct
 * 2026), for the gold medal in To finish's rows and the gold box in the
 * sidebar: the first child of the node is stretched sideways and snaps back,
 * overshooting and settling, for 0.9 s, then rests for 0.4 s, and as it snaps
 * back a few gold sparks fly off from the node's middle. Nothing moves under
 * reduced motion, and nothing is started while the tab is hidden.
 */
export interface WobbleOptions {
	/** Whether it moves now; false holds it still without taking the action off. */
	active?: boolean;
	/** How far it stretches: 0.8 for the small medal, gentler on a big box. */
	strength: number;
	/** Sparks per snap; 0 for none. */
	sparks: number;
	/** Where a spark starts and about how far it flies, px from the middle. */
	from: number;
	to: number;
	/** A spark's thickness and its shortest length, px. */
	thick: number;
	long: number;
}

const WOBBLE_MS = 900;
const PAUSE_MS = 400;
/** How far into the wobble it snaps back, where the sparks start. */
const SNAP = 0.34;

function frames(k: number): Keyframe[] {
	const steps: [number, number, number][] = [
		[0, 1, 1],
		[0.16, 1 + 0.3 * k, 1 - 0.22 * k],
		[0.34, 1 - 0.2 * k, 1 + 0.18 * k],
		[0.52, 1 + 0.11 * k, 1 - 0.08 * k],
		[0.7, 1 - 0.05 * k, 1 + 0.04 * k],
		[0.86, 1 + 0.02 * k, 1 - 0.01 * k],
		[1, 1, 1]
	];
	return steps.map(([offset, x, y]) => ({ offset, transform: `scale(${x}, ${y})`, easing: 'cubic-bezier(.33,.7,.4,1)' }));
}

function spark(node: HTMLElement, angle: number, o: WobbleOptions) {
	const dot = Math.random() < 0.33;
	const long = dot ? o.thick * 1.5 : o.long * (1 + Math.random() * 0.8);
	const high = dot ? o.thick * 1.5 : o.thick;
	const to = o.to * (0.85 + Math.random() * 0.35);
	const el = document.createElement('span');
	Object.assign(el.style, {
		position: 'absolute',
		left: '50%',
		top: '50%',
		width: `${long}px`,
		height: `${high}px`,
		marginLeft: `${-long / 2}px`,
		marginTop: `${-high / 2}px`,
		borderRadius: '999px',
		background: 'var(--gold-soft)',
		boxShadow: '0 0 4px rgba(242, 193, 78, 0.9)',
		pointerEvents: 'none'
	});
	node.appendChild(el);
	const duration = 500 + Math.random() * 400;
	// Removed on a timer too: a tab that is not drawing never finishes the animation.
	setTimeout(() => el.remove(), duration + 200);
	el.animate(
		[
			{ transform: `rotate(${angle}deg) translateX(${o.from}px) scaleX(.4)`, opacity: 0 },
			{ transform: `rotate(${angle}deg) translateX(${o.from + (to - o.from) * 0.25}px) scaleX(1)`, opacity: 1, offset: 0.18 },
			{ transform: `rotate(${angle}deg) translateX(${to}px) scaleX(.25)`, opacity: 0 }
		],
		{ duration, easing: 'cubic-bezier(.2,.7,.3,1)' }
	);
}

/** Svelte action: `use:wobble={options}` on a positioned wrapper round what wobbles. */
export function wobble(node: HTMLElement, options: WobbleOptions) {
	let o = options;
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { update: (next: WobbleOptions) => (o = next) };
	const pending = new Set<ReturnType<typeof setTimeout>>();
	// One timer drives both, so the sparks stay on the snap however long it runs.
	const once = () => {
		if (document.hidden || o.active === false) return;
		(node.firstElementChild as HTMLElement | SVGElement | null)?.animate(frames(o.strength), { duration: WOBBLE_MS });
		const snap = setTimeout(() => {
			pending.delete(snap);
			for (let i = 0; i < o.sparks; i++) spark(node, (i / o.sparks) * 360 + (Math.random() * 30 - 15) - 90, o);
		}, SNAP * WOBBLE_MS);
		pending.add(snap);
	};
	once();
	const loop = setInterval(once, WOBBLE_MS + PAUSE_MS);
	return {
		update(next: WobbleOptions) {
			o = next;
		},
		destroy() {
			clearInterval(loop);
			for (const t of pending) clearTimeout(t);
		}
	};
}
