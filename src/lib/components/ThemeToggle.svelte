<!-- One tap to switch to the high-contrast Sol theme when the sun hits the screen. -->
<script lang="ts">
	import { preferences } from '#lib/state/preferences.svelte.ts';
	import Icon from './Icon.svelte';

	const sun = $derived(preferences.theme === 'sol');

	function toggle() {
		preferences.theme = sun ? 'mata' : 'sol';
		preferences.save();
	}
</script>

<button
	class="icon-button toggle"
	type="button"
	aria-pressed={sun}
	aria-label={sun ? 'Voltar para o tema Mata' : 'Usar o tema Sol, para sol forte'}
	onclick={toggle}
>
	<Icon name={sun ? 'moon' : 'sun'} weight="duotone" />
</button>

<style>
	.toggle {
		color: var(--gold);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.35;
	}
</style>
