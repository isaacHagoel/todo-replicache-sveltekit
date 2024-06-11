import { json } from '@sveltejs/kit';
import { transact } from '$lib/server/db/pg';
import { getChangedEntries, getCookie, getLastMutationIDsSince } from '$lib/server/db/data.js';
import { z } from 'zod';
import type { ClientID, PatchOperation } from 'replicache';

const pullRequest = z.object({
	profileID: z.string(),
	clientGroupID: z.string(),
	cookie: z.union([z.number(), z.null()]),
	schemaVersion: z.string()
});

export type PullResponse = {
	cookie: number;
	lastMutationIDChanges: Record<ClientID, number>;
	patch: PatchOperation[];
};

export async function POST({ request, params }) {
	const { spaceID } = params;
	const pull = await request.json();
	const { cookie: requestCookie } = pull;

	console.log('pull called for spaceID', spaceID);

	const t0 = Date.now();
	const sinceCookie = requestCookie ?? 0;

	const [entries, lastMutationIDChanges, responseCookie] = await transact(async (executor) => {
		return Promise.all([
			getChangedEntries(executor, spaceID, sinceCookie),
			getLastMutationIDsSince(executor, pull.clientGroupID, sinceCookie),
			getCookie(executor, spaceID)
		]);
	});

	console.log('lastMutationIDChanges: ', lastMutationIDChanges);
	console.log('responseCookie: ', responseCookie);
	console.log('Read all objects in', Date.now() - t0);

	if (responseCookie === undefined) {
		throw new Error(`Unknown space ${spaceID}`);
	}
	const resp: PullResponse = {
		lastMutationIDChanges,
		cookie: responseCookie,
		patch: []
	};

	for (const [key, value, deleted] of entries) {
		if (deleted) {
			resp.patch.push({
				op: 'del',
				key
			});
		} else {
			resp.patch.push({
				op: 'put',
				key,
				value
			});
		}
	}

	console.log(`Returning`, JSON.stringify(resp, null, ''));

	return json(resp, { status: 200 });
}
