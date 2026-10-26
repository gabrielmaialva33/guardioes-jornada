/** Editorial draft, reviewed 2026-10-26. Every biological text has its own source.
 * TODO-SOURCE is an explicit release-review item, never evidence of verification.
 * Zones, encounter times and rarities are game-design metadata, not conservation facts.
 * No remote images, fonts or facts are fetched by the runtime.
 */
import type { SpeciesEntry } from './types.ts';
export const SPECIES: readonly SpeciesEntry[] = [
	{
		id: 'mico-leao-dourado',
		aliases: ['mico'],
		name: {
			text: 'Mico-leão-dourado',
			source: 'https://doi.org/10.37002/salve.ficha.31037.2'
		},
		scientificName: {
			text: 'Leontopithecus rosalia',
			source: 'https://doi.org/10.37002/salve.ficha.31037.2'
		},
		habitat: {
			text: 'Florestas da Mata Atlântica do Rio de Janeiro, principalmente nas baixadas.',
			source: 'https://doi.org/10.37002/salve.ficha.31037.2'
		},
		diet: {
			text: 'Frutos e pequenos animais, como insetos.',
			source: 'https://www.savetheliontamarin.org/faqs'
		},
		status: {
			text: 'Em perigo',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026). No mundo (IUCN): Em perigo.'
		},
		fact: {
			text: 'A cauda ajuda o mico a se equilibrar entre os galhos.',
			source: 'https://www.savetheliontamarin.org/faqs'
		},
		zones: ['reserva', 'copa'],
		times: ['day'],
		rarity: 'raro',
		art: 'primate',
		color: '#c57825',
		accent: '#f1ca6b'
	},
	{
		id: 'muriqui',
		aliases: [],
		name: {
			text: 'Muriqui-do-sul',
			source: 'https://doi.org/10.37002/salve.ficha.30197.2'
		},
		scientificName: {
			text: 'Brachyteles arachnoides',
			source: 'https://doi.org/10.37002/salve.ficha.30197.2'
		},
		habitat: {
			text: 'Florestas da Mata Atlântica, em morros e serras.',
			source: 'https://doi.org/10.37002/salve.ficha.30197.2'
		},
		diet: {
			text: 'Folhas, frutos e flores.',
			source: 'https://doi.org/10.37002/salve.ficha.30197.2'
		},
		status: {
			text: 'Em perigo',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026). No mundo (IUCN): Criticamente em perigo.'
		},
		fact: {
			text: 'Sua cauda é mais comprida que o corpo e consegue se agarrar aos galhos.',
			source: 'https://doi.org/10.37002/salve.ficha.30197.2'
		},
		zones: ['vale', 'copa'],
		times: ['day'],
		rarity: 'lendario',
		art: 'primate',
		color: '#988367',
		accent: '#d9ccb0',
		reviewNote:
			'Táxon confirmado em 26/10/2026: Brachyteles arachnoides (muriqui-do-sul) é o muriqui da Serra do Mar e da Mantiqueira (RJ, SP e nordeste do PR), segundo a ficha do ICMBio; no cenário do parque, o PARNA da Serra dos Órgãos tem uma das maiores subpopulações conhecidas, e há outra no PE dos Três Picos (programa de manejo do ICMBio, 2025); B. hypoxanthus (muriqui-do-norte, CR) vive em MG, ES e BA. IUCN: Criticamente em perigo (2021), https://www.iucnredlist.org/species/2993/191692658'
	},
	{
		id: 'bugio-ruivo',
		aliases: ['bugio'],
		name: {
			text: 'Bugio-ruivo',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/programa-de-manejo-populacional/pmp-do-bugio-ruivo/ficha-alouatta-guariba.pdf'
		},
		scientificName: {
			text: 'Alouatta guariba',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/programa-de-manejo-populacional/pmp-do-bugio-ruivo/ficha-alouatta-guariba.pdf'
		},
		habitat: {
			text: 'Florestas da Mata Atlântica.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/programa-de-manejo-populacional/pmp-do-bugio-ruivo/ficha-alouatta-guariba.pdf'
		},
		diet: {
			text: 'Principalmente folhas, além de frutos e flores.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/programa-de-manejo-populacional/pmp-do-bugio-ruivo/ficha-alouatta-guariba.pdf'
		},
		status: {
			text: 'Em perigo',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026). No mundo (IUCN): Vulnerável.'
		},
		fact: {
			text: 'Seu chamado pode ser ouvido de longe pela floresta.',
			source: 'https://www.gov.br/icmbio/pt-br/centrais-de-conteudo/fichasanimaisrebio-3-pdf'
		},
		zones: ['reserva', 'vale', 'copa'],
		times: ['day', 'dusk'],
		rarity: 'incomum',
		art: 'primate',
		color: '#8d5037',
		accent: '#cc9971',
		reviewNote:
			'Táxon revisto em 26/10/2026: o nome mostrado passou a ser Alouatta guariba. A Lista oficial de 2026 (Portaria MMA 1.704/2026) e a ficha do ICMBio avaliam a espécie inteira como Em perigo; A. g. clamitans, a forma do sul, aparece na ficha como nome antigo, e a separação em subespécies é considerada inconclusiva. IUCN: Vulnerável (2021), https://www.iucnredlist.org/species/39916/190417874'
	},
	{
		id: 'onca-pintada',
		aliases: ['onca'],
		name: {
			text: 'Onça-pintada',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/pan-grandes-felinos/pan-grandes-felinos'
		},
		scientificName: {
			text: 'Panthera onca',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/pan-grandes-felinos/pan-grandes-felinos'
		},
		habitat: {
			text: 'Florestas e outros ambientes naturais, longe das pessoas.',
			source: 'https://doi.org/10.37002/salve.ficha.14015.2'
		},
		diet: {
			text: 'Outros animais, como queixadas e capivaras.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/noticias/ultimas-noticias/icmbio-realiza-projeto-de-identificacao-visual-de-oncas-pintadas'
		},
		status: {
			text: 'Vulnerável',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026). No mundo (IUCN): Quase ameaçada.'
		},
		fact: {
			text: 'Cada onça tem um desenho próprio de manchas.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/noticias/ultimas-noticias/icmbio-realiza-projeto-de-identificacao-visual-de-oncas-pintadas'
		},
		zones: ['reserva', 'vale'],
		times: ['dusk', 'night'],
		rarity: 'lendario',
		art: 'cat',
		color: '#b99137',
		accent: '#3e4432'
	},
	{
		id: 'preguica-de-coleira',
		aliases: ['preguica'],
		name: {
			text: 'Preguiça-de-coleira',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/fichas_2019_2021/cingulata/dasypodidae/pilosa/bradypodidae/ficha-bradypus-torquatus.pdf'
		},
		scientificName: {
			text: 'Bradypus crinitus',
			source: 'https://doi.org/10.1093/jmammal/gyac059'
		},
		habitat: {
			text: 'Copas de árvores da Mata Atlântica.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/fichas_2019_2021/cingulata/dasypodidae/pilosa/bradypodidae/ficha-bradypus-torquatus.pdf'
		},
		diet: {
			text: 'Folhas de árvores, principalmente as mais novas.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/fichas_2019_2021/cingulata/dasypodidae/pilosa/bradypodidae/ficha-bradypus-torquatus.pdf'
		},
		status: {
			text: 'Vulnerável',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026), como Bradypus torquatus. No mundo (IUCN): Em perigo.'
		},
		fact: {
			text: 'Ela passa grande parte da vida nas árvores.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/fichas_2019_2021/cingulata/dasypodidae/pilosa/bradypodidae/ficha-bradypus-torquatus.pdf'
		},
		zones: ['reserva', 'vale', 'copa'],
		times: ['day'],
		rarity: 'raro',
		art: 'sloth',
		color: '#8e8972',
		accent: '#d9cdb1',
		reviewNote:
			'Táxon revisto em 26/10/2026: as preguiças-de-coleira do RJ e do ES são Bradypus crinitus (Miranda et al. 2023; lista SBMz 2025; IUCN 2025); B. torquatus ficou restrita à BA e a SE. A Lista oficial de 2026 ainda usa B. torquatus (VU) no sentido antigo, por isso o status vem dela. No RJ, a espécie vive no centro-norte do estado (Macaé, Silva Jardim, Nova Friburgo, Teresópolis, segundo a ficha do ICMBio), justamente o cenário do parque; não há registro no litoral sul. Se a equipe preferir o nome da lista oficial, a alternativa é Bradypus torquatus. IUCN: Em perigo (2025), https://www.iucnredlist.org/species/237133936/237141184'
	},
	{
		id: 'tucano-de-bico-verde',
		aliases: ['tucano'],
		name: {
			text: 'Tucano-de-bico-verde',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		scientificName: {
			text: 'Ramphastos dicolorus',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		habitat: {
			text: 'Florestas da baixada e da serra, inclusive matas em regeneração.',
			source: 'https://doi.org/10.37002/salve.ficha.19652'
		},
		diet: {
			text: 'Frutos e pequenos animais.',
			source: 'https://doi.org/10.37002/salve.ficha.19652'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.19652',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Ao comer frutos, ele pode levar sementes para outros lugares.',
			source: 'https://periodicos.ufjf.br/index.php/zoociencias/article/download/24681/13849'
		},
		zones: ['reserva', 'copa'],
		times: ['dawn', 'day'],
		rarity: 'incomum',
		art: 'bird',
		color: '#294d3d',
		accent: '#d5ce53'
	},
	{
		id: 'capivara',
		aliases: [],
		name: {
			text: 'Capivara',
			source:
				'https://biodiversidade.unespar.edu.br/colecoes/zoologica/mammalia/capivara-hydrochoerus-hydrochaeris'
		},
		scientificName: {
			text: 'Hydrochoerus hydrochaeris',
			source: 'https://doi.org/10.37002/salve.ficha.23318.2'
		},
		habitat: {
			text: 'Margens de rios, lagoas e áreas alagadas.',
			source: 'https://doi.org/10.37002/salve.ficha.23318.2'
		},
		diet: {
			text: 'Capins e plantas aquáticas.',
			source: 'https://doi.org/10.37002/salve.ficha.23318.2'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.23318.2',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Ela vive perto da água e tem membranas entre os dedos que ajudam a nadar.',
			source:
				'https://biodiversidade.unespar.edu.br/colecoes/zoologica/mammalia/capivara-hydrochoerus-hydrochaeris'
		},
		zones: ['manguezal', 'reserva'],
		times: ['day', 'dusk'],
		rarity: 'comum',
		art: 'rodent',
		color: '#aa8058',
		accent: '#d8ba83'
	},
	{
		id: 'anta',
		aliases: [],
		name: {
			text: 'Anta',
			source: 'https://revistaeletronica.icmbio.gov.br/BioBR/article/download/243/144/895'
		},
		scientificName: {
			text: 'Tapirus terrestris',
			source: 'https://revistaeletronica.icmbio.gov.br/BioBR/article/download/243/144/895'
		},
		habitat: {
			text: 'Florestas, margens de rios e áreas úmidas.',
			source: 'https://revistaeletronica.icmbio.gov.br/BioBR/article/download/243/144/895'
		},
		diet: {
			text: 'Principalmente folhas, mas também frutos.',
			source: 'https://revistaeletronica.icmbio.gov.br/BioBR/article/download/243/144/895'
		},
		status: {
			text: 'Vulnerável',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026). No mundo (IUCN): Vulnerável.'
		},
		fact: {
			text: 'Seu focinho comprido e flexível ajuda a pegar brotos e galhos.',
			source: 'https://sites.ohio.edu/witmerl/Downloads/1999_Witmer_et_al_tapir_nose.pdf'
		},
		zones: ['vale'],
		times: ['dusk', 'night'],
		rarity: 'raro',
		art: 'ungulate',
		color: '#727365',
		accent: '#d4cbb3'
	},
	{
		id: 'cateto',
		aliases: [],
		name: {
			text: 'Cateto',
			source: 'https://revistaeletronica.icmbio.gov.br/BioBR/article/download/241/146/897'
		},
		scientificName: {
			text: 'Dicotyles tajacu',
			source: 'https://www.mammaldiversity.org/taxon/1006380/'
		},
		habitat: {
			text: 'Florestas, cerrados e outros ambientes.',
			source: 'https://doi.org/10.37002/salve.ficha.9807.2'
		},
		diet: {
			text: 'Principalmente frutos, mas também folhas e raízes.',
			source: 'https://doi.org/10.37002/salve.ficha.9807.2'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.9807.2',
			scope: 'Avaliação do ICMBio, como Pecari tajacu. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Os catetos vivem em bandos e costumam andar em fila, um atrás do outro.',
			source: 'https://doi.org/10.37002/salve.ficha.9807.2'
		},
		zones: ['copa', 'vale'],
		times: ['day', 'dusk'],
		rarity: 'incomum',
		art: 'ungulate',
		color: '#6f6d5a',
		accent: '#d6ceae',
		reviewNote:
			'Nomenclatura revista em 26/10/2026: o cateto passou a Dicotyles tajacu (Acosta et al. 2020), nome usado pela lista SBMz 2025 e pelo Mammal Diversity Database; não é uma espécie nova. O ICMBio (2019) e a IUCN (2011) ainda o avaliam como Pecari tajacu. IUCN: Menos preocupante (2011), https://www.iucnredlist.org/species/41777/10562361'
	},
	{
		id: 'veado-mateiro',
		aliases: [],
		name: {
			text: 'Veado-mateiro',
			source: 'https://doi.org/10.5281/zenodo.18378485'
		},
		scientificName: {
			text: 'Mazama rufa',
			source: 'https://doi.org/10.3389/fgene.2021.742870'
		},
		habitat: {
			text: 'Florestas com vegetação fechada, muitas vezes perto da água.',
			source: 'https://doi.org/10.37002/salve.ficha.9015'
		},
		diet: {
			text: 'Frutos, sementes, flores, brotos e folhas.',
			source: 'https://doi.org/10.37002/salve.ficha.9015'
		},
		status: {
			text: 'Dados insuficientes',
			source: 'https://doi.org/10.37002/salve.ficha.9015',
			scope: 'Avaliação do ICMBio, como Mazama americana. No mundo (IUCN): Dados insuficientes.'
		},
		fact: {
			text: 'O veado-mateiro é um bom nadador.',
			source:
				'https://www.ufrgs.br/faunadigitalrs/mamiferos/ordem-cetartiodactyla/familia-cervidae/veado-mateiro-mazama-americana/'
		},
		zones: ['vale', 'copa'],
		times: ['dawn', 'dusk'],
		rarity: 'raro',
		art: 'ungulate',
		color: '#ac7550',
		accent: '#e1bd91',
		reviewNote:
			'Táxon revisto em 26/10/2026: segundo a ficha do ICMBio, nenhuma população brasileira é Mazama americana no sentido estrito (neótipo da Guiana Francesa). O veado-mateiro do sul e do sudeste é Mazama rufa (Peres et al. 2021; lista SBMz 2025: SP, PR, SC, RS). Mazama jucunda é outra espécie, o veado-mateiro-pequeno da Serra do Mar. As populações do litoral ainda não foram confirmadas por DNA. O status nacional e o da IUCN (Dados insuficientes, 2016, https://www.iucnredlist.org/species/29619/22154827) são do complexo M. americana. No cenário do parque (centro-norte do RJ) o nome segue incerto: a lista SBMz 2025 não registra M. rufa no RJ, e o ICMBio restringe M. jucunda a SP, PR e SC, embora a SBMz a liste também no RJ.'
	},
	{
		id: 'cachorro-do-mato',
		aliases: [],
		name: {
			text: 'Cachorro-do-mato',
			source: 'https://doi.org/10.37002/salve.ficha.13996.2'
		},
		scientificName: {
			text: 'Cerdocyon thous',
			source: 'https://doi.org/10.37002/salve.ficha.13996.2'
		},
		habitat: {
			text: 'Bordas de mata, áreas abertas e restingas.',
			source: 'https://doi.org/10.37002/salve.ficha.13996.2'
		},
		diet: {
			text: 'Frutos, insetos e pequenos animais.',
			source: 'https://doi.org/10.37002/salve.ficha.13996.2'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.13996.2',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Ele pode comer tanto frutos quanto pequenos animais.',
			source: 'https://doi.org/10.37002/salve.ficha.13996.2'
		},
		zones: ['reserva', 'praia'],
		times: ['dusk', 'night'],
		rarity: 'incomum',
		art: 'canid',
		color: '#828577',
		accent: '#d9d4b6'
	},
	{
		id: 'onca-parda',
		aliases: [],
		name: {
			text: 'Onça-parda',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/pan-grandes-felinos/pan-grandes-felinos'
		},
		scientificName: {
			text: 'Puma concolor',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/pan-grandes-felinos/pan-grandes-felinos'
		},
		habitat: {
			text: 'Florestas, campos e serras.',
			source: 'https://doi.org/10.37002/salve.ficha.14019.2'
		},
		diet: {
			text: 'Outros animais, como tatus e catetos.',
			source: 'https://www.scielo.br/j/rbzool/a/NZWMdgbc53qVVssvLvqjwkm/'
		},
		status: {
			text: 'Quase ameaçada',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/pan-grandes-felinos/pan-grandes-felinos',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Os filhotes têm manchas que desaparecem ao crescer.',
			source: 'https://www.nps.gov/brca/learn/nature/mountainlion.htm'
		},
		zones: ['copa', 'vale'],
		times: ['dusk', 'night'],
		rarity: 'lendario',
		art: 'cat',
		color: '#b09161',
		accent: '#dbbf8b'
	},
	{
		id: 'tapiti',
		aliases: [],
		name: {
			text: 'Tapiti',
			source: 'https://doi.org/10.46357/bcnaturais.v17i3.883'
		},
		scientificName: {
			text: 'Sylvilagus tapetillus',
			source: 'https://doi.org/10.37002/salve.ficha.35366.1'
		},
		habitat: {
			text: 'Morros com capim e ervas, perto de riachos; também usa matas.',
			source: 'https://doi.org/10.37002/salve.ficha.35366.1'
		},
		diet: {
			text: 'Folhas, talos e raízes de plantas.',
			source: 'https://doi.org/10.46357/bcnaturais.v17i3.883'
		},
		status: {
			text: 'Quase ameaçada',
			source: 'https://doi.org/10.37002/salve.ficha.35366.1',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Vulnerável.'
		},
		fact: {
			text: 'Os tapitis são os únicos coelhos nativos do Brasil.',
			source: 'https://doi.org/10.46357/bcnaturais.v17i3.883'
		},
		zones: ['reserva', 'praia'],
		times: ['dusk', 'night'],
		rarity: 'incomum',
		art: 'rabbit',
		color: '#9a8770',
		accent: '#d4c3a1',
		reviewNote:
			'Táxon revisto em 26/10/2026 para o cenário no RJ: a ficha do ICMBio de Sylvilagus minensis exclui o Rio de Janeiro, e a de Sylvilagus tapetillus (Quase ameaçada, 06/04/2022) dá a espécie como endêmica do RJ, com registros no PARNA da Serra da Bocaina e no PARNA da Serra dos Órgãos. S. brasiliensis agora designa só os tapitis do Nordeste. O hábitat e a dieta de S. tapetillus ainda são pouco conhecidos; a dieta vem de um texto sobre os tapitis em geral. IUCN: Vulnerável (2019), https://www.iucnredlist.org/species/142542759/165117046'
	},
	{
		id: 'jaguatirica',
		aliases: [],
		name: {
			text: 'Jaguatirica',
			source: 'https://doi.org/10.37002/salve.ficha.14007.2'
		},
		scientificName: {
			text: 'Leopardus pardalis',
			source: 'https://doi.org/10.37002/salve.ficha.14007.2'
		},
		habitat: {
			text: 'Florestas, restingas e outras áreas de vegetação fechada.',
			source: 'https://doi.org/10.37002/salve.ficha.14007.2'
		},
		diet: {
			text: 'Pequenos mamíferos e outros animais.',
			source: 'https://doi.org/10.37002/salve.ficha.14007.2'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.14007.2',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'As manchas ajudam a esconder seu corpo na vegetação.',
			source: 'https://lazoo.org/explore-your-zoo/our-animals/mammals/ocelot/'
		},
		zones: ['vale', 'copa'],
		times: ['night'],
		rarity: 'raro',
		art: 'cat',
		color: '#b49755',
		accent: '#464a36'
	},
	{
		id: 'caranguejo-uca',
		aliases: ['caranguejo'],
		name: {
			text: 'Caranguejo-uçá',
			source: 'https://doi.org/10.37002/salve.ficha.21300.2'
		},
		scientificName: {
			text: 'Ucides cordatus',
			source: 'https://doi.org/10.37002/salve.ficha.21300.2'
		},
		habitat: {
			text: 'Chão dos manguezais, onde a maré sobe e desce.',
			source:
				'https://crustacea.org.br/wp-content/uploads/2020/12/livro-vermelho-cap33-avaliacao-do-caranguejo-uca.pdf'
		},
		diet: {
			text: 'Principalmente folhas das árvores do mangue.',
			source: 'https://doi.org/10.37002/salve.ficha.21300.2'
		},
		status: {
			text: 'Quase ameaçada',
			source: 'https://doi.org/10.37002/salve.ficha.21300.2',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Não avaliada.'
		},
		fact: {
			text: 'Ele cava tocas no manguezal que podem ter até 2 metros de profundidade.',
			source:
				'https://crustacea.org.br/wp-content/uploads/2020/12/livro-vermelho-cap33-avaliacao-do-caranguejo-uca.pdf'
		},
		zones: ['manguezal'],
		times: ['day'],
		rarity: 'comum',
		art: 'crab',
		color: '#9a593f',
		accent: '#d99d6d'
	},
	{
		id: 'tatu-galinha',
		aliases: ['tatu'],
		name: {
			text: 'Tatu-galinha',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/cingulata/ficha_dasypus_novemcintus.pdf'
		},
		scientificName: {
			text: 'Dasypus novemcinctus',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/cingulata/ficha_dasypus_novemcintus.pdf'
		},
		habitat: {
			text: 'Florestas, pastagens e até plantações.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/cingulata/ficha_dasypus_novemcintus.pdf'
		},
		diet: {
			text: 'Principalmente pequenos invertebrados, como besouros, formigas e cupins.',
			source: 'https://doi.org/10.31533/pubvet.v13n5a329.1-11'
		},
		status: {
			text: 'Menos preocupante',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/cingulata/ficha_dasypus_novemcintus.pdf',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Sua carapaça tem placas e, em geral, nove faixas móveis.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/primatas-brasileiros/arquivos/fichas_xenathra/cingulata/ficha_dasypus_novemcintus.pdf'
		},
		zones: ['reserva', 'vale'],
		times: ['dusk', 'night'],
		rarity: 'incomum',
		art: 'armadillo',
		color: '#8b8877',
		accent: '#c2bca1'
	},
	{
		id: 'jabuti-tinga',
		aliases: ['jabuti', 'jabuti-piranga'],
		name: {
			text: 'Jabuti-tinga',
			source: 'https://doi.org/10.37002/salve.ficha.20811.3'
		},
		scientificName: {
			text: 'Chelonoidis denticulatus',
			source: 'https://doi.org/10.37002/salve.ficha.20811.3'
		},
		habitat: {
			text: 'Dentro das florestas; quase nunca aparece em áreas abertas.',
			source: 'https://doi.org/10.37002/salve.ficha.20811.3'
		},
		diet: {
			text: 'Principalmente frutos, mas também folhas, flores e fungos.',
			source: 'https://doi.org/10.37002/salve.ficha.20811.3'
		},
		status: {
			text: 'Em perigo',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026). No mundo (IUCN): Vulnerável.'
		},
		fact: {
			text: 'Comendo frutos, ele espalha sementes de pelo menos 70 tipos de plantas.',
			source: 'https://doi.org/10.37002/salve.ficha.20811.3'
		},
		zones: ['copa', 'reserva'],
		times: ['day'],
		rarity: 'incomum',
		art: 'tortoise',
		color: '#2e2925',
		accent: '#e0a63a',
		reviewNote:
			'Trocado em 26/10/2026, a pedido da coordenação: o jabuti-piranga (Chelonoidis carbonarius, de áreas abertas) deu lugar ao jabuti-tinga (Chelonoidis denticulatus), espécie de floresta; jabuti-piranga ficou como alias para manter as descobertas já salvas. Status: Em perigo na Lista oficial de 2026 (entrada nova; ficha do ICMBio de 19/09/2024). A ficha registra a espécie na Mata Atlântica da BA, do ES e do RJ (inclusive na Serra dos Órgãos) e diz que as populações originais possivelmente desapareceram da maioria dos fragmentos. IUCN: Vulnerável (avaliação antiga, de 1996), https://www.iucnredlist.org/species/9008/12949796'
	},
	{
		id: 'sapo-cururu',
		aliases: ['sapo'],
		name: {
			text: 'Sapo-cururu',
			source: 'https://www.ufrgs.br/faunadigitalrs/sapo-cururu-rhinella-icterica/'
		},
		scientificName: {
			text: 'Rhinella icterica',
			source: 'https://doi.org/10.5281/zenodo.4716176'
		},
		habitat: {
			text: 'Matas, áreas abertas e locais próximos de água.',
			source: 'https://doi.org/10.37002/salve.ficha.17575.2'
		},
		diet: {
			text: 'Insetos e outros pequenos animais.',
			source: 'https://www.ufrgs.br/faunadigitalrs/sapo-cururu-rhinella-icterica/'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.17575.2',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Na época de reprodução, os machos vocalizam perto da água.',
			source: 'https://doi.org/10.37002/salve.ficha.17575.2'
		},
		zones: ['vale', 'manguezal'],
		times: ['dusk', 'night'],
		rarity: 'comum',
		art: 'frog',
		color: '#7e865a',
		accent: '#bfc47e',
		reviewNote:
			'Táxon confirmado em 26/10/2026: Rhinella icterica é o sapo-cururu da Mata Atlântica do sul e do sudeste, com registros na Serra do Mar (Serra dos Órgãos, Curucutu, Guaraqueçaba); R. diptycha é o cururu das áreas abertas e do Cerrado. Status nacional: LC (Menos Preocupante) no Livro Vermelho 2018 (avaliação de 2012); conferir no navegador o cabeçalho da ficha atual do SALVE. IUCN: Menos preocupante (2023), https://www.iucnredlist.org/species/54668/101423310'
	},
	{
		id: 'saira-sete-cores',
		aliases: ['saira'],
		name: {
			text: 'Saíra-sete-cores',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		scientificName: {
			text: 'Tangara seledon',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		habitat: {
			text: 'Copa e bordas das florestas úmidas da Mata Atlântica.',
			source: 'https://doi.org/10.37002/salve.ficha.24760'
		},
		diet: {
			text: 'Frutos e pequenos artrópodes, como insetos.',
			source: 'https://doi.org/10.37002/salve.ficha.24760'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.24760',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Suas penas misturam azul-turquesa, verde-limão, laranja e preto.',
			source: 'https://ebird.org/species/grhtan2?siteLanguage=pt_BR'
		},
		zones: ['reserva', 'copa'],
		times: ['dawn', 'day'],
		rarity: 'raro',
		art: 'bird',
		color: '#3c8d83',
		accent: '#cbd268'
	},
	{
		id: 'sabia-laranjeira',
		aliases: ['sabia'],
		name: {
			text: 'Sabiá-laranjeira',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		scientificName: {
			text: 'Turdus rufiventris',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		habitat: {
			text: 'Matas, jardins e áreas arborizadas.',
			source: 'https://doi.org/10.37002/salve.ficha.11690.2'
		},
		diet: {
			text: 'Frutos e pequenos animais, como minhocas.',
			source: 'https://prefeitura.sp.gov.br/web/meio_ambiente/w/servicos/fauna/especies_da_cidade/13230'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.11690.2',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'O ventre alaranjado ajuda a reconhecer esse sabiá.',
			source: 'https://prefeitura.sp.gov.br/web/meio_ambiente/w/servicos/fauna/especies_da_cidade/13230'
		},
		zones: ['reserva', 'praia'],
		times: ['dawn', 'day'],
		rarity: 'comum',
		art: 'bird',
		color: '#8d8166',
		accent: '#d5914f'
	},
	{
		id: 'jacutinga',
		aliases: [],
		name: {
			text: 'Jacutinga',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		scientificName: {
			text: 'Aburria jacutinga',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		habitat: {
			text: 'Florestas da Mata Atlântica, principalmente onde há palmito-juçara.',
			source: 'https://doi.org/10.37002/salve.ficha.24266'
		},
		diet: {
			text: 'Principalmente frutos, como os do palmito-juçara, e também sementes e brotos.',
			source: 'https://doi.org/10.37002/salve.ficha.24266'
		},
		status: {
			text: 'Em perigo',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/saiba-mais/documentos-e-downloads/10-portaria-mma-no-1-704-de-16-de-junho-de-2026.pdf',
			scope: 'Lista oficial do Brasil (MMA, 2026). No mundo (IUCN): Em perigo.'
		},
		fact: {
			text: 'Ela engole frutos e depois solta as sementes, ajudando a espalhar plantas pela floresta.',
			source: 'https://doi.org/10.37002/salve.ficha.24266'
		},
		zones: ['reserva', 'vale'],
		times: ['dawn', 'day'],
		rarity: 'lendario',
		art: 'bird',
		color: '#22252e',
		accent: '#dcdad2'
	},
	{
		id: 'colhereiro',
		aliases: ['guara'],
		name: {
			text: 'Colhereiro',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		scientificName: {
			text: 'Platalea ajaja',
			source: 'https://zenodo.org/records/5138368/files/lista%20de%20aves%20do%20brasil%20%28zenodo%29.pdf'
		},
		habitat: {
			text: 'Manguezais, pântanos e outras áreas alagadas, no litoral e no interior.',
			source: 'https://doi.org/10.37002/salve.ficha.28738'
		},
		diet: {
			text: 'Pequenos peixes, crustáceos, insetos e moluscos.',
			source: 'https://doi.org/10.37002/salve.ficha.28738'
		},
		status: {
			text: 'Menos preocupante',
			source: 'https://doi.org/10.37002/salve.ficha.28738',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'Ele anda na água rasa balançando o bico de um lado para o outro e fecha o bico quando toca num bichinho.',
			source: 'https://repositorio.furg.br/bitstreams/f9f64664-b357-4ded-b854-69fe2daf41f2/download'
		},
		zones: ['manguezal'],
		times: ['dusk'],
		rarity: 'incomum',
		art: 'bird',
		color: '#e7a3b5',
		accent: '#c8424a'
	},
	{
		id: 'tartaruga-verde',
		aliases: ['tartaruga'],
		name: {
			text: 'Tartaruga-verde',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/tartarugas-marinhas-e-biodiversidade-marinha-do-leste/Arquivos%20do%20Site/pdfs/copy2_of_avaliacaochelonia.pdf'
		},
		scientificName: {
			text: 'Chelonia mydas',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/tartarugas-marinhas-e-biodiversidade-marinha-do-leste/Arquivos%20do%20Site/pdfs/copy2_of_avaliacaochelonia.pdf'
		},
		habitat: {
			text: 'Águas costeiras com algas; no Brasil, desova mais em ilhas oceânicas.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/tartarugas-marinhas-e-biodiversidade-marinha-do-leste/Arquivos%20do%20Site/pdfs/copy2_of_avaliacaochelonia.pdf'
		},
		diet: {
			text: 'Quando maiores, principalmente algas e plantas marinhas.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/tartarugas-marinhas-e-biodiversidade-marinha-do-leste/Arquivos%20do%20Site/pdfs/copy2_of_avaliacaochelonia.pdf'
		},
		status: {
			text: 'Quase ameaçada',
			source: 'https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/pan/pan-tartarugas-marinhas',
			scope: 'Avaliação do ICMBio. No mundo (IUCN): Menos preocupante.'
		},
		fact: {
			text: 'As fêmeas podem voltar à região onde nasceram para fazer seus ninhos.',
			source:
				'https://www.gov.br/icmbio/pt-br/assuntos/centros-de-pesquisa/tartarugas-marinhas-e-biodiversidade-marinha-do-leste/Arquivos%20do%20Site/pdfs/copy2_of_avaliacaochelonia.pdf'
		},
		zones: ['praia'],
		times: ['day'],
		rarity: 'raro',
		art: 'turtle',
		color: '#648576',
		accent: '#a9b68b'
	}
];
