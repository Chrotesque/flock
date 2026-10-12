/**
 * Whether the dashboard covers the content area. Held here rather than in
 * the overlay itself because the layout needs it too: the page underneath
 * is made inert while the dashboard is open, so Tab cannot wander behind it.
 */
class DashboardStore {
	open = $state(false);

	toggle() {
		this.open = !this.open;
	}

	close() {
		this.open = false;
	}
}

export const dashboard = new DashboardStore();
