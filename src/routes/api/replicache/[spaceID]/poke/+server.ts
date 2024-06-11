import { produce } from 'sveltekit-sse';
import { getPokeBackend } from '$lib/server/sse/poke';

export function POST({ params }) {
	const { spaceID } = params;
	console.log('connnected to poke endpoint from spaceID', spaceID);
	let removeListener: () => void;
	return produce(
		({ emit }) => {
			const pubsub = getPokeBackend();
			removeListener = pubsub.addListener(spaceID, () => emit('poke', ''));
		},
		{
			stop() {
				console.log('client disconnected from spaceID', spaceID);
				if (removeListener) removeListener();
			}
		}
	);
}
