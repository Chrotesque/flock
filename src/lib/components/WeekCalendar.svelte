<script lang="ts" generics="T extends { id: string; date: string; time: string }">
	import { edgeVelocity } from '$lib/autoscroll';
	import { portal } from '$lib/portal';
	import { general } from '$lib/stores/general.svelte';
	import { calendarZone } from '$lib/stores/calendarzone.svelte';
	import { clock, zoneTime } from '$lib/timezones';
	import { tick, untrack, type Snippet } from 'svelte';
	import {
		isoDate,
		startOfWeek,
		addDays,
		weekLabel,
		hourOf,
		minuteOf,
		makeTime,
		dayLabel,
		dayStart,
		rangeLabel,
		relativeTo,
		MONTH_NAMES
	} from '$lib/format';

	// The time-grid, shared by the upload wizard's schedule step and the
	// standalone Calendar so the two cannot drift apart visually. Both show a
	// rolling run of `dayCount` days (`rolling`) — the schedule step from
	// today, the Calendar from two days before (`lead`) — so the days that
	// matter are never split across two weeks.
	//
	// Placement, drag plumbing and off-screen tracking live here; what a card
	// *looks* like is the caller's `card` snippet (in practice always PostCard).
	let {
		items,
		headItems,
		weekStart = $bindable(startOfWeek(new Date())),
		card,
		toolbar,
		center,
		start,
		marker,
		offscreen,
		dense = false,
		rowSpace = 0,
		allHours = false,
		quarters = false,
		dayCount = 7,
		rolling = false,
		lead = 0,
		groupOf,
		past,
		groupTip,
		groupLabel,
		candrag,
		lockedWhy,
		landWhy,
		blocked,
		overridden = false,
		ondropitem,
		ondropgroup,
		oncontext
	}: {
		items: T[];
		/**
		 * What the day heads' markers show, when it differs from the cards:
		 * an item here and not in `items` is marked on its day but sits in no
		 * hour. Defaults to `items`.
		 */
		headItems?: T[];
		/** The first day shown: a Monday, or with `rolling` any day — today to begin with. */
		weekStart?: Date;
		/** How many days are shown side by side. */
		dayCount?: number;
		/** Starts on any day, "Today" resets it, and the label names days rather than the month. */
		rolling?: boolean;
		/** With `rolling`, how many days before today "Today" puts first. */
		lead?: number;
		/**
		 * Items of one group in one hour are boxed together — the Calendar's
		 * posts of one upload. Each stays its own card, dragged on its own.
		 */
		groupOf?: (item: T) => string;
		/**
		 * With `groupOf`, a box whose items are all past is drawn receded —
		 * on the box, since the platforms' marks may not be greyed.
		 */
		past?: (item: T) => boolean;
		/** With `groupOf`, what hovering a box opens: given the box's items. */
		groupTip?: Snippet<[T[]]>;
		/**
		 * With `groupOf`, a line under a box's icons — the Calendar's product
		 * name while editing; '' for none. The box grows to hold it, and a line
		 * too long for it ends in "…".
		 */
		groupLabel?: (items: T[]) => string;
		card: Snippet<[T]>;
		/** The bar's right end. */
		toolbar?: Snippet;
		/** The bar's middle, centred between the week's arrows and the toolbar. */
		center?: Snippet;
		/** Beside the Today button, at the bar's left. */
		start?: Snippet;
		/** Rendered in a day's column header, once per item scheduled that day. */
		marker?: Snippet<[T]>;
		/**
		 * Rendered for an item whose card is scrolled out of view, with the
		 * direction it lies in and a callback that scrolls it into the middle.
		 */
		offscreen?: Snippet<[T, 'up' | 'down', () => void]>;
		/**
		 * Cards flow across a cell rather than stacking, and an hour row is only
		 * as tall as its label. For icon-sized cards — stacking four of them
		 * would treble the row height for no gain.
		 */
		dense?: boolean;
		/** With `dense`, room added above and below each hour's cards, in px. */
		rowSpace?: number;
		/** Every hour at once: the grid is as tall as its 24 rows, with no scrolling inside it. */
		allHours?: boolean;
		/**
		 * After a drop, offers that hour's quarters (:00, :15, :30, :45) beside
		 * the card; a choice comes back through `ondropitem` with its minute.
		 */
		quarters?: boolean;
		/**
		 * Per item, so a grid can be partly editable — the Calendar allows
		 * upcoming releases to be moved while released ones stay put. Omitted
		 * means nothing is draggable.
		 */
		candrag?: (item: T) => boolean;
		/**
		 * While dropping is on, why an item that cannot be dragged stays put: a
		 * press on it shakes it and says so. '' (or none) for no reason given.
		 */
		lockedWhy?: (item: T) => string;
		/** Why an item may not land at a day and time; '' when it may. Shown while it is held, and a drop there is refused. */
		landWhy?: (item: T, date: string, time: string) => string;
		/**
		 * Why nothing may land in an hour; '' when it is free. The cell is
		 * greyed and striped, says why on hover, and a drop there is refused.
		 */
		blocked?: (date: string, hour: number) => string;
		/** With `blocked`: the hours stay striped, at half strength, and a drop there goes through. */
		overridden?: boolean;
		/**
		 * Fires with the dragged item's id and the cell it was dropped on, and
		 * again with a `minute` once one is picked from the quarters. A reason
		 * returned (or resolved) means it was refused: the item shakes and says it.
		 */
		ondropitem?: (
			id: string,
			date: string,
			hour: number,
			minute?: number
		) => void | string | Promise<void | string>;
		/**
		 * With `groupOf`, a box of two or more gets a grip that drags the whole
		 * group: this fires with every id in it and the cell it was dropped on.
		 * Each keeps its own minutes. A reason back means it was refused.
		 */
		ondropgroup?: (ids: string[], date: string, hour: number) => void | string | Promise<void | string>;
		/**
		 * A right-click on an item (just it) or on a box's frame or grip (all
		 * of it), with where it happened; the browser's own menu is held back.
		 */
		oncontext?: (items: T[], x: number, y: number) => void;
	} = $props();

	const HOURS = Array.from({ length: 24 }, (_, i) => i);
	let rowPx = $derived(dense ? 20 + 2 * rowSpace : 56);

	/* ---- now ----
	 *
	 * Ticks every half minute, so the current hour moves on (and today with
	 * it at midnight) while the page stays open.
	 */
	let now = $state(new Date());
	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(timer);
	});
	let today = $derived(isoDate(now));
	let nowHour = $derived(now.getHours());
	/** Where "Today" puts the first day. */
	const firstDay = () => (rolling ? addDays(dayStart(new Date()), -lead) : startOfWeek(new Date()));

	let scroller = $state<HTMLDivElement | null>(null);

	let days = $derived(
		Array.from({ length: dayCount }, (_, i) => {
			const date = addDays(weekStart, i);
			return { date, iso: isoDate(date), day: date.getDay() };
		})
	);

	let inThisWeek = $derived(new Set(days.map((d) => d.iso)));
	let todayShown = $derived(inThisWeek.has(today));
	// "Today" is spent once the run starts where it would put it; "This week"
	// once today is in the week.
	let isCurrentWeek = $derived(rolling ? days[0]?.iso === isoDate(firstDay()) : inThisWeek.has(today));
	let rangeText = $derived(
		rolling ? rangeLabel(weekStart, addDays(weekStart, dayCount - 1)) : weekLabel(weekStart, addDays(weekStart, 6))
	);

	function cardsAt(iso: string, hour: number): T[] {
		return items.filter((item) => item.date === iso && hourOf(item.time) === hour);
	}

	/** A cell's cards, boxed per group in the order the groups first appear. */
	function bundlesAt(iso: string, hour: number): { key: string; items: T[]; done: boolean }[] {
		const cards = cardsAt(iso, hour);
		if (!groupOf) return cards.map((item) => ({ key: item.id, items: [item], done: false }));
		const groups = new Map<string, T[]>();
		for (const item of cards) {
			const group = groupOf(item);
			const list = groups.get(group);
			if (list) list.push(item);
			else groups.set(group, [item]);
		}
		return [...groups].map(([key, items]) => ({ key, items, done: Boolean(past) && items.every((item) => past!(item)) }));
	}

	function markedOn(iso: string): T[] {
		return (headItems ?? items).filter((item) => item.date === iso);
	}

	/* ---- drag and drop ----
	 *
	 * Pointer events rather than the HTML drag-and-drop API. A native drag
	 * runs in the browser's own loop, which withholds wheel events for its
	 * whole duration, so the grid could not be scrolled with the wheel while
	 * a card was held. With pointer capture the grid drives the drag itself:
	 * the wheel keeps working, the cell under the pointer is found by
	 * geometry, and a fixed ghost of the card follows the pointer while the
	 * card itself stays in its cell, dimmed, until the drop lands.
	 */

	const DRAG_THRESHOLD_PX = 4;
	/** The item under the pointer; with a group, its first. */
	let dragging = $state<string | null>(null);
	/** Everything that moves with it: the item alone, or a whole box. */
	let draggingIds = $state<string[]>([]);
	let over = $state<string | null>(null);
	let pointer = $state({ x: 0, y: 0 });
	let pending: {
		id: string;
		ids: string[];
		x: number;
		y: number;
		pointerId: number;
		node: HTMLElement;
	} | null = null;

	function key(iso: string, hour: number) {
		return `${iso}#${hour}`;
	}

	function beginDrag(event: PointerEvent, id: string, ids: string[] = [id]) {
		closeTip();
		if (!(ids.length > 1 ? ondropgroup : ondropitem) || event.button !== 0) return;
		picker = null;
		const node = event.currentTarget as HTMLElement;
		pending = { id, ids, x: event.clientX, y: event.clientY, pointerId: event.pointerId, node };
		try {
			node.setPointerCapture(event.pointerId);
		} catch {
			// No live pointer to capture (a synthetic event); the drag still works
			// as long as the moves reach the card.
		}
	}

	function moveDrag(event: PointerEvent) {
		if (!pending || event.pointerId !== pending.pointerId) return;
		if (!dragging) {
			// A press that has not moved is a click, not a drag.
			if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < DRAG_THRESHOLD_PX) {
				return;
			}
			dragging = pending.id;
			draggingIds = pending.ids;
		}
		pointer = { x: event.clientX, y: event.clientY };
		updateOver();
		autoScroll(event.clientY);
	}

	function finish(event: PointerEvent): { id: string | null; ids: string[]; target: string | null } {
		const result = { id: dragging, ids: draggingIds, target: over };
		try {
			pending?.node.releasePointerCapture(event.pointerId);
		} catch {
			// Already released.
		}
		pending = null;
		dragging = null;
		draggingIds = [];
		over = null;
		stopAutoScroll();
		return result;
	}

	function endDrag(event: PointerEvent) {
		if (!pending || event.pointerId !== pending.pointerId) return;
		const { id, ids, target } = finish(event);
		if (!id || !target) return;
		const [iso, hour] = target.split('#');
		const why = landRefusal(ids, iso, Number(hour));
		if (why) {
			void refuse(ids, why);
			return;
		}
		if (ids.length > 1) {
			void settle(ids, ondropgroup?.(ids, iso, Number(hour)));
			return;
		}
		void settle(ids, ondropitem?.(id, iso, Number(hour)));
		if (quarters) void openPicker(id, iso, Number(hour));
	}

	/** Why any of these may not land in that cell, each at its own minutes; '' when all may. */
	function landRefusal(ids: string[], iso: string, hour: number): string {
		const closed = overridden ? '' : blocked?.(iso, hour);
		if (closed) return closed;
		if (!landWhy) return '';
		for (const id of ids) {
			const item = items.find((entry) => entry.id === id);
			const why = item ? landWhy(item, iso, makeTime(hour, minuteOf(item.time))) : '';
			if (why) return why;
		}
		return '';
	}

	/** A drop the caller turned down after all (a reason back) shakes like a refused one. */
	async function settle(ids: string[], outcome: void | string | Promise<void | string>) {
		const why = await outcome;
		if (typeof why === 'string' && why) void refuse(ids, why);
	}

	/* ---- refusing ----
	 *
	 * An item that will not move — picked up while locked, or dropped where
	 * it may not go — shakes where it sits, and a note beside it says why
	 * for a moment.
	 */
	const NOTICE_MS = 2600;
	let wiggling = $state<string[]>([]);
	let notice = $state<{ text: string; x: number; y: number; below: boolean } | null>(null);
	let noticeTimer: ReturnType<typeof setTimeout> | null = null;

	async function refuse(ids: string[], text: string) {
		closeTip();
		picker = null;
		wiggling = [];
		await tick();
		wiggling = ids;
		// A group's note sits at its box, an item's at the item.
		const node = nodes.get(ids[0]);
		const rect = (ids.length > 1 ? node?.closest('.bundle') : node)?.getBoundingClientRect();
		notice = rect
			? {
					text,
					x: Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2)),
					y: rect.top < 90 ? rect.bottom + 8 : rect.top - 8,
					below: rect.top < 90
				}
			: null;
		if (noticeTimer) clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = null;
			wiggling = [];
			noticeTimer = null;
		}, NOTICE_MS);
	}

	function pressLocked(event: PointerEvent, item: T) {
		if (!ondropitem || event.button !== 0) return;
		const why = lockedWhy?.(item);
		if (why) void refuse([item.id], why);
	}

	function context(event: MouseEvent, group: T[]) {
		if (!oncontext) return;
		event.preventDefault();
		event.stopPropagation();
		closeTip();
		oncontext(group, event.clientX, event.clientY);
	}

	/** A box's grip: the whole group goes, unless one of it can no longer move. */
	function pressGrip(event: PointerEvent, group: T[]) {
		if (!ondropgroup || event.button !== 0) return;
		const stuck = group.find((item) => !candrag?.(item));
		if (stuck) {
			closeTip();
			const why = lockedWhy?.(stuck) || 'Part of it can no longer move.';
			void refuse(
				group.map((item) => item.id),
				`${why} Drag the others one by one.`
			);
			return;
		}
		beginDrag(
			event,
			group[0].id,
			group.map((item) => item.id)
		);
	}

	$effect(() => () => {
		if (noticeTimer) clearTimeout(noticeTimer);
	});

	function cancelDrag(event: PointerEvent) {
		if (!pending || event.pointerId !== pending.pointerId) return;
		finish(event);
	}

	/**
	 * The cell under the pointer, by geometry: the pointer is captured by the
	 * card, so nothing else receives events. Re-run on scroll as well, since
	 * the wheel moves the grid under a pointer that has not moved.
	 */
	function updateOver() {
		if (!dragging) return;
		const hit = document
			.elementFromPoint(pointer.x, pointer.y)
			?.closest<HTMLElement>('[data-cell]');
		over = hit?.dataset.cell ?? null;
	}

	/* ---- where the card would land ----
	 *
	 * A label beside the held card naming the slot under the pointer, in
	 * words: past a few days the grid's own headers are a long way from the
	 * pointer. The minutes are the card's own, since a drop keeps them.
	 */
	let ghostEl = $state<HTMLDivElement | null>(null);
	let landEl = $state<HTMLDivElement | null>(null);

	let landing = $derived.by(() => {
		if (!dragging || !over) return null;
		const [iso, hour] = over.split('#');
		const lifted = items.find((item) => item.id === dragging);
		const time = makeTime(Number(hour), lifted ? minuteOf(lifted.time) : 0);
		const at = new Date(`${iso}T${time}`);
		if (Number.isNaN(at.getTime())) return null;
		const other = zone ? zoneTime(at, zone.zone) : null;
		return {
			refusal: landRefusal(draggingIds, iso, Number(hour)),
			time,
			day: `${dayLabel(at.getDay())} ${at.getDate()} ${MONTH_NAMES[at.getMonth()].slice(0, 3)}`,
			when: relativeTo(iso, time),
			past: at.getTime() < Date.now(),
			zone: zone && other ? { label: zone.label, time: clock(other), dayOffset: other.dayOffset } : null
		};
	});

	/** Right of the held card, or left of it when that would leave the window. */
	let landAt = $derived.by(() => {
		const gap = (ghostEl?.offsetWidth ?? 18) / 2 + 10;
		const width = landEl?.offsetWidth ?? 160;
		const left = pointer.x + gap + width > window.innerWidth - 8;
		return { x: left ? pointer.x - gap : pointer.x + gap, left };
	});

	/* ---- scrolling while dragging ----
	 *
	 * The wheel works during a pointer drag, but a card held near the top or
	 * bottom edge should carry the grid with it as well. The speed comes from
	 * autoscroll.ts (with the tests); the loop runs on animation frames until
	 * the drag ends or the pointer leaves the edge zone.
	 */
	let scrollVelocity = 0;
	let scrollFrame: number | null = null;

	function autoScroll(clientY: number) {
		const el = scroller;
		if (!el || !dragging) return;
		const rect = el.getBoundingClientRect();
		scrollVelocity = edgeVelocity(clientY, rect.top, rect.bottom);
		if (scrollVelocity !== 0 && scrollFrame === null) scrollFrame = requestAnimationFrame(scrollStep);
	}

	function scrollStep() {
		scrollFrame = null;
		const el = scroller;
		if (!el || !dragging || scrollVelocity === 0) return;
		el.scrollTop += scrollVelocity;
		scrollFrame = requestAnimationFrame(scrollStep);
	}

	function stopAutoScroll() {
		scrollVelocity = 0;
		if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
		scrollFrame = null;
	}

	/* ---- the quarter-hour picker ----
	 *
	 * A drop picks the day and hour; the card lands at once with the minutes
	 * it had, and a small popover beside it offers the hour's quarters. Esc,
	 * a press anywhere else or the card scrolling away closes it and keeps
	 * those minutes. Portalled and fixed like the card's tooltip, and placed
	 * from the card's own node, so it follows the card as the grid scrolls.
	 */
	const QUARTERS = [0, 15, 30, 45];

	let picker = $state<{ id: string; date: string; hour: number } | null>(null);
	let pickerEl = $state<HTMLDivElement | null>(null);
	let pickerAt = $state({ x: 0, y: 0, above: false });

	let pickedMinute = $derived.by(() => {
		const open = picker;
		if (!open) return null;
		const item = items.find((entry) => entry.id === open.id);
		return item ? minuteOf(item.time) : null;
	});

	async function openPicker(id: string, date: string, hour: number) {
		picker = { id, date, hour };
		await tick();
		placePicker();
		const buttons = pickerEl?.querySelectorAll<HTMLButtonElement>('button');
		const current = pickerEl?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
		(current ?? buttons?.[0])?.focus({ preventScroll: true });
	}

	function placePicker() {
		if (!picker) return;
		const node = nodes.get(picker.id);
		const el = scroller;
		if (!node || !el) {
			picker = null;
			return;
		}
		const rect = node.getBoundingClientRect();
		const box = el.getBoundingClientRect();
		// Scrolled out of the grid: nothing left to point at.
		if (rect.bottom <= box.top || rect.top >= box.bottom) {
			picker = null;
			return;
		}
		const height = pickerEl?.offsetHeight ?? 34;
		const half = (pickerEl?.offsetWidth ?? 220) / 2;
		const above = rect.bottom + 6 + height > window.innerHeight - 8;
		pickerAt = {
			x: Math.min(window.innerWidth - half - 8, Math.max(half + 8, rect.left + rect.width / 2)),
			y: above ? rect.top - 6 : rect.bottom + 6,
			above
		};
	}

	function pickMinute(minute: number) {
		const open = picker;
		picker = null;
		if (open) void settle([open.id], ondropitem?.(open.id, open.date, open.hour, minute));
	}

	function onWindowKey(event: KeyboardEvent) {
		if (picker && event.key === 'Escape') {
			event.preventDefault();
			picker = null;
		}
	}

	function onWindowPointer(event: PointerEvent) {
		if (picker && !pickerEl?.contains(event.target as Node)) picker = null;
	}

	/** Left and right step through the quarters. */
	function onPickerKey(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		const buttons = [...(pickerEl?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next = at + (event.key === 'ArrowRight' ? 1 : -1);
		if (next < 0 || next >= buttons.length) return;
		event.preventDefault();
		buttons[next].focus();
	}

	/* ---- an upload's detail on hover ----
	 *
	 * With `groupTip`, hovering a box (not one icon in it) opens the caller's
	 * summary of the whole group. Portalled and fixed like the cards' own
	 * tooltip — a hovered card's transform would otherwise pin it — and on
	 * whichever side of the box has more room.
	 */
	const TIP_DELAY = 300;
	const TIP_WIDTH = 340;
	let tip = $state<{ items: T[]; x: number; y: number; below: boolean; room: number } | null>(null);
	let tipTimer: ReturnType<typeof setTimeout> | null = null;

	function openTip(event: MouseEvent, items: T[]) {
		if (dragging) return;
		const node = event.currentTarget as HTMLElement;
		closeTip();
		tipTimer = setTimeout(() => {
			tipTimer = null;
			const rect = node.getBoundingClientRect();
			const below = rect.top < window.innerHeight / 2;
			const half = TIP_WIDTH / 2 + 8;
			tip = {
				items,
				x: Math.min(window.innerWidth - half, Math.max(half, rect.left + rect.width / 2)),
				y: below ? rect.bottom + 8 : rect.top - 8,
				below,
				room: below ? window.innerHeight - rect.bottom - 16 : rect.top - 16
			};
		}, TIP_DELAY);
	}

	function closeTip() {
		if (tipTimer) clearTimeout(tipTimer);
		tipTimer = null;
		tip = null;
	}

	$effect(() => () => {
		if (tipTimer) clearTimeout(tipTimer);
	});

	/* ---- a second clock in the time column ---- */

	general.load();

	let zone = $derived(calendarZone.zone);

	/**
	 * The zone's clock at each local hour, taken on the first day of the week
	 * shown. A week straddling a daylight-saving change is off by an hour on
	 * the far side of it; the column is a reading aid, not the schedule.
	 */
	let zoneTimes = $derived.by(() => {
		if (!zone) return null;
		return HOURS.map((hour) => {
			const at = new Date(weekStart);
			at.setHours(hour, 0, 0, 0);
			return zoneTime(at, zone.zone);
		});
	});

	/** Night and evening, tinted so the working day stands out. */
	function offHours(hour: number) {
		return hour < 8 || hour >= 16;
	}

	/* ---- off-screen tracking ----
	 *
	 * Row heights grow when several cards share a slot, so a card's position
	 * cannot be derived from its hour. The card elements register themselves and
	 * are measured against the scroll viewport instead.
	 */

	const nodes = new Map<string, HTMLElement>();

	function register(node: HTMLElement, id: string) {
		nodes.set(id, node);
		measure();
		return {
			destroy() {
				// A moved card may have registered its new node already.
				if (nodes.get(id) === node) nodes.delete(id);
			}
		};
	}

	/**
	 * Width the scrollbar steals from the grid. The header is not inside the
	 * scroll container, so without reserving the same space its columns come out
	 * wider than the columns beneath them. Zero on overlay-scrollbar platforms.
	 */
	let gutter = $state(0);

	function measureGutter() {
		const el = scroller;
		if (el) gutter = el.offsetWidth - el.clientWidth;
	}

	let above = $state<T[]>([]);
	let below = $state<T[]>([]);
	let ticking = false;

	/**
	 * Off-screen items bucketed by which day column they belong to, so an arrow
	 * sits over its own day rather than in the middle of the grid. Several items
	 * can share a column, so each bucket renders as one slot.
	 */
	function byDay(list: T[]): { index: number; items: T[] }[] {
		const buckets = new Map<number, T[]>();
		for (const item of list) {
			const index = days.findIndex((day) => day.iso === item.date);
			if (index < 0) continue;
			const bucket = buckets.get(index);
			if (bucket) bucket.push(item);
			else buckets.set(index, [item]);
		}
		return [...buckets.entries()]
			.map(([index, items]) => ({ index, items }))
			.sort((a, b) => a.index - b.index);
	}

	let aboveByDay = $derived(byDay(above));
	let belowByDay = $derived(byDay(below));

	function measure() {
		const el = scroller;
		if (!el) return;
		const box = el.getBoundingClientRect();
		const up: T[] = [];
		const down: T[] = [];

		for (const item of items) {
			const node = nodes.get(item.id);
			if (!node) continue;
			const rect = node.getBoundingClientRect();
			// Fully past the edge, not merely clipped — a card half in view does
			// not need an arrow pointing at it.
			if (rect.bottom <= box.top + 2) up.push(item);
			else if (rect.top >= box.bottom - 2) down.push(item);
		}

		above = up;
		below = down;
	}

	function onScroll() {
		// Cheap, and wanted at once rather than on the next frame: the cell
		// under a held card changes as the grid moves beneath it.
		updateOver();
		closeTip();
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			ticking = false;
			measure();
			measureGutter();
			placePicker();
		});
	}

	/** Scrolls an item's card to the vertical middle of the grid. */
	function centerOn(item: T) {
		const el = scroller;
		const node = nodes.get(item.id);
		if (!el || !node) return;

		const box = el.getBoundingClientRect();
		const rect = node.getBoundingClientRect();
		const max = el.scrollHeight - el.clientHeight;
		const target = Math.max(
			0,
			Math.min(max, el.scrollTop + (rect.top - box.top) - (el.clientHeight - rect.height) / 2)
		);

		const reduced =
			typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduced) {
			el.scrollTop = target;
			measure();
			return;
		}

		// Animated by hand rather than with scrollTo({ behavior: 'smooth' }):
		// that is a silent no-op in some engines and automation contexts, and a
		// jump button that sometimes does nothing is worse than one that never
		// animates.
		const from = el.scrollTop;
		const distance = target - from;
		if (Math.abs(distance) < 1) return;

		const started = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - started) / 320);
			el.scrollTop = from + distance * (1 - Math.pow(1 - t, 3));
			if (t < 1) requestAnimationFrame(step);
			else measure();
		};
		requestAnimationFrame(step);
	}

	// Re-measure whenever the set of cards changes; the effect runs after the DOM
	// is updated, so the freshly rendered nodes are already registered.
	$effect(() => {
		void items;
		void weekStart;
		measure();
		measureGutter();
	});

	// Opens on the earliest scheduled hour rather than midnight. Depends on the
	// element alone — reading `items` as a dependency re-ran this on every
	// change and snapped the scroll position back, making the grid unscrollable.
	$effect(() => {
		const el = scroller;
		if (!el) return;
		untrack(() => {
			const hours = items.map((item) => hourOf(item.time));
			const earliest = hours.length ? Math.min(...hours) : 8;
			el.scrollTop = Math.max(0, (earliest - 1) * rowPx);
			measure();
		});
	});
</script>

<svelte:window onresize={onScroll} onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<!-- A cell's cards of one group: the box's grip, then each card. -->
{#snippet bundleCards(items: T[])}
	{#if groupOf && ondropgroup && items.length > 1}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<span
			class="grip"
			class:locked={items.some((item) => !candrag?.(item))}
			onpointerdown={(e) => pressGrip(e, items)}
			onpointermove={moveDrag}
			onpointerup={endDrag}
			onpointercancel={cancelDrag}
		></span>
	{/if}
	{#each items as item (item.id)}
		{@const why = ondropitem && lockedWhy ? lockedWhy(item) : ''}
		{#if candrag?.(item)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="slot grab"
				class:lifted={draggingIds.includes(item.id)}
				class:wiggle={wiggling.includes(item.id)}
				use:register={item.id}
				oncontextmenu={oncontext ? (e) => context(e, [item]) : undefined}
				onpointerdown={(e) => beginDrag(e, item.id)}
				onpointermove={moveDrag}
				onpointerup={endDrag}
				onpointercancel={cancelDrag}
			>
				{@render card(item)}
			</div>
		{:else}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="slot"
				class:locked={Boolean(why)}
				class:wiggle={wiggling.includes(item.id)}
				use:register={item.id}
				oncontextmenu={oncontext ? (e) => context(e, [item]) : undefined}
				onpointerdown={why ? (e) => pressLocked(e, item) : undefined}
			>
				{@render card(item)}
			</div>
		{/if}
	{/each}
{/snippet}

<header class="bar" class:centred={Boolean(center)}>
	<div class="side">
		<div class="nav">
			<button
				class="nav-btn"
				onclick={() => (weekStart = addDays(weekStart, -7))}
				aria-label={rolling ? 'A week earlier' : 'Previous week'}
			>
				<svg viewBox="0 0 24 24" width="15" height="15" fill="none"
					><path
						d="M15 6l-6 6 6 6"
						stroke="currentColor"
						stroke-width="1.9"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</button>
			<span class="range">{rangeText}</span>
			<button
				class="nav-btn"
				onclick={() => (weekStart = addDays(weekStart, 7))}
				aria-label={rolling ? 'A week later' : 'Next week'}
			>
				<svg viewBox="0 0 24 24" width="15" height="15" fill="none"
					><path
						d="M9 6l6 6-6 6"
						stroke="currentColor"
						stroke-width="1.9"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</button>
		</div>

		<button class="btn sm" onclick={() => (weekStart = firstDay())} disabled={isCurrentWeek}>
			{rolling ? 'Today' : 'This week'}
		</button>
		{@render start?.()}
	</div>

	{#if center}
		<div class="middle">{@render center()}</div>
	{/if}

	<div class="side end">{@render toolbar?.()}</div>
</header>

<div
	class="calendar card"
	class:zoned={Boolean(zone)}
	class:dragging={Boolean(dragging)}
	class:many={dayCount > 10}
	class:slim={dense}
	class:allhours={allHours}
	style="--days: {dayCount}"
>
	<div class="head" style="padding-right: {gutter}px">
		<div class="corner">
			<select
				class="zonepick"
				value={calendarZone.id}
				onchange={(e) => calendarZone.set(e.currentTarget.value)}
				aria-label="Second time zone"
				title="Show another zone's clock beside the local one"
			>
				<option value="">Local</option>
				{#each calendarZone.choices as choice (choice.id)}
					<option value={choice.id}>{choice.label}</option>
				{/each}
			</select>
		</div>
		{#each days as day (day.iso)}
			<div class="dayhead" class:today={day.iso === today}>
				<div class="daymeta">
					<span class="dow">{dayLabel(day.day)}</span>
					<span class="dom">{String(day.date.getDate()).padStart(2, '0')}</span>
				</div>
				{#if marker}
					<div class="markers">
						{#each markedOn(day.iso) as item (item.id)}
							{@render marker(item)}
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if dragging}
		{@const lifted = items.filter((item) => draggingIds.includes(item.id))}
		{#if lifted.length > 0}
			<div
				class="ghost"
				class:ghostbox={lifted.length > 1}
				style="left: {pointer.x}px; top: {pointer.y}px"
				bind:this={ghostEl}
				use:portal
			>
				{#each lifted as item (item.id)}
					{@render card(item)}
				{/each}
			</div>
		{/if}
		{#if landing}
			<div
				class="landing"
				class:left={landAt.left}
				class:past={landing.past || Boolean(landing.refusal)}
				style="left: {landAt.x}px; top: {pointer.y}px"
				bind:this={landEl}
				use:portal
			>
				<div class="landtime">
					<span>{landing.time}</span>
					{#if landing.zone}
						<span class="landzone">
							{landing.zone.label}
							{landing.zone.time}{#if landing.zone.dayOffset !== 0}<sup
									>{landing.zone.dayOffset > 0 ? '+1' : '−1'}</sup
								>{/if}
						</span>
					{/if}
				</div>
				<div class="landday">{landing.day} · {landing.past ? 'in the past' : landing.when}</div>
				{#if landing.refusal}
					<div class="landwhy">{landing.refusal}</div>
				{/if}
			</div>
		{/if}
	{/if}

	{#if notice}
		<div
			class="notice"
			class:below={notice.below}
			style="left: {notice.x}px; top: {notice.y}px"
			role="status"
			use:portal
		>
			{notice.text}
		</div>
	{/if}

	{#if tip && groupTip}
		<div
			class="grouptip"
			class:below={tip.below}
			style="left: {tip.x}px; top: {tip.y}px; width: {TIP_WIDTH}px; max-height: {tip.room}px"
			role="tooltip"
			use:portal
		>
			{@render groupTip(tip.items)}
		</div>
	{/if}

	{#if picker && pickedMinute !== null}
		{@const open = picker}
		<div
			class="quarters"
			class:above={pickerAt.above}
			style="left: {pickerAt.x}px; top: {pickerAt.y}px"
			role="toolbar"
			tabindex="-1"
			aria-label="Minutes past {makeTime(open.hour, 0)}"
			bind:this={pickerEl}
			onkeydown={onPickerKey}
			use:portal
		>
			{#each QUARTERS as minute (minute)}
				<button
					class="quarter"
					class:on={pickedMinute === minute}
					aria-pressed={pickedMinute === minute}
					onclick={() => pickMinute(minute)}
				>
					{makeTime(open.hour, minute)}
				</button>
			{/each}
		</div>
	{/if}

	<div class="scrollwrap">
		<div class="scroller scroll" bind:this={scroller} onscroll={onScroll}>
			<div class="grid" style="--row: {rowPx}px">
				{#each HOURS as hour (hour)}
					{@const thisHour = todayShown && hour === nowHour}
					<div
						class="timelabel"
						class:offhours={offHours(hour)}
						class:zoned={Boolean(zone)}
						class:now={thisHour}
					>
						<span class="hourtext">{String(hour).padStart(2, '0')}:00</span>
						{#if zoneTimes}
							{@const t = zoneTimes[hour]}
							<span class="zonetime" title={zone?.zone}>
								{t ? clock(t) : '—'}{#if t && t.dayOffset !== 0}<sup
										>{t.dayOffset > 0 ? '+1' : '−1'}</sup
									>{/if}
							</span>
						{/if}
					</div>

					{#each days as day (day.iso)}
						{@const closed = blocked?.(day.iso, hour) ?? ''}
						<div
							class="cell"
							class:blocked={Boolean(closed)}
							class:overridden={Boolean(closed) && overridden}
							title={closed || undefined}
							class:dense
							class:today={day.iso === today}
							class:offhours={offHours(hour)}
							class:nowrow={thisHour}
							class:now={thisHour && day.iso === today}
							class:over={over === key(day.iso, hour)}
							data-cell={key(day.iso, hour)}
							style:padding-block={dense && rowSpace ? `${rowSpace}px` : undefined}
						>
							{#each bundlesAt(day.iso, hour) as bundle (bundle.key)}
								{@const label = groupOf && groupLabel ? groupLabel(bundle.items).trim() : ''}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="bundle"
									class:boxed={Boolean(groupOf)}
									class:labelled={Boolean(label)}
									class:done={bundle.done}
									onmouseenter={groupTip ? (e) => openTip(e, bundle.items) : undefined}
									onmouseleave={groupTip ? closeTip : undefined}
									oncontextmenu={oncontext && groupOf ? (e) => context(e, bundle.items) : undefined}
								>
									{#if label}
										<span class="bundlerow">{@render bundleCards(bundle.items)}</span>
										<span class="bundlelabel">{label}</span>
									{:else}
										{@render bundleCards(bundle.items)}
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				{/each}
			</div>
		</div>

		{#if offscreen && aboveByDay.length > 0}
			<div class="rail up">
				{#each aboveByDay as group (group.index)}
					<div class="railslot" style="grid-column: {group.index + 1}">
						{#each group.items as item (item.id)}
							{@render offscreen(item, 'up', () => centerOn(item))}
						{/each}
					</div>
				{/each}
			</div>
		{/if}

		{#if offscreen && belowByDay.length > 0}
			<div class="rail down">
				{#each belowByDay as group (group.index)}
					<div class="railslot" style="grid-column: {group.index + 1}">
						{#each group.items as item (item.id)}
							{@render offscreen(item, 'down', () => centerOn(item))}
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 14px;
	}

	.side {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.side.end {
		margin-left: auto;
	}

	/* With something in the middle, it sits in the middle of the whole bar
	   whatever the two ends hold. */
	.bar.centred {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		gap: 16px;
	}

	.bar.centred .side.end {
		justify-content: flex-end;
	}

	.middle {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
	}

	.nav-btn {
		width: 26px;
		height: 26px;
		border-radius: 7px;
		display: grid;
		place-items: center;
		color: var(--text-dim);
	}

	.nav-btn:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	/* Not `.label`: that is the global form-label class, whose bottom margin
	   lifted the range above the arrows beside it. */
	.range {
		min-width: 108px;
		text-align: center;
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1;
	}

	.sm {
		padding: 6px 12px;
		font-size: 12px;
	}

	/* The time gutter's width lives here so the grid, the header corner and
	   the off-screen rail all read one value. */
	.calendar {
		--gutter: 84px;
		overflow: hidden;
	}

	.calendar.zoned {
		--gutter: 132px;
	}

	.calendar.dragging {
		user-select: none;
	}

	.head,
	.grid {
		display: grid;
		grid-template-columns: var(--gutter) repeat(var(--days, 7), minmax(0, 1fr));
	}

	/* Two or three weeks side by side: narrower day heads, the date on top of
	   the markers rather than beside them. */
	.calendar.many .dayhead {
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: 7px 6px;
	}

	.calendar.many .dom {
		font-size: 15px;
	}

	.head {
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}

	.corner {
		border-right: 1px solid var(--border);
		display: grid;
		align-items: center;
		padding: 6px;
	}

	.zonepick {
		width: 100%;
		min-width: 0;
		padding: 4px 6px;
		border-radius: 7px;
		border: 1px solid var(--border);
		background: var(--bg-elev);
		color: var(--text-dim);
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}

	.zonepick:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}

	.dayhead {
		padding: 9px 10px;
		border-right: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.dayhead:last-child {
		border-right: none;
	}

	.dayhead.today {
		background: var(--accent-grad-soft);
	}

	.dow {
		display: block;
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-faint);
	}

	.dayhead.today .dow {
		color: var(--pink-soft);
	}

	.dom {
		display: block;
		font-size: 17px;
		font-weight: 620;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}

	.dayhead.today .dom {
		color: var(--pink);
	}

	/* Which platforms land on this day, readable without scrolling the grid.
	   `--marker` is the width at which four fit on one row however narrow
	   the day — a quarter of the row, gaps aside, never over 20px — for the
	   caller's marker to take. Stretched across the day head, so the
	   percentage has a width to resolve against when the head stacks. */
	.markers {
		--marker: min(20px, calc((100% - 6px) / 4));
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 2px;
		flex: 1;
		align-self: stretch;
		min-width: 0;
	}

	.scrollwrap {
		position: relative;
	}

	.scroller {
		max-height: 52vh;
		min-height: 300px;
		overflow-y: auto;
	}

	.calendar.allhours .scroller {
		max-height: none;
	}

	.grid {
		grid-auto-rows: minmax(var(--row), auto);
	}

	.timelabel {
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 5px;
	}

	.timelabel.zoned {
		justify-content: space-between;
		gap: 6px;
		padding-left: 8px;
		padding-right: 8px;
	}

	.zonetime {
		font-family: var(--mono);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
	}

	.zonetime sup {
		margin-left: 1px;
		font-size: 9px;
	}

	/* Night and evening, tinted the same; today's own tint wins over it. */
	.timelabel.offhours,
	.cell.offhours {
		background: rgba(120, 100, 200, 0.07);
	}

	.timelabel span {
		font-family: var(--mono);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
		color: var(--text-dim);
	}

	.cell {
		border-right: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		padding: 4px;
		display: grid;
		gap: 4px;
		align-content: start;
		transition: background 0.12s;
	}

	.cell.dense {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-content: center;
		padding: 0 3px;
		gap: 1px 3px;
	}

	/* Without groups the box is not there for layout: the cards sit in the
	   cell as they always did. */
	.bundle {
		display: contents;
	}

	/* One upload's posts in this hour: its platforms side by side in one
	   box, as tall as the slim row. */
	.bundle.boxed {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 18px;
		padding: 0 3px;
		border-radius: 6px;
		border: 1px solid var(--border-strong);
		background: var(--surface-3);
	}

	.bundle.boxed.done {
		border-color: var(--border);
		background: transparent;
	}

	/* With a line under the icons (groupLabel): two rows, as wide as the
	   wider of them, never wider than the cell — the line ends in "…". */
	.bundle.boxed.labelled {
		flex-direction: column;
		align-items: stretch;
		gap: 1px;
		height: auto;
		min-width: 0;
		max-width: 100%;
		padding: 2px 4px 3px;
	}

	.bundlerow {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2px;
		height: 16px;
	}

	/* Centred, so it takes its own width: capped at the box's as well, or a
	   long name runs out of the cell instead of ending in "…". */
	.bundlelabel {
		min-width: 0;
		max-width: min(140px, 100%);
		align-self: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 9.5px;
		line-height: 11px;
		font-weight: 560;
		color: var(--text-dim);
	}

	.bundle.done .bundlelabel {
		color: var(--text-faint);
	}

	.bundle.boxed:hover {
		border-color: var(--pink-soft);
	}

	/* Takes the whole upload along; its icons each move on their own. */
	.grip {
		flex: none;
		width: 6px;
		height: 12px;
		margin-right: 1px;
		border-radius: 2px;
		background-image: radial-gradient(circle, var(--text-dim) 0.8px, transparent 1.1px);
		background-size: 3px 4px;
		background-position: center;
		cursor: grab;
		touch-action: none;
		opacity: 0.75;
	}

	.grip:hover {
		opacity: 1;
		background-color: var(--surface-2);
	}

	.grip.locked {
		cursor: not-allowed;
		opacity: 0.35;
	}

	/* A whole upload held: its icons in a box like the one they left. */
	.ghost.ghostbox {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 18px;
		padding: 0 3px;
		border-radius: 6px;
		border: 1px solid var(--pink-soft);
		background: var(--surface-3);
	}

	/* The upload's detail: the frame here, the content the caller's. */
	.grouptip {
		position: fixed;
		z-index: 40;
		transform: translate(-50%, -100%);
		padding: 10px 12px 11px;
		border-radius: var(--radius);
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
		overflow: hidden;
		pointer-events: none;
		animation: quartersin 0.12s ease;
	}

	.grouptip.below {
		transform: translate(-50%, 0);
	}

	/* Rows only as tall as the hour label: the label sits in the middle of
	   its row rather than at the top. */
	.calendar.slim .timelabel {
		align-items: center;
		padding-top: 0;
	}

	.calendar.slim .timelabel span {
		line-height: 1;
	}

	.cell.today {
		background: rgba(255, 77, 158, 0.035);
	}

	/* Today's working day a shade darker than its night and evening, as on
	   the other days. `:where` keeps it at two classes, so the current
	   hour's tint below still wins. */
	.cell.today:where(:not(.offhours)) {
		background: #1a1220;
	}

	/* The hour we are in, strong enough to find at a glance: its label
	   filled, its row tinted, today's cell outlined — above it is done,
	   below it is still to come. */
	.timelabel.now .hourtext {
		padding: 2px 6px;
		border-radius: 5px;
		background: var(--pink);
		color: #fff;
		font-weight: 700;
	}

	.cell.nowrow {
		background: rgba(255, 77, 158, 0.07);
	}

	.cell.now {
		background: rgba(255, 77, 158, 0.16);
		box-shadow: inset 0 0 0 2px var(--pink);
	}

	.cell.over {
		background: var(--accent-grad-soft);
		box-shadow: inset 0 0 0 1px var(--pink);
	}

	/* Taken: nothing may land here. Bordeaux stripes, and between them the
	   hour's own colour — only the image is set, so whichever tint the hour
	   has stays underneath. While a card is held over it, an amber edge
	   instead of the pink one. */
	.cell.blocked {
		background-image: repeating-linear-gradient(-45deg, #431a33 0 5px, transparent 5px 10px);
		cursor: not-allowed;
	}

	/* Overridden: still marked, at half strength, and open to a drop. */
	.cell.blocked.overridden {
		background-image: repeating-linear-gradient(-45deg, rgba(67, 26, 51, 0.5) 0 5px, transparent 5px 10px);
		cursor: auto;
	}

	/* The current hour's pink is close to the bordeaux itself: brighter
	   stripes there, or they vanish into it. */
	.cell.blocked.now {
		background-image: repeating-linear-gradient(-45deg, #6a2850 0 5px, transparent 5px 10px);
	}

	.cell.blocked.overridden.now {
		background-image: repeating-linear-gradient(-45deg, rgba(106, 40, 80, 0.5) 0 5px, transparent 5px 10px);
	}

	.cell.blocked.over {
		box-shadow: inset 0 0 0 1px var(--warn);
	}

	.cell.blocked.overridden.over {
		box-shadow: inset 0 0 0 1px var(--pink);
	}

	.grab {
		cursor: grab;
		touch-action: none;
	}

	.slot.lifted {
		opacity: 0.35;
	}

	.slot.locked {
		cursor: not-allowed;
	}

	/* No: a shake where it sits. */
	.slot.wiggle {
		animation: refuse 0.46s ease;
	}

	@keyframes refuse {
		15% {
			transform: translateX(-3px) rotate(-6deg);
		}
		30% {
			transform: translateX(3px) rotate(6deg);
		}
		45% {
			transform: translateX(-2px) rotate(-4deg);
		}
		60% {
			transform: translateX(2px) rotate(4deg);
		}
		80% {
			transform: translateX(-1px);
		}
	}

	/* Why it stays: beside the shaken item, for a moment. */
	.notice {
		position: fixed;
		z-index: 1001;
		max-width: 260px;
		transform: translate(-50%, -100%);
		padding: 6px 10px;
		border-radius: 8px;
		background: var(--surface-3);
		border: 1px solid rgba(251, 191, 36, 0.5);
		box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
		font-size: 11.5px;
		line-height: 1.4;
		color: var(--warn);
		pointer-events: none;
		animation: quartersin 0.12s ease;
	}

	.notice.below {
		transform: translate(-50%, 0);
	}

	.ghost {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
		transform: translate(-50%, -50%);
		opacity: 0.95;
		filter: drop-shadow(0 14px 28px rgba(0, 0, 0, 0.5));
	}

	.grab:active {
		cursor: grabbing;
	}

	/* Beside the held card, above it in the stack. */
	.landing {
		position: fixed;
		z-index: 1001;
		pointer-events: none;
		transform: translateY(-50%);
		padding: 5px 9px 6px;
		border-radius: 8px;
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
		white-space: nowrap;
	}

	.landing.left {
		transform: translate(-100%, -50%);
	}

	.landtime {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-family: var(--mono);
		font-size: 15px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}

	.landzone {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-faint);
	}

	.landzone sup {
		margin-left: 1px;
		font-size: 8px;
	}

	.landday {
		font-size: 11px;
		color: var(--text-dim);
	}

	.landing.past {
		border-color: rgba(251, 191, 36, 0.5);
	}

	.landing.past .landday {
		color: var(--warn);
	}

	.landwhy {
		margin-top: 2px;
		font-size: 11px;
		color: var(--warn);
	}

	/* Above the card's hover tooltip (40), which can open over it. */
	.quarters {
		position: fixed;
		z-index: 50;
		display: flex;
		gap: 3px;
		padding: 4px;
		border-radius: 9px;
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
		transform: translateX(-50%);
		animation: quartersin 0.12s ease;
	}

	.quarters.above {
		transform: translate(-50%, -100%);
	}

	.quarter {
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid transparent;
		font-family: var(--mono);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--text-dim);
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}

	.quarter:hover,
	.quarter:focus-visible {
		background: var(--surface-2);
		border-color: var(--pink-soft);
		color: var(--text);
	}

	.quarter.on {
		background: var(--accent-grad);
		color: #fff;
	}

	@keyframes quartersin {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.quarters,
		.grouptip,
		.notice,
		.slot.wiggle {
			animation: none;
		}
	}

	.slot:hover {
		transform: translateY(-1px);
	}

	/* Floating over the grid's own edges, so an off-screen card is reachable
	   without hunting for it. */
	/* Mirrors the grid's day columns exactly, so an arrow lands over the day
	   its card is on. */
	.rail {
		position: absolute;
		left: var(--gutter);
		right: 0;
		display: grid;
		grid-template-columns: repeat(var(--days, 7), minmax(0, 1fr));
		align-items: start;
		padding: 7px 0;
		pointer-events: none;
		z-index: 3;
	}

	.railslot {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px;
		padding: 0 3px;
		min-width: 0;
	}

	.rail.up {
		top: 0;
		background: linear-gradient(var(--surface) 15%, transparent);
	}

	.rail.down {
		bottom: 0;
		background: linear-gradient(transparent, var(--surface) 85%);
	}

	@media (max-width: 1100px) {
		.bar.centred {
			display: flex;
			flex-wrap: wrap;
		}
	}

	@media (max-width: 900px) {
		.calendar {
			--gutter: 64px;
		}

		.calendar.zoned {
			--gutter: 112px;
		}

		.head,
		.grid {
			grid-template-columns: var(--gutter) repeat(var(--days, 7), minmax(78px, 1fr));
		}

		.calendar {
			overflow-x: auto;
		}

		.dayhead {
			flex-direction: column;
			align-items: flex-start;
			gap: 4px;
		}

		.markers {
			justify-content: flex-start;
		}

		.rail {
			left: var(--gutter);
		}
	}
</style>
