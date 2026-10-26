/**
 * "Você sabia?" facts for the loading screen, one per thing the player meets in the
 * game. Kept short for a phone in portrait. Each one is well established; the
 * sources are listed in the P11 report, not shown in the game.
 */
export const FACTS = [
	{
		about: 'muriqui',
		text: 'O muriqui é o maior macaco das Américas e só vive na Mata Atlântica.'
	},
	{
		about: 'mico-leão-dourado',
		text: 'Nos anos 1970 restavam só uns 200 micos-leões-dourados. Protegendo a mata, hoje eles são milhares.'
	},
	{
		about: 'bugio',
		text: 'O ronco do bugio é tão forte que dá para ouvir a quilômetros de distância.'
	},
	{
		about: 'onça-pintada',
		text: 'A onça-pintada é o maior felino das Américas e nada muito bem.'
	},
	{
		about: 'tucano',
		text: 'O bico do tucano é enorme, mas leve: ele ajuda a ave a se refrescar no calor.'
	},
	{
		about: 'preguiça',
		text: 'A preguiça desce da árvore mais ou menos uma vez por semana, só para fazer cocô.'
	},
	{
		about: 'jequitibá',
		text: 'O jequitibá-rosa é uma das árvores mais altas da Mata Atlântica: passa de 40 metros.'
	},
	{
		about: 'pau-brasil',
		text: 'O pau-brasil deu nome ao nosso país. Da madeira dele se fazia tinta vermelha.'
	},
	{
		about: 'juçara',
		text: 'A palmeira-juçara tem um tronco só: tirar o palmito mata a planta. Seus frutos alimentam tucanos e sabiás.'
	},
	{
		about: 'araucária',
		text: 'A gralha-azul enterra pinhões para comer depois. Os que ela esquece viram novas araucárias.'
	}
] as const;

/** One fact on screen for this long. */
export const FACT_MS = 6000;

/** Index of the fact shown `elapsed` ms after the screen appeared, starting from `first`. */
export function factIndex(elapsed: number, first = 0, count: number = FACTS.length) {
	const step = Math.floor(Math.max(0, elapsed) / FACT_MS);
	return (((Math.trunc(first) + step) % count) + count) % count;
}
