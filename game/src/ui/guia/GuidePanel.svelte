<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type { GuideService } from '../../guia/persistence.ts';
	import { type DayTime, RARITIES, type SpeciesEntry, TIMES, type Zone, ZONES } from '../../guia/types.ts';
	import SpeciesArt from './SpeciesArt.svelte';
	let {
		service,
		onclose,
		initialEntry = '',
		reducedMotion = false
	}: {
		service: GuideService;
		onclose: () => void;
		initialEntry?: string;
		reducedMotion?: boolean;
	} = $props();
	let revision = $state(0),
		zone = $state<Zone | ''>(''),
		time = $state<DayTime | ''>(''),
		selected = $state(untrack(() => initialEntry));
	let dialog: HTMLDialogElement;
	let detailHeading = $state<HTMLHeadingElement>();
	let photoUrl = $state('');
	let photoLoading = $state(false);
	let list: HTMLDivElement;
	const registry = $derived(service.book.registry);
	const entries = $derived(registry.filter({ zone: zone || undefined, time: time || undefined }));
	const entry = $derived(registry.find(selected));
	const known = $derived.by(() => {
		revision;
		return !!entry && service.book.has(entry.id);
	});
	const count = $derived.by(() => {
		revision;
		return service.book.count;
	});
	const issue = $derived.by(() => {
		revision;
		return service.issue;
	});
	const position = $derived(entry ? registry.entries.indexOf(entry) + 1 : 0);
	$effect(() =>
		service.subscribe(() => {
			revision++;
		})
	);
	$effect(() => {
		revision;
		const id = entry?.id;
		if (!id || !known) {
			photoUrl = '';
			return;
		}
		let cancelled = false,
			url = '';
		photoUrl = '';
		photoLoading = true;
		void service.thumbnail(id).then((blob) => {
			if (cancelled) return;
			if (blob) {
				url = URL.createObjectURL(blob);
				photoUrl = url;
			}
			photoLoading = false;
		});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	});
	onMount(() => {
		const before = document.activeElement;
		dialog.showModal();
		return () => {
			dialog.close();
			if (before instanceof HTMLElement && before.isConnected) before.focus();
		};
	});
	async function choose(species: SpeciesEntry) {
		selected = species.id;
		await tick();
		detailHeading?.focus();
	}
	async function back() {
		const previous = selected;
		selected = '';
		await tick();
		list?.querySelector<HTMLButtonElement>(`[data-species="${previous}"]`)?.focus();
	}
	function sources(s: SpeciesEntry) {
		return [
			{ label: 'Nome', value: s.name },
			{ label: 'Nome científico', value: s.scientificName },
			{ label: 'Habitat', value: s.habitat },
			{ label: 'Alimentação', value: s.diet },
			{ label: 'Conservação', value: s.status },
			{ label: 'Curiosidade', value: s.fact }
		];
	}
</script>

<dialog
	bind:this={dialog}
	class="notebook"
	class:reduced={reducedMotion}
	class:reading={!!entry}
	aria-labelledby="guide-title"
	oncancel={(event) => {
		event.preventDefault();
		onclose();
	}}
	onkeydown={(event) => event.stopPropagation()}
	onpointerdown={(event) => event.stopPropagation()}
>
	<header class="cover">
		<div class="brand">
			<span class="leaf-mark" aria-hidden="true">❧</span>
			<div>
				<p class="eyebrow">CADERNO DE CAMPO</p>
				<h1 id="guide-title">Guia da Mata</h1>
				<p class="intro">Cada encontro, uma nova descoberta.</p>
			</div>
		</div>
		<div class="count-stamp" aria-label={`${count} de ${service.book.total} espécies descobertas`}>
			<strong>{count}<span>/{service.book.total}</span></strong><small>descobertas</small>
		</div>
		<button class="close icon-button" type="button" aria-label="Fechar Guia da Mata" onclick={onclose}
			><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button
		>
	</header>
	<div
		class="progress"
		role="progressbar"
		aria-label="Espécies descobertas"
		aria-valuemin="0"
		aria-valuemax={service.book.total}
		aria-valuenow={count}
	>
		<span style:width={`${service.book.total ? (count / service.book.total) * 100 : 0}%`}></span>
	</div>
	<div class="pages">
		<section class="collection" aria-label="Coleção de espécies">
			<div class="filters">
				<label
					>Lugar<select aria-label="Filtrar por lugar" bind:value={zone}
						><option value="">Todos os lugares</option>{#each Object.entries(ZONES) as [id, label]}<option
								value={id}>{label}</option
							>{/each}</select
					></label
				><label
					>Horário no jogo<select aria-label="Filtrar por horário" bind:value={time}
						><option value="">Qualquer horário</option>{#each Object.entries(TIMES) as [id, label]}<option
								value={id}>{label}</option
							>{/each}</select
					></label
				>
			</div>
			<div class="collection-heading">
				<h2>Encontros na trilha</h2>
				<span aria-live="polite"
					>{entries.length}
					{entries.length === 1 ? 'espécie' : 'espécies'}</span
				>
			</div>
			<div class="cards-scroll" bind:this={list}>
				<div class="cards">
					{#each entries as species (species.id)}
						{@const discovered = revision >= 0 && service.book.has(species.id)}
						{@const number = registry.entries.indexOf(species) + 1}
						<button
							type="button"
							class="species-card"
							class:undiscovered={!discovered}
							class:active={selected === species.id}
							data-species={species.id}
							aria-label={discovered
								? `Abrir ficha: ${species.name.text}`
								: `Abrir entrada desconhecida ${number}`}
							aria-current={selected === species.id ? 'true' : undefined}
							onclick={() => choose(species)}
						>
							<span class="card-number">{String(number).padStart(2, '0')}</span>
							<div class="art">
								<SpeciesArt {species} unknown={!discovered} />
							</div>
							<span class="card-name">{discovered ? species.name.text : 'A descobrir'}</span><span
								class="rarity"
								class:legendary={species.rarity === 'lendario'}>{RARITIES[species.rarity]}</span
							>
							{#if discovered}<span class="recorded-mark" aria-label="Descoberta registrada">✓</span
								>{:else}<span class="unknown-mark" aria-hidden="true">?</span>{/if}
						</button>
					{/each}
				</div>
				{#if entries.length === 0}<div class="empty">
						<span aria-hidden="true">❧</span>
						<h3>Uma trilha diferente?</h3>
						<p>Nenhuma espécie deste caderno combina com esses dois filtros.</p>
						<button
							type="button"
							onclick={() => {
								zone = '';
								time = '';
							}}>Limpar filtros</button
						>
					</div>{/if}
			</div>
			<p class="collection-note">
				<span aria-hidden="true">✧</span> Observe com cuidado. Deixe os animais livres.
			</p>
		</section>
		<section class="entry-page" aria-label="Página da espécie">
			{#if entry}
				<div class="page-toolbar">
					<button type="button" class="back" onclick={back}><span aria-hidden="true">←</span> Coleção</button
					><span>FICHA {String(position).padStart(2, '0')}</span><span
						class="rarity"
						class:legendary={entry.rarity === 'lendario'}>{RARITIES[entry.rarity]}</span
					>
				</div>
				<article class="entry-scroll">
					<div class="entry-art" class:photo={!!photoUrl}>
						{#if known && photoUrl}<figure>
								<img src={photoUrl} alt={`Seu registro de ${entry.name.text}`} />
								<figcaption>MEU ENCONTRO NA TRILHA</figcaption>
							</figure>{:else}<SpeciesArt species={entry} unknown={!known} />{/if}
						{#if known}<span class="discovery-stamp">DESCOBERTO<br /><small>na sua jornada</small></span>{/if}
					</div>
					<h2 class="entry-name" tabindex="-1" bind:this={detailHeading}>
						{known ? entry.name.text : 'Quem vive por aqui?'}
					</h2>
					{#if known}
						<p class="scientific"><i>{entry.scientificName.text}</i></p>
						<p class="photo-note">
							{photoLoading
								? 'Abrindo seu registro…'
								: photoUrl
									? 'Esta foto fica só neste dispositivo.'
									: 'Fotografe para guardar aqui o seu próprio registro.'}
						</p>
						<div class="field-pair">
							<section>
								<h3>Onde vive</h3>
								<p>{entry.habitat.text}</p>
							</section>
							<section>
								<h3>O que come</h3>
								<p>{entry.diet.text}</p>
							</section>
						</div>
						<aside class="fact">
							<span aria-hidden="true">✧</span>
							<div>
								<h3>Você sabia?</h3>
								<p>{entry.fact.text}</p>
							</div>
						</aside>
						<section class="conservation">
							<h3>Na natureza</h3>
							<p>
								<strong>{entry.status.text}</strong><span>{entry.status.scope}</span>
							</p>
						</section>
						<div class="encounters">
							<h3>Onde procurar no jogo</h3>
							<p>{entry.zones.map((z) => ZONES[z]).join(' · ')}</p>
							<p>{entry.times.map((t) => TIMES[t]).join(' · ')}</p>
						</div>
						<details class="sources">
							<summary>Fontes desta página</summary>
							<ul>
								{#each sources(entry) as source}<li>
										{source.label}: {#if source.value.source === 'TODO-SOURCE'}referência em revisão{:else}<a
												href={source.value.source}
												target="_blank"
												rel="noreferrer"
												>Consultar fonte<span class="sr-only"> de {source.label} (abre outra aba)</span> ↗</a
											>{/if}
									</li>{/each}
							</ul>
						</details>
					{:else}<p class="unknown-copy">Há uma nova história esperando por você.</p>
						<p class="unknown-help">
							Fotografe esta espécie ou conclua uma missão sobre ela para revelar sua página.
						</p>
						<span class="empty-stamp">AINDA POR DESCOBRIR</span>{/if}
				</article>
			{:else}
				<div class="blank-page">
					<span class="big-leaf" aria-hidden="true">❧</span>
					<p class="eyebrow">A MATA TEM MUITAS HISTÓRIAS</p>
					<h2>Qual será seu<br />próximo encontro?</h2>
					<p>Toque em uma ficha para abrir<br />uma página do seu caderno.</p>
					<div class="notebook-lines" aria-hidden="true"></div>
				</div>
			{/if}
		</section>
	</div>
	<footer>
		<span>RESERVA DA IARA · GUIA DE CAMPO</span><span
			>{known && entry ? 'Um encontro para lembrar.' : 'Conhecer também é cuidar.'}</span
		>
	</footer>
	{#if issue}<div class="save-notice" role="status">
			<p>
				Suas descobertas estão nesta sessão. {issue === 'thumbnail-failed'
					? 'Não foi possível guardar uma foto.'
					: 'Não foi possível salvar tudo neste dispositivo.'}
			</p>
			{#if service.writable}<button type="button" onclick={() => void service.retry()}
					>Tentar salvar de novo</button
				>{/if}
		</div>{/if}
</dialog>

<style>
	.notebook {
		--paper: #f5edda;
		--paper-light: #fbf6e9;
		--ink: #263f32;
		--muted: #626953;
		--rule: #c9c5ab;
		--forest: #315c45;
		--ochre: #8b6b29;
		box-sizing: border-box;
		width: min(1100px, calc(100vw - 48px));
		height: min(820px, calc(100dvh - 48px));
		max-width: none;
		max-height: none;
		padding: 0;
		border: 1px solid #eee2bf;
		border-radius: 18px 21px 17px 22px;
		background: var(--paper);
		color: var(--ink);
		font: 14px/1.45 var(--font-ui, 'Atkinson Hyperlegible Next Variable', system-ui);
		box-shadow:
			0 22px 90px #071b1690,
			0 0 0 5px #c5b286;
		overflow: hidden;
		touch-action: pan-y;
		user-select: text;
	}
	.notebook[open] {
		display: flex;
		flex-direction: column;
		animation: open-book 0.2s ease-out;
	}
	.notebook::backdrop {
		background: #0e2c24bd;
		backdrop-filter: blur(5px);
	}
	* {
		box-sizing: border-box;
	}
	button,
	select {
		font: inherit;
		color: inherit;
	}
	button {
		cursor: pointer;
		touch-action: manipulation;
		min-height: 44px;
	}
	button:focus-visible,
	select:focus-visible,
	a:focus-visible,
	summary:focus-visible {
		outline: 3px solid #28644a;
		outline-offset: 3px;
	}
	button {
		background: none;
		border: 0;
	}
	.cover {
		padding: 23px 28px 18px;
		display: flex;
		align-items: center;
		gap: 20px;
		border-bottom: 1px solid var(--rule);
		background: linear-gradient(115deg, #f9f2df, #e8e4cb);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 14px;
		flex: 1;
	}
	.leaf-mark {
		font:
			70px/1 Georgia,
			serif;
		color: var(--forest);
		transform: rotate(-18deg);
	}
	.eyebrow {
		font-size: 10px;
		letter-spacing: 0.18em;
		font-weight: 700;
		margin: 0 0 3px;
	}
	.cover h1 {
		font: 600 38px/0.98 var(--font-story, 'Alegreya Variable', Georgia, serif);
		letter-spacing: -0.02em;
		margin: 0;
	}
	.intro {
		margin: 8px 0 0;
		color: var(--muted);
		font-size: 13px;
	}
	.count-stamp {
		display: flex;
		flex-direction: column;
		text-align: center;
		border: 2px solid #4e7559;
		border-radius: 49% 45% 46% 49%;
		padding: 10px 16px;
		transform: rotate(-7deg);
		color: #31543f;
	}
	.count-stamp strong {
		font-size: 27px;
		line-height: 1.1;
	}
	.count-stamp strong span {
		font-size: 18px;
		font-weight: 400;
	}
	.count-stamp small {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}
	.icon-button {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border: 1px solid #b4b8a0;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.icon-button svg {
		width: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
	}
	.progress {
		height: 4px;
		background: #d9dbc3;
		flex-shrink: 0;
	}
	.progress span {
		display: block;
		height: 100%;
		background: var(--forest);
	}
	.pages {
		display: grid;
		grid-template-columns: 1.18fr 1fr;
		min-height: 0;
		flex: 1;
	}
	.collection {
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding: 20px 24px 0;
		background: repeating-linear-gradient(
			0deg,
			transparent,
			transparent 26px,
			#b1b59710 26px,
			#b1b59710 27px
		);
		border-right: 1px solid #b3b79a;
		box-shadow: inset -10px 0 12px -12px #5f664f;
	}
	.filters {
		display: flex;
		gap: 12px;
	}
	.filters label {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-weight: 700;
		gap: 5px;
	}
	.filters select {
		width: 100%;
		min-width: 0;
		height: 44px;
		background: #fff9e9;
		border: 1px solid #a8af96;
		border-radius: 7px;
		padding: 0 8px;
		font-size: 12px;
		letter-spacing: 0;
		text-transform: none;
		font-weight: 400;
	}
	.collection-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 17px 0 10px;
		gap: 8px;
	}
	.collection-heading h2 {
		font: 600 21px/1.2 var(--font-story, Georgia, serif);
		margin: 0;
	}
	.collection-heading > span {
		font-size: 11px;
		color: var(--muted);
	}
	.cards-scroll {
		overflow: auto;
		min-height: 0;
		flex: 1;
		padding: 3px 5px 12px 3px;
		overscroll-behavior: contain;
		touch-action: pan-y;
		scrollbar-width: thin;
		scrollbar-color: #9baa84 transparent;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px 10px;
	}
	.species-card {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 0;
		padding: 5px 7px 10px;
		border: 1px solid #c3c8ad;
		border-radius: 9px 12px 9px 11px;
		background: #fbf7e8;
		box-shadow: 1px 2px 0 #79876417;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.species-card:hover,
	.species-card.active {
		border-color: #416849;
		background: #edf0d9;
	}
	.species-card.active {
		box-shadow: inset 0 0 0 1px #416849;
	}
	.species-card.undiscovered {
		background: #eae8d9;
		border-style: dashed;
	}
	.art {
		height: 87px;
		width: 100%;
		margin: 7px 0 1px;
	}
	.card-number {
		position: absolute;
		top: 7px;
		left: 9px;
		font-size: 10px;
		letter-spacing: 0.08em;
		color: #67715c;
	}
	.card-name {
		font-size: 12px;
		font-weight: 700;
		line-height: 1.2;
		min-height: 29px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.rarity {
		font-size: 9px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		line-height: 1.4;
		color: #4a6246;
		padding: 2px 7px;
		border: 1px solid #abb99a;
		border-radius: 10px;
		display: inline-block;
		white-space: nowrap;
	}
	.rarity.legendary {
		color: #775a19;
		background: #eadeb5;
		border-color: #bca563;
	}
	.recorded-mark,
	.unknown-mark {
		position: absolute;
		right: 7px;
		top: 6px;
		color: #42634a;
		font-size: 12px;
	}
	.unknown-mark {
		color: #6e725d;
	}
	.collection-note {
		font-size: 11px;
		text-align: center;
		color: #5d6d53;
		margin: 9px 0 10px;
	}
	.collection-note span {
		font-size: 16px;
		margin-right: 5px;
	}
	.entry-page {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--paper-light);
		padding: 12px 22px 0;
	}
	.page-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		border-bottom: 1px dashed var(--rule);
		min-height: 44px;
		padding-bottom: 7px;
		flex-shrink: 0;
	}
	.page-toolbar > span:not(.rarity) {
		font-size: 10px;
		letter-spacing: 0.15em;
		color: #64765c;
	}
	.back {
		font-size: 12px;
		border: 1px solid #bec5ac;
		border-radius: 8px;
		padding: 4px 9px;
		min-height: 36px;
	}
	.entry-scroll {
		overflow: auto;
		min-height: 0;
		flex: 1;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding: 0 5px 18px;
		scrollbar-width: thin;
		scrollbar-color: #9baa84 transparent;
	}
	.entry-art {
		height: 174px;
		position: relative;
		margin: 10px 0 2px;
	}
	.entry-art.photo {
		height: 190px;
	}
	.entry-art figure {
		margin: 10px auto 0;
		max-width: 260px;
		padding: 7px 7px 4px;
		background: #fffdf4;
		box-shadow: 1px 2px 7px #4a50342a;
		transform: rotate(-2deg);
		border: 1px solid #ded9c3;
		position: relative;
	}
	.entry-art figure::before {
		content: '';
		position: absolute;
		left: 34%;
		top: -8px;
		width: 36%;
		height: 16px;
		background: #d7c48b99;
		transform: rotate(2deg);
	}
	.entry-art img {
		display: block;
		width: 100%;
		height: 145px;
		object-fit: contain;
		background: #e0e7d5;
	}
	.entry-art figcaption {
		font-size: 8px;
		letter-spacing: 0.14em;
		text-align: center;
		margin-top: 5px;
		color: #4c5947;
	}
	.discovery-stamp {
		position: absolute;
		right: -2px;
		bottom: 10px;
		border: 2px double #9f5d41;
		color: #8a4e36;
		transform: rotate(10deg);
		padding: 4px 8px;
		font-size: 11px;
		line-height: 1.1;
		text-align: center;
		letter-spacing: 0.08em;
		background: #f9f1dbd9;
	}
	.discovery-stamp small {
		font-size: 8px;
		letter-spacing: 0;
	}
	.entry-name {
		font: 600 32px/1.05 var(--font-story, Georgia, serif);
		margin: 8px 0 4px;
		letter-spacing: -0.01em;
		outline-offset: 4px;
	}
	.scientific {
		font: italic 15px/1.3 var(--font-story, Georgia, serif);
		color: #5b6b54;
		margin: 0;
	}
	.photo-note {
		font-size: 10px;
		color: #68725c;
		margin: 8px 0 12px;
	}
	.field-pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 13px;
		margin: 12px 0;
	}
	.field-pair section {
		border-top: 1px solid var(--rule);
		padding-top: 9px;
	}
	h3 {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin: 0 0 4px;
		font-weight: 700;
	}
	.field-pair p,
	.encounters p {
		font-size: 12px;
		line-height: 1.5;
		margin: 0;
	}
	.fact {
		display: flex;
		gap: 11px;
		border: 1px solid #c1caa9;
		border-radius: 3px 10px 4px 9px;
		background: #edf0da;
		padding: 12px;
		margin: 13px 0;
	}
	.fact > span {
		font-size: 25px;
		color: #5a724b;
		line-height: 1;
	}
	.fact h3 {
		font: 600 19px/1 var(--font-story, Georgia, serif);
		text-transform: none;
		letter-spacing: 0;
	}
	.fact p {
		font: 16px/1.35 var(--font-story, Georgia, serif);
		margin: 6px 0 0;
	}
	.conservation {
		padding: 8px 0;
		border-bottom: 1px dashed var(--rule);
		margin-bottom: 12px;
	}
	.conservation p {
		display: flex;
		align-items: baseline;
		gap: 7px;
		flex-wrap: wrap;
		margin: 0;
		font-size: 12px;
	}
	.conservation p span {
		color: #67725b;
		font-size: 10px;
	}
	.encounters h3 {
		margin-bottom: 5px;
	}
	.encounters p {
		font-size: 11px;
		color: #52664d;
	}
	.sources {
		font-size: 11px;
		color: #52664d;
		margin-top: 15px;
	}
	.sources summary {
		min-height: 44px;
		display: list-item;
		align-content: center;
		cursor: pointer;
	}
	.sources ul {
		padding-left: 16px;
	}
	.sources li {
		margin: 7px 0;
	}
	.sources a {
		color: #285b40;
		text-underline-offset: 3px;
	}
	.blank-page {
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		text-align: center;
		padding: 25px 5px;
		position: relative;
	}
	.big-leaf {
		font:
			90px Georgia,
			serif;
		color: #6f825c;
		transform: rotate(-18deg);
	}
	.blank-page h2 {
		font: 500 34px/1.1 var(--font-story, Georgia, serif);
		margin: 14px 0;
	}
	.blank-page > p:last-of-type {
		font-size: 13px;
		color: #67725b;
	}
	.notebook-lines {
		height: 75px;
		width: 70%;
		margin-top: 15px;
		background: repeating-linear-gradient(
			0deg,
			transparent 0,
			transparent 24px,
			#bfc6ab 25px,
			transparent 26px
		);
	}
	.unknown-copy {
		font: 21px/1.3 var(--font-story, Georgia, serif);
		margin: 18px 0 10px;
	}
	.unknown-help {
		font-size: 13px;
		color: #65725b;
		max-width: 260px;
	}
	.empty-stamp {
		display: inline-block;
		border: 2px dashed #8d9379;
		color: #6b765c;
		font-size: 11px;
		letter-spacing: 0.12em;
		padding: 9px 12px;
		transform: rotate(-4deg);
		margin: 25px 0;
	}
	.empty {
		text-align: center;
		padding: 35px 10px;
	}
	.empty > span {
		font:
			50px Georgia,
			serif;
		color: #58724c;
	}
	.empty h3 {
		font: 24px var(--font-story, Georgia, serif);
		text-transform: none;
		letter-spacing: 0;
	}
	.empty p {
		font-size: 13px;
	}
	.empty button {
		border: 1px solid #69845d;
		border-radius: 8px;
		padding: 8px 15px;
	}
	.notebook footer {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 9px;
		letter-spacing: 0.08em;
		color: #526147;
		padding: 10px 27px;
		border-top: 1px solid var(--rule);
		flex-shrink: 0;
	}
	.save-notice {
		padding: 8px 18px;
		background: #e9d6ad;
		font-size: 12px;
		border-top: 1px solid #aa8e56;
	}
	.save-notice p {
		margin: 0;
	}
	.save-notice button {
		font-weight: 700;
		text-decoration: underline;
		padding: 5px 0;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (max-width: 850px) {
		.notebook {
			width: calc(100vw - 24px);
			height: calc(100dvh - 24px);
		}
		.cover {
			padding: 16px 20px;
			gap: 12px;
		}
		.cover h1 {
			font-size: 33px;
		}
		.leaf-mark {
			font-size: 56px;
		}
		.collection {
			padding: 15px 16px 0;
		}
		.cards {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.entry-page {
			padding: 10px 15px 0;
		}
		.entry-name {
			font-size: 29px;
		}
		.count-stamp {
			padding: 7px 12px;
		}
		.entry-art {
			height: 150px;
		}
		.entry-art.photo {
			height: 170px;
		}
		.entry-art img {
			height: 125px;
		}
	}
	@media (max-width: 650px) {
		.notebook {
			width: calc(100vw - 16px);
			height: calc(100dvh - 20px);
			margin: auto;
			border-radius: 14px;
			box-shadow:
				0 15px 70px #071b1690,
				0 0 0 3px #c5b286;
		}
		.cover {
			padding: 17px 13px 13px;
			gap: 8px;
		}
		.brand {
			gap: 7px;
		}
		.leaf-mark {
			display: none;
		}
		.eyebrow {
			font-size: 8px;
			letter-spacing: 0.13em;
		}
		.cover h1 {
			font-size: 30px;
		}
		.intro {
			font-size: 11px;
			margin-top: 6px;
			max-width: 170px;
		}
		.count-stamp {
			padding: 7px 10px;
		}
		.count-stamp strong {
			font-size: 25px;
		}
		.count-stamp strong span {
			font-size: 15px;
		}
		.count-stamp small {
			font-size: 8px;
		}
		.close {
			width: 44px;
			height: 44px;
			border: 0;
		}
		.pages {
			display: flex;
			min-height: 0;
		}
		.collection {
			width: 100%;
			border: 0;
			box-shadow: none;
			padding: 15px 15px 0;
		}
		.entry-page {
			display: none;
			width: 100%;
			padding: 8px 16px 0;
		}
		.reading .collection {
			display: none;
		}
		.reading .entry-page {
			display: flex;
		}
		.cards {
			gap: 12px;
		}
		.art {
			height: 98px;
		}
		.card-name {
			font-size: 14px;
			min-height: 32px;
		}
		.species-card {
			padding-bottom: 10px;
		}
		.card-number {
			font-size: 11px;
		}
		.rarity {
			font-size: 10px;
		}
		.collection-heading {
			margin: 14px 0 9px;
		}
		.collection-heading h2 {
			font-size: 21px;
		}
		.filters {
			gap: 10px;
		}
		.filters select {
			font-size: 12px;
		}
		.entry-art {
			height: 160px;
			margin-top: 7px;
		}
		.entry-art.photo {
			height: 176px;
		}
		.entry-art img {
			height: 130px;
		}
		.entry-name {
			font-size: 30px;
		}
		.back {
			min-height: 44px;
		}
		.field-pair {
			gap: 12px;
		}
		.field-pair p {
			font-size: 13px;
		}
		.fact {
			margin: 11px 0;
		}
		.notebook footer {
			padding: 9px 15px;
			font-size: 8px;
		}
		.notebook footer > span:first-child {
			display: none;
		}
		.collection-note {
			font-size: 10px;
		}
	}
	@media (max-height: 500px) and (min-width: 651px) {
		.notebook {
			width: calc(100vw - 20px);
			height: calc(100dvh - 16px);
		}
		.cover {
			padding: 7px 17px;
			gap: 10px;
		}
		.cover h1 {
			font-size: 28px;
		}
		.intro,
		.leaf-mark {
			display: none;
		}
		.eyebrow {
			font-size: 8px;
		}
		.count-stamp {
			padding: 3px 15px;
			border-radius: 15px;
			transform: rotate(-3deg);
		}
		.count-stamp strong {
			font-size: 22px;
		}
		.count-stamp small {
			font-size: 8px;
		}
		.pages {
			grid-template-columns: 1.05fr 1fr;
		}
		.collection {
			padding: 8px 13px 0;
		}
		.filters label {
			font-size: 8px;
			gap: 2px;
		}
		.filters select {
			height: 44px;
			font-size: 11px;
		}
		.collection-heading {
			margin: 7px 0;
		}
		.collection-heading h2 {
			font-size: 17px;
		}
		.collection-note {
			display: none;
		}
		.cards {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 8px;
		}
		.art {
			height: 65px;
		}
		.card-name {
			font-size: 11px;
		}
		.rarity {
			font-size: 8px;
		}
		.entry-page {
			padding: 3px 14px 0;
		}
		.entry-art {
			height: 115px;
		}
		.entry-art.photo {
			height: 139px;
		}
		.entry-art img {
			height: 100px;
		}
		.page-toolbar {
			min-height: 44px;
			padding: 0;
		}
		.entry-name {
			font-size: 26px;
		}
		.notebook footer {
			padding: 5px 18px;
			font-size: 8px;
		}
		.blank-page {
			padding: 5px;
		}
		.big-leaf {
			font-size: 45px;
		}
		.blank-page h2 {
			font-size: 26px;
			margin: 5px 0;
		}
		.notebook-lines {
			height: 30px;
			margin: 0;
		}
		.blank-page .eyebrow {
			font-size: 8px;
		}
	}
	@keyframes open-book {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.reduced[open] {
		animation: none;
	}
	.reduced .species-card {
		transition: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.notebook[open] {
			animation: none;
		}
		.species-card {
			transition: none;
		}
	}
</style>
