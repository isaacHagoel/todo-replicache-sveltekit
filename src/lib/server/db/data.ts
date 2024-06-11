import type { JSONValue } from 'replicache';
import { z } from 'zod';
import type { Executor } from './pg.js';

export async function getEntry(
	executor: Executor,
	spaceid: string,
	key: string
): Promise<JSONValue | undefined> {
	const { rows } = await executor(
		'select value from replicache_entry where spaceid = $1 and key = $2 and deleted = false',
		[spaceid, key]
	);
	const value = rows[0]?.value;
	if (value === undefined) {
		return undefined;
	}
	return JSON.parse(value);
}

export async function putEntry(
	executor: Executor,
	spaceID: string,
	key: string,
	value: JSONValue,
	version: number
): Promise<void> {
	await executor(
		`
    insert into replicache_entry (spaceid, key, value, deleted, version, lastmodified)
    values ($1, $2, $3, false, $4, now())
      on conflict (spaceid, key) do update set
        value = $3, deleted = false, version = $4, lastmodified = now()
    `,
		[spaceID, key, JSON.stringify(value), version]
	);
}

export async function delEntry(
	executor: Executor,
	spaceID: string,
	key: string,
	version: number
): Promise<void> {
	await executor(
		`update replicache_entry set deleted = true, version = $3 where spaceid = $1 and key = $2`,
		[spaceID, key, version]
	);
}

export async function* getEntries(
	executor: Executor,
	spaceID: string,
	fromKey: string
): AsyncIterable<readonly [string, JSONValue]> {
	const { rows } = await executor(
		`select key, value from replicache_entry where spaceid = $1 and key >= $2 and deleted = false order by key`,
		[spaceID, fromKey]
	);
	for (const row of rows) {
		yield [row.key as string, JSON.parse(row.value) as JSONValue] as const;
	}
}

export async function getChangedEntries(
	executor: Executor,
	spaceID: string,
	prevVersion: number
): Promise<[key: string, value: JSONValue, deleted: boolean][]> {
	const { rows } = await executor(
		`select key, value, deleted from replicache_entry where spaceid = $1 and version > $2`,
		[spaceID, prevVersion]
	);
	return rows.map((row) => [row.key, JSON.parse(row.value), row.deleted]);
}

export async function createSpace(executor: Executor, spaceID: string): Promise<void> {
	console.log('creating space', spaceID);
	await executor(`insert into replicache_space (id, version, lastmodified) values ($1, 0, now())`, [
		spaceID
	]);
}

export async function getCookie(executor: Executor, spaceID: string): Promise<number | undefined> {
	const { rows } = await executor(`select version from replicache_space where id = $1`, [spaceID]);
	const value = rows[0]?.version;
	if (value === undefined) {
		return undefined;
	}
	return z.number().parse(value);
}

export async function setCookie(
	executor: Executor,
	spaceID: string,
	version: number
): Promise<void> {
	await executor(`update replicache_space set version = $2, lastmodified = now() where id = $1`, [
		spaceID,
		version
	]);
}

export async function getLastMutationID(
	executor: Executor,
	clientID: string
): Promise<number | undefined> {
	const { rows } = await executor(`select lastmutationid from replicache_client where id = $1`, [
		clientID
	]);
	const value = rows[0]?.lastmutationid;
	if (value === undefined) {
		return undefined;
	}
	return z.number().parse(value);
}

export async function getLastMutationIDs(executor: Executor, clientIDs: string[]) {
	return Object.fromEntries(
		await Promise.all(
			clientIDs.map(async (cid) => {
				const lmid = await getLastMutationID(executor, cid);
				return [cid, lmid ?? 0] as const;
			})
		)
	);
}

export async function getLastMutationIDsSince(
	executor: Executor,
	clientGroupID: string,
	sinceVersion: number
) {
	const { rows } = await executor(
		`select id, lastmutationid from replicache_client where clientgroupid = $1 and version > $2`,
		[clientGroupID, sinceVersion]
	);
	return Object.fromEntries(rows.map((r) => [r.id as string, r.lastmutationid as number] as const));
}

export async function setLastMutationID(
	executor: Executor,
	clientID: string,
	clientGroupID: string,
	lastMutationID: number,
	version: number
): Promise<void> {
	await executor(
		`
    insert into replicache_client (id, clientgroupid, lastmutationid, version, lastmodified)
    values ($1, $2, $3, $4, now())
      on conflict (id) do update set lastmutationid = $3, version = $4, lastmodified = now()
    `,
		[clientID, clientGroupID, lastMutationID, version]
	);
}

export async function setLastMutationIDs(
	executor: Executor,
	clientGroupID: string,
	lmids: Record<string, number>,
	version: number
) {
	return await Promise.all(
		[...Object.entries(lmids)].map(([clientID, lmid]) =>
			setLastMutationID(executor, clientID, clientGroupID, lmid, version)
		)
	);
}
