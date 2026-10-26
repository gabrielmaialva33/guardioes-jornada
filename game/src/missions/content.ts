/** Adapted from conteudo-jogo.md §§2/4 with LEVEL.md safety corrections: no confrontation, fire or touching traps. */
export const TEXT = {
	intro: [
		'Que bom que você chegou! Eu sou a Iara, guarda-parque desta reserva da Mata Atlântica.',
		'A Mata Atlântica já cobriu grande parte do Brasil. Hoje restam só cerca de 12% das florestas maduras originais, divididas em pedaços separados.',
		'Vamos reconectar a mata com sementes e mudas, observar o corte ilegal de longe e sinalizar armadilhas para a fiscalização.',
		'Siga a seta amarela nos seus pés. Comece pelo corredor e, depois das outras missões, suba ao mirante!'
	],
	fruit:
		'Sementes de juçara! Parente do açaí, essa palmeira alimenta tucanos, jacutingas e muitos animais da mata. Vamos plantá-las no corredor ecológico!',
	corridor: [
		'Você semeou as juçaras no corredor ecológico que liga os dois pedaços de floresta!',
		'Nunca alimente animais silvestres na mão. Plantar corredores florestais é o melhor jeito de ajudá-los!'
	],
	logger:
		'De trás da pedra da trilha, você avista uma pessoa tentando cortar um jequitibá centenário sem autorização. O que quem protege a floresta deve fazer?',
	loggerChoices: [
		{ id: 'report-logger', label: 'Manter distância segura e avisar a guarda-parque Iara pelo rádio' },
		{ id: 'confront', label: 'Ir lá sozinho tentar impedir a pessoa' },
		{ id: 'ignore', label: 'Deixar pra lá, é só uma árvore' }
	],
	loggerSafe:
		'Boa decisão! Você não se aproximou do perigo e chamou a Iara pelo rádio. A equipe de fiscalização impediu o corte e salvou o jequitibá!',
	loggerUnsafe:
		'Muito perigoso! Crianças nunca devem se aproximar nem enfrentar quem comete um crime ambiental. Afaste-se e chame uma pessoa adulta e a fiscalização. Tente de novo.',
	loggerIgnore:
		'Um jequitibá-rosa leva centenas de anos para crescer e abriga dezenas de espécies. Podemos protegê-lo com segurança avisando a guarda-parque! Tente de novo.',
	loggerWarning:
		'Iara pelo rádio: mantenha distância. Volte para trás da pedra de observação; eu cuido de chamar a fiscalização.',
	trap: 'Armadilha sinalizada para a fiscalização! Caçar ou prender animais silvestres é crime no Brasil (Lei nº 9.605/1998, art. 29). Na vida real, nunca toque numa armadilha: afaste-se e avise uma pessoa adulta ou a guarda-parque.',
	closing: [
		'Parabéns! Você protegeu a Trilha Secreta!',
		'Você ajudou a reconectar a mata, restaurou a clareira e chamou a fiscalização com segurança.',
		'Na vida real: traga sempre seu lixo de volta, nunca faça fogueiras nem alimente animais silvestres e apoie a restauração da Mata Atlântica.'
	]
};
export interface Dialogue {
	id: string;
	speaker: string;
	lines: readonly string[];
	choices?: readonly { id: string; label: string }[];
	finished?: boolean;
}
