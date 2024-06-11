import type { PGConfig } from './pgconfig/pgconfig.js';
import type { Executor } from './pg.js';

export async function createDatabase(executor: Executor, dbConfig: PGConfig) {
	console.log('Creating Database');
	const schemaVersion = await dbConfig.getSchemaVersion(executor);
	const migrations = [createSchemaVersion1];
	if (schemaVersion < 0 || schemaVersion > migrations.length) {
		throw new Error('Unexpected schema version: ' + schemaVersion);
	}
	await createSchemaVersion1(executor);
}

export async function createSchemaVersion1(executor: Executor) {
	await executor(`create table replicache_meta (key text primary key, value json)`);
	await executor(`insert into replicache_meta (key, value) values ('schemaVersion', '1')`);

	await executor(`create table replicache_space (
        id text primary key not null,
        version integer not null,
        lastmodified timestamp(6) not null
        )`);

	await executor(`create table replicache_client (
          id text primary key not null,
          lastmutationid integer not null,
          version integer not null,
          lastmodified timestamp(6) not null,
          clientgroupid text not null
          )`);

	await executor(`create table replicache_entry (
        spaceid text not null,
        key text not null,
        value text not null,
        deleted boolean not null,
        version integer not null,
        lastmodified timestamp(6) not null
        )`);

	await executor(`create unique index on replicache_entry (spaceid, key)`);
	await executor(`create index on replicache_entry (spaceid)`);
	await executor(`create index on replicache_entry (deleted)`);
	await executor(`create index on replicache_entry (version)`);
	await executor(`create index on replicache_client (clientgroupid,version)`);
}
