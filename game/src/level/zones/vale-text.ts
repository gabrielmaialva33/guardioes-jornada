/**
 * The Vale's player-facing texts (pt-BR), by key: what the missions'
 * `dialogue`, the homes' `fact` and the landmarks use. Every fact (FACT_*)
 * carries its source; 'TODO-SOURCE' marks one the coordinator has not checked
 * yet. Inclusive language and the LEVEL.md safety rules (stay on the trail,
 * keep away from wild animals, never feed them) as in missions/content.ts.
 */
import type { ZoneText } from './content.ts';

export const VALE_TEXT: Record<string, ZoneText> = {
	// V1 — Siga o som da água (arrival)
	VALE_INTRO_1: { text: 'Boas-vindas ao Vale das Cachoeiras! Aqui a Mata Atlântica sobe a serra.' },
	VALE_INTRO_2: {
		text: 'Escute… está ouvindo esse barulho? É água caindo. Siga o som pela trilha até o mirante do poço.'
	},
	VALE_INTRO_3: {
		text: 'Fique sempre na trilha: as marcas amarelas e pretas com a patinha do mico mostram o caminho.'
	},
	VALE_V1_DONE: {
		text: 'Olha ela aí: a Cachoeira Grande! Você ouviu a cachoeira muito antes de conseguir enxergá-la.'
	},
	FACT_SOM_DA_AGUA: {
		text: 'No Parque Nacional da Serra dos Órgãos, o rio Soberbo forma o Poço Verde, um conjunto de cachoeiras, corredeiras e poços.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/unidade-de-conservacao/unidades-de-biomas/mata-atlantica/lista-de-ucs/parna-da-serra-dos-orgaos/guia-do-visitante/guia-do-visitante-1/atrativos/sede-guapimirim/pocos-e-cachoeiras'
	},
	// V2 — O poço limpo
	VALE_V2_INTRO: {
		text: 'Visitantes deixaram lixo em volta do poço. Recolha os 6: garrafa, lata, sacola, casca de laranja, canudo e embalagem.'
	},
	VALE_V2_DONE: {
		text: 'Poço limpo! Na vida real, leve sempre seu lixo de volta da trilha, até a casca de fruta.'
	},
	FACT_LEVE_SEU_LIXO: {
		text: 'Muitos parques não têm lixeiras nas trilhas: a regra é levar de volta todo o lixo que você trouxe.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/unidade-de-conservacao/unidades-de-biomas/mata-atlantica/lista-de-ucs/parna-e-historico-do-monte-pascoal/protocolo-operacional-da-visitacao/Protocolo-Operacional-da-Visitacao.pdf/@@download/file'
	},
	FACT_CASCA_DE_FRUTA: {
		text: 'Casca de fruta também é lixo na trilha: jogada no chão, ela atrai animais para perto das pessoas.',
		source: 'https://pt.lnt.org/out-here-its-trash-apple-cores-orange-peels-and-other-natural-items/'
	},
	// V3 — Ponte pênsil
	VALE_V3_INTRO: {
		text: 'Esta é uma ponte pênsil. Atravesse com calma, uma pessoa de cada vez, e sem balançar.'
	},
	VALE_V3_DONE: {
		text: 'Você chegou à margem norte! Ouviu esses chamados no alto das árvores? São os muriquis.'
	},
	FACT_PONTE_PENSIL: {
		text: 'A ponte pênsil do Parque Nacional da Tijuca, no Rio, tem capacidade para quatro pessoas, e o parque pede que ninguém se balance nela.',
		source: 'https://parquenacionaldatijuca.rio/locais/ponte-pensil/'
	},
	// V4 — Censo dos muriquis
	VALE_V4_INTRO: {
		text: 'Quem pesquisa os muriquis conta os animais sem incomodá-los: prende uma armadilha fotográfica num tronco e volta depois. Instale a câmera no tronco marcado.'
	},
	VALE_V4_PLACED: {
		text: 'Câmera instalada! Agora deixe os muriquis em paz. Complete outra missão e volte para ver a foto.'
	},
	VALE_V4_DONE: {
		text: 'A câmera registrou uma mãe muriqui com o filhote! O muriqui entrou no seu Guia da Mata.'
	},
	FACT_MURIQUI: {
		text: 'O muriqui é o maior macaco das Américas e só existe na Mata Atlântica. Ele está ameaçado de extinção.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/programa-de-manejo-populacional/muriqui-do-sul/programa_manejo_brachyteles_arachnoides.pdf'
	},
	FACT_ARMADILHA_FOTOGRAFICA: {
		text: 'A armadilha fotográfica dispara sozinha quando um animal passa na frente: ninguém precisa ficar por perto assustando os bichos.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/monitoramento/conteudo/artigos-Monitora/release-07-Mendonca-et-al.'
	},
	// V5 — A nascente
	VALE_V5_INTRO: {
		text: 'A água deste vale nasce lá em cima, depois da cachoeira. Suba pelas pedras ao lado da queda até a nascente.'
	},
	VALE_V5_STONES: {
		text: 'Cada pedra fica um pouco mais alta que a anterior. Se cair, tudo bem: volte pela trilha do morro e tente de novo.'
	},
	VALE_V5_SPRING: { text: 'Esta é a nascente! Plante 5 mudas em volta dela para formar a mata ciliar.' },
	VALE_V5_DONE: {
		text: 'Mata ciliar plantada! As raízes seguram a terra e protegem a água que nasce aqui.'
	},
	FACT_APP_NASCENTE: {
		text: 'Pelo Código Florestal, a mata num raio de pelo menos 50 metros em volta de uma nascente é Área de Preservação Permanente e deve ser conservada.',
		source: 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12651.htm'
	},
	FACT_MATA_CILIAR: {
		text: 'A mata ciliar protege rios e nascentes como os cílios protegem os olhos: ela segura a terra que a chuva levaria para dentro da água.',
		source:
			'https://www.embrapa.br/contando-ciencia/agua/-/asset_publisher/EljjNRSeHvoC/content/a-importancia-das-matas-ciliares/1355746'
	},
	// Animals
	FACT_BUGIO: {
		text: 'O ronco do bugio é tão forte que pode ser ouvido a centenas de metros. Ele ronca mais quando encontra outro bando.',
		source: 'https://doi.org/10.1896/1413-4705.13.2.11'
	},
	FACT_PREGUICA: {
		text: 'A preguiça-de-coleira passa quase a vida toda nas árvores e se alimenta de folhas, de preferência as mais novas.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/fichas_2019_2021/cingulata/dasypodidae/pilosa/bradypodidae/ficha-bradypus-torquatus.pdf'
	},
	FACT_JACUTINGA: {
		text: 'A jacutinga come os frutos da palmeira-juçara e espalha as sementes pela mata. Ela está ameaçada de extinção.',
		source: 'https://doi.org/10.37002/salve.ficha.24266'
	},
	// Trail marks (PARK.md §3)
	VALE_MARCAS_VOLTE: {
		text: 'Iara pelo rádio: não vejo você perto das marcas da trilha. Volte até a última patinha amarela e preta!'
	},
	// Labels
	LABEL_VALE: { text: 'Vale das Cachoeiras' },
	LABEL_CACHOEIRA: { text: 'Cachoeira Grande' },
	LABEL_PONTE: { text: 'Ponte pênsil' },
	LABEL_MIRANTE: { text: 'Mirante do Poço' },
	LABEL_NASCENTE: { text: 'Nascente' },
	LABEL_TRONCO: { text: 'Tronco marcado' }
};

/** Mission names (pt-BR), V1 to V5. */
export const VALE_MISSION_NAMES = [
	'Siga o som da água',
	'O poço limpo',
	'Ponte pênsil',
	'Censo dos muriquis',
	'A nascente'
] as const;
