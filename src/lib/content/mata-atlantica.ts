import type { Journey, TreeInfo } from './types.ts';

/**
 * The Atlantic Forest journey, written for the guardioes-da-floresta prototype
 * on Replit. It was first designed on a trail at PENAP but works in any
 * Atlantic Forest setting. The timers and the checklist are additions that
 * help in the field. The id stays 'penap' because stored sessions reference it.
 */
/*
 * Tree facts verified on 2026-10-25. Neither species is exclusive to the
 * Atlantic Forest; the origin of the popular names is not explained by any
 * reliable source, so the texts do not explain them. The common names are also
 * used for other species: confirm with a botanist which trees are on the trail.
 */
const canelaPreta: TreeInfo = {
	name: 'Canela-preta',
	scientificName: 'Ocotea catharinensis',
	family: 'Lauraceae',
	summary:
		'Típica das encostas e morros da Mata Atlântica, mas também aparece no Pampa. Cresce devagar, à sombra da floresta, e seus frutos alimentam aves e mamíferos, como o muriqui. Muito cortada por sua madeira, hoje está ameaçada de extinção.',
	cues: [
		'Casca escura, com marcas côncavas onde se soltou em placas.',
		'Folhas firmes e pontudas; embaixo, tufinhos de pelos claros onde as nervuras se encontram.',
		'Fruto ovalado, com a base encaixada numa “tacinha” (cúpula) escura.'
	],
	sources: [
		'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1139722/1/Especies-Arboreas-Brasileiras-vol-1-Canela-Preta.pdf',
		'https://proflora.jbrj.gov.br/html/Ocotea%20catharinensis_2012.html',
		'https://servicos.jbrj.gov.br/v2/flora/taxon/Ocotea%20catharinensis'
	]
};

const cedroRosa: TreeInfo = {
	name: 'Cedro-rosa',
	scientificName: 'Cedrela fissilis',
	family: 'Meliaceae',
	summary:
		'Vive na Mata Atlântica e também em outros biomas do Brasil e em outros países. Seus frutos secos e duros se abrem como flores de madeira e soltam sementes com asas, levadas pelo vento. Muito cortado por sua madeira e pelo desmatamento, também está ameaçado de extinção.',
	cues: [
		'Casca grossa, com rachaduras fundas ao longo do tronco.',
		'Folhas grandes, com muitos pares de folhinhas (folíolos).',
		'Frutos secos e duros, abertos em 5 partes, às vezes ainda presos nos galhos.'
	],
	sources: [
		'https://www.alice.cnptia.embrapa.br/alice/bitstream/doc/1139731/1/Especies-Arboreas-Brasileiras-vol-1-Cedro.pdf',
		'https://proflora.jbrj.gov.br/html/Cedrela%20fissilis_2012.html',
		'https://servicos.jbrj.gov.br/v2/flora/taxon/Cedrela%20fissilis'
	]
};

export const mataAtlantica: Journey = {
	// Stable id: sessions saved on phones and in the cloud reference it.
	id: 'penap',
	name: 'Guardiões da Mata Atlântica',
	place: 'Mata Atlântica',
	steps: [
		{
			id: 'chamado',
			kind: 'opening',
			icon: 'compass',
			title: 'O Chamado da Floresta',
			callout: `Há muito tempo, antes das cidades, das estradas e do barulho,
a Mata Atlântica já estava aqui.

Respirando.
Crescendo.
Guardando vida em cada folha, em cada raiz, em cada som.

Dizem que, desde sempre, a floresta nunca esteve sozinha.

Existiam guardiões.

Pessoas capazes de perceber além do que é imediato.
De compreender o que a natureza revela em silêncio.
De se conectar com tudo o que vive.

Eles não eram escolhidos por força…
nem por conhecimento…

Mas por algo mais raro:

A capacidade de se conectar.

Com o tempo, muitos desses guardiões desapareceram.
E o mundo lá fora se tornou mais rápido, mais distante…
mais esquecido daquilo que realmente importa.

Mas a floresta nunca deixou de chamar.

E quando ela chama…
ela chama as pessoas certas.

Hoje, esse chamado chegou até você.

Você não está aqui apenas para percorrer uma trilha.

Você está aqui para iniciar uma jornada.

Ao longo do caminho, a floresta vai te apresentar desafios.
E, a cada etapa, algo dentro de você será despertado.

Se você seguir até o fim…
talvez descubra que o que a floresta procura
não são visitantes.

Mas novos guardiões.

Sua jornada começa agora.`
		},
		{
			id: 'conhecimento',
			kind: 'mission',
			icon: 'tree',
			title: 'Conhecimento da Floresta',
			callout: 'Todo guardião precisa conhecer aquilo que protege.',
			instructions:
				'Observe duas árvores diferentes (como a canela-preta e o cedro-rosa). Descreva suas diferenças e explique sua importância para a floresta.',
			illustration: 'canela-and-cedro',
			trees: [canelaPreta, cedroRosa],
			power: 'Sabedoria Verde'
		},
		{
			id: 'sons',
			kind: 'mission',
			icon: 'ear',
			title: 'Desafio dos Sons da Mata',
			callout: 'A floresta fala através dos seus sons.',
			instructions:
				'Em silêncio, identifique três sons da floresta. Depois, um grupo imita um som e o outro tenta descobrir.',
			timer: { seconds: 60, label: 'Minuto de silêncio' },
			power: 'Escuta Atenta',
			scored: true
		},
		{
			id: 'olhar',
			kind: 'mission',
			icon: 'binoculars',
			title: 'Olhar da Mata',
			callout: 'Um guardião enxerga o que os outros não veem.',
			instructions:
				'Observe a paisagem ao seu redor. Discuta o que torna esse lugar importante e por que ele deve ser preservado.',
			power: 'Visão de Guardião'
		},
		{
			id: 'registro',
			kind: 'mission',
			icon: 'camera',
			title: 'Registro do Guardião',
			callout: 'Toda jornada merece ser lembrada.',
			instructions: 'Cada grupo procura e registra:',
			checklist: [
				{ id: 'inseto', label: 'Um inseto' },
				{ id: 'planta', label: 'Uma planta interessante' },
				{ id: 'arvore', label: 'Uma árvore grande' },
				{ id: 'agua', label: 'Um sinal de água' },
				{ id: 'paisagem', label: 'Uma paisagem marcante' }
			],
			power: 'Memória Viva',
			scored: true
		},
		{
			id: 'expressao',
			kind: 'mission',
			icon: 'mask-happy',
			title: 'Expressão do Guardião',
			callout: 'Chegou a hora de expressar tudo o que aprendeu.',
			instructions:
				'Crie uma apresentação (teatro, fala ou expressão) sobre a importância da Mata Atlântica.',
			timer: { seconds: 120, label: 'Tempo de cada apresentação' },
			power: 'Voz da Floresta',
			scored: true
		},
		{
			id: 'juramento',
			kind: 'oath',
			icon: 'handshake',
			title: 'Juramento Final',
			callout:
				'Hoje, eu me comprometo a respeitar, proteger e cuidar da natureza. Eu escolho ser um Guardião da Mata Atlântica.',
			instructions: 'Repita o juramento em voz alta, com seu grupo de mãos dadas.'
		}
	],
	groups: [
		{ name: 'Canela-preta', color: '#ea9356', hint: 'Típica das encostas e morros da Mata Atlântica' },
		{ name: 'Cedro-rosa', color: '#ff9fb7', hint: 'Solta sementes com asas, levadas pelo vento' }
	],
	areas: [
		{
			id: 'clareira',
			icon: 'flower',
			name: 'Clareira Inicial',
			description: 'Onde tudo começa',
			missions: 0
		},
		{
			id: 'trilha',
			icon: 'footprints',
			name: 'Trilha das Árvores',
			description: 'Aberta pela missão 1',
			missions: 1
		},
		{ id: 'rio', icon: 'drop', name: 'Rio da Vida', description: 'Aberto pela missão 2', missions: 2 },
		{
			id: 'montanha',
			icon: 'mountain',
			name: 'Montanha Verde',
			description: 'Aberta pela missão 4',
			missions: 4
		},
		{
			id: 'coracao',
			icon: 'tree-evergreen',
			name: 'Coração da Mata',
			description: 'Aberto pela missão final',
			missions: 5
		}
	],
	ranks: [
		{ name: 'Aprendizes', missions: 0 },
		{ name: 'Guardiões', missions: 2 },
		{ name: 'Mestres da Floresta', missions: 4 }
	],
	achievements: [
		{ id: 'primeiro-passo', name: 'Primeiro Passo', description: 'Concluir a primeira missão', missions: 1 },
		{
			id: 'em-treinamento',
			name: 'Guardiões em Treinamento',
			description: 'Concluir 3 missões',
			missions: 3
		},
		{ id: 'protetores', name: 'Protetores da Mata', description: 'Concluir as 5 missões', missions: 5 },
		{ id: 'mestres', name: 'Mestres da Floresta', description: 'Fazer o juramento final', oath: true }
	],
	closing: {
		title: 'Vocês são Guardiões da Mata Atlântica!',
		text: 'A jornada pela Mata Atlântica foi cumprida. A promessa de vocês agora vive em cada árvore, cada som e cada caminho desta floresta.',
		pledge: 'Levem este compromisso para fora da mata: protejam, ensinem, inspirem.'
	}
};

export const journeys: Record<string, Journey> = { [mataAtlantica.id]: mataAtlantica };
