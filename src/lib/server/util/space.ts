import { nanoid } from 'nanoid';
import { transact } from '$lib/server/db/pg.js';
import { getCookie, createSpace } from '$lib/server/db/data.js';

export async function spaceExists(spaceID: string): Promise<boolean> {
	try {
		const cookie = await transact(async (executor) => {
			return await getCookie(executor, spaceID);
		});
		return cookie !== undefined;
	} catch (e: any) {
		throw new Error(`Failed to check space exists ${spaceID}`, e);
	}
}
export async function safeCreateSpace(): Promise<string> {
	const spaceID = nanoid(6);
	try {
		await transact(async (executor) => {
			await createSpace(executor, spaceID);
		});
		return spaceID;
	} catch (e: any) {
		throw new Error(`Failed to create space ${spaceID}`, e);
	}
}
