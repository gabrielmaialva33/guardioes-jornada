/**
 * Text alternative for the diorama (pt-BR): what the class's forest has
 * grown so far. The 3D canvas and the SVG are both decorative; this is
 * what screen readers get.
 */
const PARTS = [
	'uma clareira com flores',
	'uma trilha com canelas e cedros-rosa floridos',
	'um rio que nasce da nascente',
	'a mata fechada, cheia de aves',
	'as montanhas da Serra de Paranapiacaba ao fundo',
	'a araucária no coração da floresta'
];

function list(items: string[]) {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function describe(stage: number, oath: boolean): string {
	const s = Math.max(0, Math.min(5, Math.floor(stage)));
	const text = `Floresta com ${list(PARTS.slice(0, s + 1))}.`;
	return oath ? `${text} Vaga-lumes iluminam a floresta: o juramento foi feito.` : text;
}
