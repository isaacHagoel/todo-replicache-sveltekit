import { redirect } from '@sveltejs/kit';
import { spaceExists } from '$lib/server/util/space';

export async function load({ params }) {
	const { spaceID } = params;
	const exists = await spaceExists(spaceID);
	if (!exists) {
		throw redirect(307, '/');
	}
}
