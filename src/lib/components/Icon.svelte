<!--
	Phosphor icons (MIT), shipped as inline SVG built by scripts/icons.ts.
	Duotone icons take their second tone from --icon-tone (defaults to the
	icon color at 25% opacity), so badges can mix e.g. leaf green with gold.
-->
<script lang="ts" module>
	export type { IconName, IconWeight } from '#lib/icons.generated.ts';
</script>

<script lang="ts">
	import { DEFAULT_WEIGHT, ICON_BODIES, type IconName, type IconWeight } from '#lib/icons.generated.ts';

	interface Props {
		name: IconName;
		size?: number;
		weight?: IconWeight;
		label?: string;
	}

	let { name, size = 24, weight, label }: Props = $props();

	const body = $derived(
		ICON_BODIES[`${name}:${weight ?? DEFAULT_WEIGHT[name]}`] ??
			ICON_BODIES[`${name}:${DEFAULT_WEIGHT[name]}`] ??
			''
	);
</script>

<svg
	class="icon"
	width={size}
	height={size}
	viewBox="0 0 256 256"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<!-- Static markup generated at build time from the icon set; never user input. -->
	{@html body}
</svg>

<style>
	.icon {
		flex: none;
		vertical-align: middle;
	}

	.icon :global([opacity]) {
		fill: var(--icon-tone, currentColor);
		opacity: var(--icon-tone-opacity, 0.25);
	}
</style>
