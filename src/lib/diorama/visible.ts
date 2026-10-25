/** Start optional rendering only when visible and idle; release it when hidden. */
export function deferVisible(element: HTMLElement, start: () => () => void): () => void {
	let onscreen = typeof IntersectionObserver === 'undefined';
	let release: (() => void) | undefined;
	let cancelIdle: (() => void) | undefined;
	let disposed = false;
	const visible = () => onscreen && !document.hidden && element.getClientRects().length > 0 && !element.closest('[hidden]');
	function update() {
		if (disposed) return;
		if (!visible()) {
			cancelIdle?.(); cancelIdle = undefined;
			release?.(); release = undefined;
			return;
		}
		if (release || cancelIdle) return;
		const run = () => {
			cancelIdle = undefined;
			if (!disposed && visible()) release = start();
		};
		if (typeof window.requestIdleCallback === 'function') {
			const id = window.requestIdleCallback(run, { timeout: 2000 });
			cancelIdle = () => window.cancelIdleCallback(id);
		} else {
			const id = setTimeout(run, 200);
			cancelIdle = () => clearTimeout(id);
		}
	}
	const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
		onscreen = entries.some((entry) => entry.isIntersecting); update();
	});
	observer?.observe(element);
	// Older browsers without IntersectionObserver still notice tab-panel changes.
	const mutations = !observer && typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
	for (let ancestor: HTMLElement | null = element; mutations && ancestor; ancestor = ancestor.parentElement)
		mutations.observe(ancestor, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
	document.addEventListener('visibilitychange', update);
	if (!observer) { window.addEventListener('resize', update); window.addEventListener('scroll', update, true); }
	update();
	return () => {
		disposed = true; observer?.disconnect(); mutations?.disconnect(); cancelIdle?.(); release?.();
		document.removeEventListener('visibilitychange', update);
		if (!observer) { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); }
	};
}
