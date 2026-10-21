/**
 * The performance marks, as 16×16 stroke paths: rising, level, falling — and a
 * dash where there is nothing to compare with. Drawn by the Dashboard's
 * "vs usual" and the brand panel's month over month alike.
 */
export const TREND = {
	ahead: 'M2.5 11.5l4-4 2.5 2.5 4.5-4.5M9.5 5.5h4v4',
	usual: 'M2 8h11.5M10.5 5l3 3-3 3',
	behind: 'M2.5 4.5l4 4 2.5-2.5 4.5 4.5M9.5 10.5h4v-4',
	none: 'M5 8h6'
};

/** How far a ratio is from 1, in words: +34 %, −12 %, ±0 %. */
export function changeWords(ratio: number, locale?: string): string {
	const d = Math.round((ratio - 1) * 100);
	const n = (v: number) => new Intl.NumberFormat(locale).format(v);
	return d > 0 ? `+${n(d)} %` : d < 0 ? `−${n(-d)} %` : '±0 %';
}
