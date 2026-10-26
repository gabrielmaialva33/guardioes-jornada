import { GAME_ABI } from '../abi.ts';
// The pack's real entry: the loading screen first, then the game chunk.
import { mountGame } from './ui/loading/entry.ts';

const target = document.querySelector<HTMLElement>('#game');
if (!target) throw new Error('game-root-missing');
let dispose: ReturnType<typeof mountGame> | undefined;
function start() {
	if (!target) return;
	target.replaceChildren();
	dispose = mountGame(target, {
		abi: GAME_ABI,
		earnBadge() {
			localStorage.setItem('secret-trail-dev-badge', 'earned');
		},
		exit() {
			void Promise.resolve(dispose?.()).then(() => {
				const button = document.createElement('button');
				button.textContent = 'Entrar na trilha';
				button.onclick = start;
				target.append(button);
			});
		}
	});
}
start();
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		void dispose?.();
	});
