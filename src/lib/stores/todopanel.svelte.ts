/**
 * Whether the To finish panel covers the content area, and where it spreads
 * from: the sidebar tile's middle, as px from the content area's top. Held
 * here because the layout needs it too — the tile opens it, and the page
 * underneath is made inert while it is open — like the dashboard's store.
 */
class TodoPanelStore {
	open = $state(false);
	originY = $state(0);

	toggle(originY: number) {
		if (!this.open) this.originY = originY;
		this.open = !this.open;
	}

	close() {
		this.open = false;
	}
}

export const todoPanel = new TodoPanelStore();
