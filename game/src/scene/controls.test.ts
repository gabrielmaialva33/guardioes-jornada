import { expect, it } from 'vitest';
import { actionControl } from './controls.ts';

it('shows only actionable contextual buttons with short labels and keeps the full accessible name', () => {
	expect(actionControl(null)).toBeNull();
	expect(
		actionControl({ id: 'danger', label: 'Afaste-se', point: { x: 0, y: 0, z: 0 }, disabled: true })
	).toBeNull();
	for (const [id, label] of [
		['jucara-1', 'Pegar'],
		['clareira-1', 'Plantar'],
		['logger', 'Rádio'],
		['armadilha-1', 'Marcar'],
		['iara', 'Falar']
	])
		expect(actionControl({ id, label: 'Descrição completa', point: { x: 0, y: 0, z: 0 } })).toMatchObject({
			label,
			accessibleName: 'Descrição completa'
		});
});
