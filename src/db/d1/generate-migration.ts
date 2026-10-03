/** Offline SQLite DDL generation. Does not connect to either database. */
import { mkdir, writeFile } from 'node:fs/promises';
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api';
import * as schema from './schema';

const directory = new URL('../../../drizzle-d1/', import.meta.url);
const empty = await generateSQLiteDrizzleJson({});
const snapshot = await generateSQLiteDrizzleJson(schema, empty.id);
const statements = await generateSQLiteMigration(empty, snapshot);
await mkdir(new URL('meta/', directory), { recursive: true });
await writeFile(new URL('0000_aplicacion.sql', directory),
  '-- SQLite/D1-native application schema. No source data or production cutover.\n'
  + '-- PostgreSQL 0021 write-fence triggers are intentionally NOT included.\n'
  + statements.join('\n--> statement-breakpoint\n') + '\n');
await writeFile(new URL('meta/0000_snapshot.json', directory), JSON.stringify(snapshot, null, 2) + '\n');
await writeFile(new URL('meta/_journal.json', directory), JSON.stringify({
  version: '6', dialect: 'sqlite',
  entries: [{ idx: 0, version: '6', when: 1790985600000, tag: '0000_aplicacion', breakpoints: true }],
}, null, 2) + '\n');
console.log(`Generated ${Object.keys(snapshot.tables).length} tables in ${statements.length} SQLite statements.`);
