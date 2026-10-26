/**
 * The Praia's player-facing texts (pt-BR), by key: what the missions'
 * `dialogue`, the homes' `fact`, the fragile ground's warnings and the
 * landmarks use. Every fact (FACT_*) carries its source; 'TODO-SOURCE' marks
 * one the coordinator has not checked yet. Inclusive language and the LEVEL.md
 * safety rules (look, never touch; call for help), as in vale-text.ts.
 */
import type { ZoneText } from './content.ts';

export const PRAIA_TEXT: Record<string, ZoneText> = {
	// P1 — Limpeza da praia (arrival)
	PRAIA_INTRO_1: { text: 'Boas-vindas à Praia e Costão! Aqui a Mata Atlântica encontra o mar.' },
	PRAIA_INTRO_2: {
		text: 'A maré trouxe lixo para a areia. Recolha os 8 itens e veja no contador quanto deles é plástico.'
	},
	PRAIA_P1_DONE: {
		text: 'Praia limpa! Repare no contador: quase tudo era plástico. Na vida real, leve seu lixo embora e evite descartáveis.'
	},
	FACT_LIXO_PLASTICO: {
		text: 'A maior parte do lixo encontrado nas praias brasileiras é plástico.',
		source: 'https://seashepherd.org.br/files/relatorio_olne.pdf'
	},
	FACT_PLASTICO_NO_MAR: {
		text: 'No mar, o plástico se quebra em pedacinhos que tartarugas, aves e peixes confundem com comida.',
		source:
			'https://brasil.oceana.org/wp-content/uploads/sites/23/2024/10/Fragmentos-da-Destruicao_FINAL-FINAL-FINAL_compressed.pdf'
	},
	// P2 — Poças de maré
	PRAIA_P2_INTRO: {
		text: 'Nas poças de maré do costão vivem bichos pequenos. Encontre um ouriço, uma estrela-do-mar, uma anêmona e um peixinho, olhando de fora.'
	},
	PRAIA_NAO_PISE: { text: 'Não pise! As poças estão cheias de vida. Olhe de fora, sem entrar e sem tocar.' },
	PRAIA_P2_DONE: { text: 'Você achou os quatro sem pisar em nenhuma poça. Isso é observar com cuidado!' },
	FACT_COSTAO: {
		text: 'Ouriços, estrelas-do-mar e anêmonas se grudam firme nas pedras do costão para as ondas não os levarem.',
		source: 'https://doi.org/10.7213/estud.biol.7332'
	},
	FACT_POCAS_FRAGEIS: {
		text: 'Mesmo poucas pisadas no costão podem prejudicar os bichinhos que vivem presos às pedras, como as cracas.',
		source: 'https://doi.org/10.1590/s1519-69842009000500003'
	},
	// P3 — Tartaruga no costão
	PRAIA_P3_INTRO: {
		text: 'Suba com calma até o mirante do costão e observe o mar: tem tartarugas-verdes comendo algas nas pedras.'
	},
	PRAIA_P3_ALERTA: {
		text: 'Olhe ali! Uma tartaruga está presa numa linha de pesca. Nunca tente tocar: chame a equipe de resgate pelo rádio.'
	},
	PRAIA_P3_DONE: {
		text: 'Você avisou a equipe de resgate, que vai soltar a tartaruga com segurança. Muito bem!'
	},
	FACT_TARTARUGA_VERDE: {
		text: 'Na Região dos Lagos, no litoral do Rio de Janeiro, tartarugas-verdes são vistas o ano todo. As jovens comem principalmente algas.',
		source:
			'https://uenf.br/posgraduacao/ecologia-recursosnaturais/wp-content/uploads/sites/7/2013/10/Danielle-Rodrigues-Awabdi.pdf'
	},
	FACT_RESGATE: {
		text: 'Animal marinho preso ou machucado na praia? Não toque: avise uma pessoa adulta e a equipe de monitoramento de praias da região.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/tartarugas-marinhas-e-biodiversidade-marinha-do-leste/o-que-fazemos/programas-de-monitoramento-de-praias'
	},
	// P4 — Restinga
	PRAIA_P4_INTRO: {
		text: 'Ande pela passarela da restinga e fotografe três plantas: uma bromélia, uma pitangueira e um cacto.'
	},
	PRAIA_RESTINGA_FRAGIL: {
		text: 'A restinga é frágil! Volte para a passarela: cada pisada amassa plantas que seguram a areia.'
	},
	PRAIA_P4_DONE: { text: 'Três fotos e nenhuma planta pisada. A restinga agradece!' },
	FACT_RESTINGA: {
		text: 'As plantas da restinga ajudam a segurar a areia das dunas, e o pisoteio abre trilhas e diminui essas plantas.',
		source:
			'https://www.gov.br/icmbio/pt-br/assuntos/unidade-de-conservacao/unidades-de-biomas/marinho/lista-de-ucs/apa-da-baleia-franca/arquivos/6_vegetacao_e_flora_apa_da_baleia_franca.pdf/@@download/file'
	},
	FACT_BROMELIA: {
		text: 'Muitas bromélias guardam água da chuva entre as folhas, e vários bichinhos usam essa pequena piscina.',
		source: 'https://doi.org/10.1590/s0102-33062010000100009'
	},
	FACT_PITANGUEIRA: {
		text: 'A pitangueira é nativa da Mata Atlântica e cresce até na restinga. Aves comem suas frutinhas e espalham as sementes.',
		source:
			'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1140887/1/Especies-Arboreas-Brasileiras-vol-2-Pitangueira.pdf'
	},
	FACT_CACTO: {
		text: 'Na restinga também crescem cactos nativos, que aguentam sol forte e pouca água.',
		source: 'https://doi.org/10.1590/2175-78602005568711'
	},
	// Animals
	FACT_CARANGUEJO: {
		text: 'Na maré baixa, os caranguejos do costão se abrigam nas frestas das pedras para fugir do calor.',
		source: 'https://doi.org/10.7213/estud.biol.7332'
	},
	FACT_ATOBA: {
		text: 'O atobá pesca peixes e lulas com mergulhos rápidos e retos e faz ninhos em ilhas.',
		source:
			'https://www.gov.br/icmbio/pt-br/centrais-de-conteudo/publicacoes/guias-de-aves/202506_guia-aves-marinhas-junho-2025-web_isbn.pdf/@@download/file'
	},
	FACT_GAIVOTA: {
		text: 'O gaivotão come de tudo um pouco: peixes, bichinhos do mar e até restos da pesca deixados na praia.',
		source:
			'https://acervodigital.ufpr.br/xmlui/bitstream/handle/1884/45191/R%20-%20D%20-%20MAIARA%20LARISSA%20MIOTTO.pdf?isAllowed=y&sequence=1'
	},
	FACT_SAIRA: {
		text: 'A saíra-sete-cores só vive na Mata Atlântica. Ela anda em grupinhos, e os machos adultos têm as cores mais vivas.',
		source: 'https://wwfbr.awsassets.panda.org/downloads/guia_de_aves_mataatlantica_wwfbrasil.pdf'
	},
	FACT_SABIA: {
		text: 'O melhor horário para ouvir o sabiá-laranjeira é ao amanhecer e à tarde. Ele canta para marcar território e conquistar um par.',
		source: 'https://prefeitura.sp.gov.br/web/meio_ambiente/w/noticias/285564'
	},
	// Trail marks (PARK.md §3)
	PRAIA_MARCAS_VOLTE: {
		text: 'Iara pelo rádio: não vejo você perto das marcas da trilha. Volte até a última patinha amarela e preta!'
	},
	// Labels
	LABEL_PRAIA: { text: 'Praia e Costão' },
	LABEL_RESTINGA: { text: 'Passarela da restinga' },
	LABEL_POCAS: { text: 'Poças de maré' },
	LABEL_MIRANTE: { text: 'Mirante do Costão' }
};

/** Mission names (pt-BR), P1 to P4. */
export const PRAIA_MISSION_NAMES = [
	'Limpeza da praia',
	'Poças de maré',
	'Tartaruga no costão',
	'Restinga'
] as const;
