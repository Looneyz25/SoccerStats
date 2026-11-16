import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { useCachedImage, writeJsonAtomic, writeRegistryBadge } from './cache_badges_to_firebase.mjs';

const entity = () => ({ name: 'Example FC', badge_storage_path: 'badges/teams/example.png', badge_source: 'sofascore', badge_source_url: 'https://img.sofascore.com/api/v1/team/123/image' });
function registry() {
  const writes = [];
  return { writes, db: { collection: () => ({ doc: id => ({ set: async data => writes.push({ id, data }) }) }) } };
}

test('repeated match occurrences validate one Storage object and write one unchanged registry badge', async () => {
  let publicCalls = 0;
  const bucket = { name: 'lvrstats-badges-sports-predictions-f91fd', file: () => ({ makePublic: async () => { publicCalls++; } }) };
  const { db, writes } = registry();
  const cache = new Map();
  for (let i = 0; i < 100; i++) {
    const team = { ...entity(), badge_cache_error: 'old failure' };
    assert.equal(await useCachedImage(bucket, team), true);
    assert.equal(team.logo, 'https://storage.googleapis.com/lvrstats-badges-sports-predictions-f91fd/badges/teams/example.png');
    assert.equal(team.badge_cache_error, undefined);
    await writeRegistryBadge(db, cache, 'teams', team, [123, team.name]);
  }
  assert.equal(publicCalls, 1);
  assert.equal(writes.length, 1);
});

test('different storage paths and bucket objects are validated independently', async () => {
  let calls = 0;
  const makeBucket = () => ({ name: 'bucket', file: () => ({ makePublic: async () => { calls++; } }) });
  const bucket = makeBucket();
  await useCachedImage(bucket, entity());
  await useCachedImage(bucket, { ...entity(), badge_storage_path: 'badges/teams/other.png' });
  await useCachedImage(makeBucket(), entity());
  assert.equal(calls, 3);
});

test('failed Storage validation is retried and never marked successful', async () => {
  let calls = 0;
  const bucket = { name: 'bucket', file: () => ({ makePublic: async () => { if (++calls === 1) throw new Error('unavailable'); } }) };
  assert.equal(await useCachedImage(bucket, entity()), false);
  assert.equal(await useCachedImage(bucket, entity()), true);
  assert.equal(await useCachedImage(bucket, entity()), true);
  assert.equal(calls, 2);
});

test('changed badge metadata is persisted and distinct registry identities stay separate', async () => {
  const { db, writes } = registry();
  const cache = new Map();
  const team = { ...entity(), logo: 'https://storage.googleapis.com/lvrstats-badges-sports-predictions-f91fd/badges/teams/example.png' };
  await writeRegistryBadge(db, cache, 'teams', team, [123, team.name]);
  await writeRegistryBadge(db, cache, 'teams', { ...team, badge_source_url: 'https://provider.example/new.png' }, [123, team.name]);
  await writeRegistryBadge(db, cache, 'teams', { ...team, name: 'Another FC' }, [456, 'Another FC']);
  assert.equal(writes.length, 3);
  assert.notEqual(writes[0].id, writes[2].id);
});

test('failed registry writes are retried', async () => {
  let calls = 0;
  const db = { collection: () => ({ doc: () => ({ set: async () => { if (++calls === 1) throw new Error('unavailable'); } }) }) };
  const cache = new Map();
  const team = { ...entity(), logo: 'https://storage.googleapis.com/lvrstats-badges-sports-predictions-f91fd/badges/teams/example.png' };
  await assert.rejects(writeRegistryBadge(db, cache, 'teams', team, [123, team.name]));
  await writeRegistryBadge(db, cache, 'teams', team, [123, team.name]);
  assert.equal(calls, 2);
});

test('atomic ledger write replaces the file whole and leaves no temp file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'badge-atomic-'));
  const file = path.join(dir, 'match_data.json');
  writeFileSync(file, JSON.stringify({ leagues: ['old'] }));
  await writeJsonAtomic(file, { leagues: ['new'] });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { leagues: ['new'] });
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('a failed ledger write leaves the existing file untouched', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'badge-atomic-'));
  const file = path.join(dir, 'match_data.json');
  writeFileSync(file, JSON.stringify({ leagues: ['old'] }));
  const circular = {}; circular.self = circular;
  await assert.rejects(writeJsonAtomic(file, circular));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { leagues: ['old'] });
  assert.equal(existsSync(`${file}.tmp`), false);
});

test('a temp file that cannot be renamed into place never replaces the ledger', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'badge-atomic-'));
  const file = path.join(dir, 'match_data.json');
  mkdirSync(file);
  await assert.rejects(writeJsonAtomic(file, { leagues: ['new'] }));
  assert.equal(existsSync(`${file}.tmp`), false);
});
