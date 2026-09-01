/**
 * Moves a node to <body>.
 *
 * `position: fixed` resolves against the nearest ancestor carrying a transform,
 * filter or will-change — not the viewport. Several places here translate an
 * element on hover, which is exactly when their popup is showing, so a popup
 * left in the tree gets pinned to its trigger instead. Svelte scopes styles by
 * class rather than tree position, so the move keeps the styling.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
}
