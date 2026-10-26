/**
 * The Manguezal's player-facing texts (pt-BR), by key: what the missions'
 * `dialogue`, the homes' `fact` and the landmarks use. Every fact (FACT_*)
 * carries its source; 'TODO-SOURCE' marks one the coordinator has not checked
 * yet. Inclusive language and the LEVEL.md safety rules (stay on the trail,
 * keep away from wild animals, never feed them) as in missions/content.ts.
 */
import type { ZoneText } from './content.ts';

export const MANGUE_TEXT: Record<string, ZoneText> = {
	// M1 — Travessia de canoa (arrival)
	MANGUE_INTRO_1: {
		text: 'Boas-vindas ao manguezal! Aqui o rio encontra o mar, e a água sobe e desce com a maré.'
	},
	MANGUE_INTRO_2: {
		text: 'A maré está cheia. Siga a trilha pelo dique de areia até o atracadouro: a canoa leva você até a passarela.'
	},
	MANGUE_M1_INTRO: { text: 'Entre na canoa e reme pelo canal até a passarela. A correnteza ajuda um pouco.' },
	MANGUE_M1_DONE: {
		text: 'Você atravessou! Daqui em diante, ande só pela passarela: a lama do mangue é a casa de muitos bichos.'
	},
	MANGUE_NAO_PISE: { text: 'Não pise no mangue: as raízes e os bichos da lama são frágeis.' },
	FACT_MANGUE_BERCARIO: {
		text: 'O manguezal é um berçário: muitos filhotes de peixes, camarões e caranguejos crescem ali, protegidos entre as raízes.',
		source: 'https://doi.org/10.1016/j.aquabot.2007.12.007'
	},
	// M2 — Caranguejo-uçá
	MANGUE_M2_INTRO: {
		text: 'Procure caranguejos-uçás nos bancos de lama perto da passarela. Observe de longe, sem tocar.'
	},
	MANGUE_M2_DONE: { text: 'Você encontrou os 5 caranguejos-uçás! Eles vivem em tocas cavadas na lama.' },
	MANGUE_DEFESO_PLACA: {
		text: 'Defeso do caranguejo-uçá: em outubro e novembro, ninguém pode pegar caranguejos-uçás. Em dezembro, as fêmeas continuam protegidas.'
	},
	FACT_DEFESO_CARANGUEJO: {
		text: 'Na andada, os caranguejos-uçás saem das tocas para se reproduzir. No defeso do Rio de Janeiro, ninguém pode pegá-los em outubro e novembro, e as fêmeas ficam protegidas também em dezembro.',
		source:
			'https://www.gov.br/ibama/pt-br/assuntos/biodiversidade/biodiversidade-aquatica/arquivos/defesos-marinho/2025-01-14_caranguejo-uca_portaria_ibama_n-o-52_2003.pdf'
	},
	FACT_CARANGUEJO_UCA: {
		text: 'O caranguejo-uçá vive em tocas na lama do mangue e se alimenta das folhas que caem das árvores.',
		source: 'https://www.pesca.sp.gov.br/web/content/2787?download=true'
	},
	// M3 — Propágulos
	MANGUE_M3_INTRO: {
		text: 'Na clareira de lama, plante 6 propágulos de mangue-vermelho. Desça da plataforma com cuidado.'
	},
	MANGUE_M3_DONE: { text: 'Cada propágulo pode virar uma árvore nova do mangue.' },
	FACT_PROPAGULO: {
		text: 'O mangue-vermelho não solta sementes comuns: o propágulo começa a crescer ainda preso à árvore, depois cai na lama ou é levado pela água.',
		source:
			'https://www.gov.br/icmbio/pt-br/centrais-de-conteudo/publicacoes/atlas-1/atlas_dos_manguezais_do_brasil.pdf'
	},
	// M4 — Lixo nas raízes
	MANGUE_M4_INTRO: {
		text: 'O rio trouxe lixo até aqui. Solte das raízes os 5 que estão perto da passarela.'
	},
	MANGUE_M4_DONE: { text: 'Muito bem! Esse lixo não vai mais para o mar.' },
	FACT_LIXO_RIO_MAR: {
		text: 'Os rios levam muito lixo para o mar, e parte dele fica presa nas raízes do mangue.',
		source: 'https://doi.org/10.1016/j.marpolbul.2023.115434'
	},
	// M5 — Os colhereiros
	MANGUE_M5_INTRO: { text: 'No fim da tarde, vá ao esconderijo e espere os colhereiros em silêncio.' },
	MANGUE_M5_DONE: {
		text: 'Olha só o bando cor-de-rosa chegando para comer na lama! Eles balançam o bico de um lado para o outro na água rasa.'
	},
	FACT_GUARA: {
		text: 'O bico do colhereiro é cheio de nervos que sentem os bichinhos debaixo d’água. Ele costuma ficar mais ativo à noite.',
		source: 'https://periodicos.meioambiente.mg.gov.br/MB/article/download/163/107/476'
	},
	FACT_GUARA_CUBATAO: {
		text: 'No Parque Nacional da Restinga de Jurubatiba, no Rio de Janeiro, dá para ver colhereiros procurando comida em águas rasas.',
		source:
			'https://www.gov.br/icmbio/pt-br/centrais-de-conteudo/publicacoes/guias-de-aves/jurubatiba_livro_aves_final.pdf'
	},
	// Homes
	FACT_GARCA_BRANCA: {
		text: 'A garça-branca caminha devagar na água rasa e pesca peixes com o bico.',
		source: 'https://teses.usp.br/teses/disponiveis/85/85131/tde-14102013-135313/publico/2013SilvaEstudo.pdf'
	},
	FACT_CAPIVARA: {
		text: 'A capivara é o maior roedor do mundo e vive perto de rios e lagoas.',
		source:
			'https://www.ufrgs.br/faunadigitalrs/mamiferos/ordem-rodentia/familia-caviidae/capivara-hydrochoerus-hydrochaeris/'
	},
	// Labels
	LABEL_MANGUEZAL: { text: 'Manguezal' },
	LABEL_ATRACADOURO: { text: 'Atracadouro' },
	LABEL_PASSARELA: { text: 'Passarela do mangue' },
	LABEL_ESCONDERIJO: { text: 'Esconderijo dos colhereiros' },
	LABEL_DEFESO: { text: 'Defeso do caranguejo-uçá' }
};

export const MANGUE_MISSION_NAMES = [
	'Travessia de canoa',
	'Caranguejo-uçá',
	'Propágulos',
	'Lixo nas raízes',
	'Os colhereiros'
] as const;
