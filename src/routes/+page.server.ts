import { redirect } from '@sveltejs/kit';
import { safeCreateSpace } from '$lib/server/util/space';

export async function load() {
	// When someone lands in / we want to create a new space
	const spaceID = await safeCreateSpace();
	throw redirect(307, `/list/${spaceID}`);
}
