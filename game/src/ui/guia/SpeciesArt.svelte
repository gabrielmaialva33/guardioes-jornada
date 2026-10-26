<script lang="ts">
	import type { SpeciesEntry } from '../../guia/types.ts';
	let { species, unknown = false }: { species: SpeciesEntry; unknown?: boolean } = $props();
	const warm = $derived(unknown ? '#bdbba8' : species.color);
	const accent = $derived(unknown ? '#bdbba8' : species.accent);
</script>

<svg viewBox="0 0 240 160" fill="none" aria-hidden="true" class:unknown>
	<ellipse cx="121" cy="91" rx="83" ry="57" fill={unknown ? '#e8e4d3' : '#e4e5c8'} opacity=".6" />
	<g stroke={unknown ? '#aaa893' : '#6e8063'} stroke-width="1.3" stroke-linecap="round" opacity=".7"
		><path
			d="M25 143Q38 117 32 93M30 126Q15 112 20 106Q34 109 31 121M34 112Q45 97 49 104Q46 116 34 118M193 139Q214 120 213 101M204 129Q196 115 201 111Q210 118 208 127M211 117Q220 104 225 108Q222 119 211 123M51 144Q128 151 193 142"
		/></g
	>
	<g
		fill={warm}
		stroke={unknown ? '#bdbba8' : '#394c3c'}
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		{#if species.art === 'bird'}
			<path d="M77 100Q49 115 44 131L90 119M109 116L105 136M130 115L136 136M98 137H112M130 137H143" />
			<path d="M79 94Q81 57 117 62Q128 31 150 40Q171 49 160 77Q168 114 130 123Q95 130 79 94Z" />
			<path d="M103 76Q136 77 132 105Q107 111 91 96" fill={accent} />
			{#if species.id === 'tucano-de-bico-verde'}<path
					d="M156 47Q199 38 208 61Q192 80 156 65Z"
					fill={accent}
				/>{:else if species.id === 'guara'}<path
					d="M161 48Q195 58 193 91Q183 67 159 62"
					fill={accent}
				/>{:else}<path d="M159 49L180 58L157 63Z" fill={accent} />{/if}
			{#if !unknown}<circle cx="147" cy="53" r="3.5" fill="#243b31" stroke="none" /><circle
					cx="148"
					cy="52"
					r="1"
					fill="#fff3d8"
					stroke="none"
				/>{/if}
		{:else if species.art === 'primate' || species.art === 'sloth'}
			<path d="M60 70Q95 62 184 64" fill="none" stroke-width="8" stroke="#8b7357" />
			{#if species.art === 'primate'}<path
					d="M145 107Q195 144 191 100Q192 77 179 72Q170 72 175 88"
					fill="none"
					stroke-width="9"
				/>{/if}
			<path
				d="M98 83Q75 91 79 65M139 84Q157 93 164 65M102 113L93 139L107 140M132 112L140 139L153 139"
				fill="none"
				stroke-width="10"
			/>
			<ellipse cx="118" cy="99" rx="27" ry="35" />
			<path
				d="M92 54L94 43L104 46L117 37L129 42L142 40L146 53L154 62L144 74L140 85L126 85L116 91L105 84L93 83L90 71L84 63Z"
				fill={accent}
			/>
			<ellipse cx="119" cy="65" rx="19" ry="20" />
			{#if !unknown}<path
					d="M107 63Q111 59 115 63M124 63Q128 59 132 63M114 75Q119 79 126 74"
					stroke="#243b31"
					fill="none"
				/>{/if}
		{:else if species.art === 'crab'}
			<path
				d="M90 97L62 87L44 98M87 106L61 111L48 128M92 114L76 130L77 141M148 97L177 87L195 98M150 106L176 111L189 128M146 114L161 130L160 141"
				fill="none"
				stroke-width="6"
			/>
			<path
				d="M91 90L77 67L62 69L48 49L49 34L62 48L75 37L80 53L73 65M148 90L163 65L178 66L190 48L188 33L175 47L162 35L159 53L167 65"
				fill={accent}
			/>
			<ellipse cx="120" cy="103" rx="39" ry="25" /><path d="M108 81L104 70M133 81L137 70" stroke-width="6" />
			{#if !unknown}<circle cx="104" cy="70" r="3" fill="#243b31" /><circle
					cx="137"
					cy="70"
					r="3"
					fill="#243b31"
				/>{/if}
		{:else if species.art === 'turtle' || species.art === 'tortoise'}
			<path
				d="M81 86Q46 67 42 84L69 102M85 118L60 139L87 134L100 119M137 118L161 139L168 128L152 109"
				fill={accent}
			/>
			<ellipse cx="175" cy="91" rx="20" ry="15" /><path
				d="M156 91Q155 55 112 56Q71 58 67 105Q89 127 136 122Q159 118 156 91Z"
			/>
			<path
				d="M98 68L122 64L139 81L130 103L105 108L89 88ZM75 102L105 108L100 121M139 81L154 85M122 64L126 57M130 103L144 118M98 68L91 62"
				fill="none"
				stroke={accent}
			/>
			{#if !unknown}<circle cx="182" cy="87" r="3" fill="#243b31" stroke="none" />{/if}
		{:else if species.art === 'frog'}
			<path
				d="M94 100Q62 83 56 110L39 130L79 130L98 117M144 100Q179 85 184 110L201 130L160 130L141 118"
				fill={accent}
			/>
			<path
				d="M91 77Q83 47 104 49Q118 48 119 68Q124 47 143 49Q160 55 148 77Q171 119 143 128L98 128Q68 120 91 77Z"
			/>
			<path d="M101 105L91 137H105M141 106L151 137H137" fill="none" stroke-width="8" />
			{#if !unknown}<circle cx="104" cy="62" r="4" fill="#243b31" /><circle
					cx="139"
					cy="62"
					r="4"
					fill="#243b31"
				/><path d="M104 88Q120 97 139 88" fill="none" />{/if}
		{:else}
			<path d="M79 105L70 137H85L96 109M132 106L139 137H154L147 103" fill={accent} />
			<path
				d={species.art === 'cat' ? 'M68 99Q39 106 40 80Q39 63 28 64' : 'M70 99L46 109L55 96'}
				fill="none"
				stroke-width={species.art === 'cat' ? 9 : 5}
			/>
			<path d="M64 99Q68 65 111 64Q151 63 160 97Q156 121 114 120Q78 121 64 99Z" />
			{#if species.art === 'rabbit'}<path
					d="M147 67Q126 20 143 16Q157 22 159 61M159 60Q158 13 175 18Q184 27 171 65"
					fill={accent}
				/>{:else if species.art === 'canid' || species.art === 'cat'}<path
					d="M146 61L143 37L159 48L176 39L178 65"
				/>{:else}<ellipse cx="146" cy="60" rx="10" ry="14" fill={accent} /><ellipse
					cx="170"
					cy="60"
					rx="9"
					ry="12"
					fill={accent}
				/>{/if}
			<path
				d={species.art === 'ungulate' && species.id === 'anta'
					? 'M140 69Q153 55 174 66L188 93Q189 110 180 109L172 92Q142 96 140 69Z'
					: 'M138 70Q155 53 176 68L186 90Q173 107 149 95Z'}
			/>
			{#if species.art === 'armadillo'}<path
					d="M92 69Q79 91 88 115M104 67Q93 92 102 118M117 67Q107 94 116 119M130 69Q120 95 130 116"
					fill="none"
					stroke={accent}
				/>{/if}
			{#if !unknown}<circle cx="166" cy="77" r="3" fill="#243b31" stroke="none" /><path
					d="M178 90L185 89"
					stroke="#243b31"
					stroke-width="4"
				/>{#if species.id === 'onca-pintada' || species.id === 'jaguatirica'}<g fill={accent} stroke="none"
						><circle cx="85" cy="90" r="4" /><circle cx="102" cy="82" r="4" /><circle
							cx="117"
							cy="99"
							r="5"
						/><circle cx="95" cy="107" r="4" /><circle cx="133" cy="83" r="4" /></g
					>{/if}{/if}
		{/if}
	</g>
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: 100%;
		max-height: 230px;
	}
	.unknown {
		filter: saturate(0.1);
	}
</style>
