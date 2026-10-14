/**
 * Whether the dashboard covers the content area, and where it spreads from:
 * px from the content area's top on its left edge — the sidebar link's
 * height, or the top when the address opened it. Held here rather than in
 * the overlay itself because the layout needs it too: the link opens it,
 * and the page underneath is made inert while it is open, so Tab cannot
 * wander behind it.
 */
class DashboardStore {
	open = $state(false);
	originY = $state(0);

	toggle(originY = 0) {
		if (!this.open) this.originY = originY;
		this.open = !this.open;
	}

	show(originY = 0) {
		this.originY = originY;
		this.open = true;
	}

	close() {
		this.open = false;
	}
}

export const dashboard = new DashboardStore();
