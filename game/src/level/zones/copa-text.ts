/**
 * The Copa's player-facing texts (pt-BR), by key: what the missions'
 * `dialogue`, the homes' `fact` and the landmarks use. Every fact (FACT_*)
 * carries its source; 'TODO-SOURCE' marks one the coordinator has not checked
 * yet. Inclusive language and the LEVEL.md safety rules, as in vale-text.ts.
 */
import type { ZoneText } from './content.ts';

export const COPA_TEXT: Record<string, ZoneText> = {
	// C1 — Passarela nas copas (arrival)
	COPA_INTRO_1: { text: 'Boas-vindas à Copa das Árvores, a mata mais antiga do parque!' },
	COPA_INTRO_2: {
		text: 'Suba a escada e dê a volta inteira na passarela suspensa. Lá no alto, entre as copas, mora muita vida.'
	},
	COPA_C1_DONE: {
		text: 'Volta completa! Repare: muitos bichos da mata vivem nas copas, bem longe do chão.'
	},
	FACT_VIDA_NAS_COPAS: {
		text: 'Nas florestas tropicais, muitos bichos vivem nas copas das árvores, onde há mais luz, flores e frutos.',
		source: 'https://striresearch.si.edu/rainforest/home/canopy/'
	},
	// C2 — Fotos do alto
	COPA_C2_INTRO: {
		text: 'Use a câmera nos mirantes da passarela e fotografe cinco bichos diferentes: um tucano, uma saíra, uma preguiça, um mico e um bugio.'
	},
	COPA_C2_HINT: { text: 'Fique em silêncio e espere: observar sem perturbar é a regra de ouro.' },
	COPA_C2_DONE: {
		text: 'Cinco fotos e nenhum bicho assustado! Todas já estão no seu Guia da Mata.'
	},
	FACT_OBSERVACAO: {
		text: 'No Parque Nacional da Serra dos Órgãos, uma trilha suspensa construída sobre um antigo aqueduto deixa ver mais de perto a copa das árvores.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/unidade-de-conservacao/unidades-de-biomas/mata-atlantica/lista-de-ucs/parna-da-serra-dos-orgaos/guia-do-visitante/guia-do-visitante-1/atrativos/sede-teresopolis/trilhas'
	},
	FACT_TUCANO: {
		text: 'O tucano-de-bico-verde come frutos e espalha as sementes pela floresta.',
		source: 'https://periodicos.ufjf.br/index.php/zoociencias/article/download/24681/13849'
	},
	FACT_SAIRA: {
		text: 'A saíra-sete-cores só vive na Mata Atlântica. Ela anda em grupinhos, e os machos adultos têm as cores mais vivas.',
		source: 'https://wwfbr.awsassets.panda.org/downloads/guia_de_aves_mataatlantica_wwfbrasil.pdf'
	},
	FACT_PREGUICA: {
		text: 'A preguiça-de-coleira passa quase a vida toda nas árvores e se alimenta de folhas, de preferência as mais novas.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/fichas_2019_2021/cingulata/dasypodidae/pilosa/bradypodidae/ficha-bradypus-torquatus.pdf'
	},
	FACT_MICO: {
		text: 'O mico-leão-dourado vive em grupos familiares e, na natureza, só existe na Mata Atlântica do Rio de Janeiro.',
		source: 'https://micoleao.org.br/a-especie/'
	},
	FACT_BUGIO: {
		text: 'O ronco do bugio é tão forte que pode ser ouvido a centenas de metros. Ele ronca mais quando encontra outro bando.',
		source: 'https://doi.org/10.1896/1413-4705.13.2.11'
	},
	// C3 — Vovó Jequitibá
	COPA_C3_INTRO: {
		text: 'Encontre a Vovó Jequitibá, a árvore-mãe mais alta da Copa, e recolha 6 sementes caídas para o viveiro da Iara.'
	},
	COPA_C3_DONE: {
		text: 'Seis sementes da Vovó! No viveiro, elas vão virar mudas para restaurar a mata.'
	},
	FACT_ARVORE_MATRIZ: {
		text: 'Árvores-matrizes são árvores adultas e saudáveis escolhidas para fornecer sementes aos viveiros que produzem mudas para a restauração.',
		source: 'https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/293783/1/Circular144.pdf'
	},
	FACT_JEQUITIBA: {
		text: 'O jequitibá-rosa é um gigante da Mata Atlântica: pode passar de 40 metros de altura e viver por centenas de anos.',
		source:
			'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140093/1/Especies-Arboreas-Brasileiras-vol-1-Jequitiba-Rosa.pdf'
	},
	// C4 — A torre
	COPA_C4_INTRO: { text: 'Suba a escada da torre de observação e olhe o parque inteiro lá de cima.' },
	COPA_C4_SAFETY: {
		text: 'Segure firme e suba com calma. Lá em cima, fique sempre por dentro do guarda-corpo.'
	},
	COPA_C4_DONE: { text: 'Que vista! O Mapa do Parque agora aparece no seu painel.' },
	FACT_TORRE: {
		text: 'Na Reserva Ecológica de Guapiaçu, em Cachoeiras de Macacu (RJ), a Torre São José ajuda a observar a copa das árvores e o vale do Guapiaçu lá do alto.',
		source: 'https://www.reguabirdwatching.org.br/conservation-regua'
	},
	// Trail marks (PARK.md §3)
	COPA_MARCAS_VOLTE: {
		text: 'Iara pelo rádio: não vejo você perto das marcas da trilha. Volte até a última patinha amarela e preta!'
	},
	// Labels
	LABEL_COPA: { text: 'Copa das Árvores' },
	LABEL_PASSARELA: { text: 'Passarela nas copas' },
	LABEL_TORRE: { text: 'Torre de observação' },
	LABEL_VOVO: { text: 'Vovó Jequitibá' }
};

/** Mission names (pt-BR), C1 to C4. */
export const COPA_MISSION_NAMES = [
	'Passarela nas copas',
	'Fotos do alto',
	'Vovó Jequitibá',
	'A torre'
] as const;
