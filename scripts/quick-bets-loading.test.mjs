import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildQuickBetSummary, resolveQuickBetDate } from '../app/dashboard/quick-bets/quick-bets-utils.mjs';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const metadata = { availableDates: ['2026-09-10', '2026-09-13', '2026-09-14'], updatedAt: { seconds: 100 },
  summary: { version: 1, datesByLifecycle: { upcoming: ['2026-09-14'], result: ['2026-09-10', '2026-09-13'], live: [] } } };
const strip = text => text.replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function firestore(meta = metadata) {
  const reads = [];
  const ref = parts => ({ collection: key => ref([...parts, key]), doc: key => ref([...parts, key]), get: async () => {
    reads.push(parts.join('/'));
    return { exists: true, data: () => parts.includes('dates') ? { matches: [{ date: parts.at(-1) }] } : meta };
  } });
  return { reads, db: ref([]) };
}
function api(meta) {
  const store = firestore(meta);
  const context = vm.createContext({ getFirestore: () => store.db, getAdminApp: () => ({}), verifyAccess: async () => {},
    capMap: () => {}, resolveQuickBetDate, Response, URL, Date });
  vm.runInContext(`${strip(source('app/api/quick-bets/route.js'))}\nglobalThis.get = GET;`, context);
  return { ...store, get: (query = '') => context.get({ url: `http://localhost/api/quick-bets${query}` }) };
}

test('date resolver uses lifecycle index, validates calendar dates and never needs rows', () => {
  assert.equal(resolveQuickBetDate(metadata, '', 'upcoming', '2026-09-13'), '2026-09-14');
  assert.equal(resolveQuickBetDate(metadata, '', 'result', '2026-09-12'), '2026-09-10');
  assert.equal(resolveQuickBetDate({}, '', 'result', '2026-09-13'), '2026-09-13');
  for (const date of ['../secret', '2026-02-30', '2026-1-01']) assert.throws(() => resolveQuickBetDate(metadata, date), /Invalid/);
});

test('API reads metadata plus exactly one requested day and caches dates independently', async () => {
  const app = api();
  for (const date of ['2026-09-10', '2026-09-14', '2026-09-10']) {
    const response = await app.get(`?date=${date}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.selectedDate, date);
    assert.equal(payload.matches[0].date, date);
  }
  assert.equal(app.reads.length, 4);
  assert.equal(app.reads.filter(path => path.includes('/dates/')).length, 2);
  assert.equal((await app.get('?date=2026-02-30')).status, 400);
  assert.equal(app.reads.length, 4);
  const empty = await (await app.get('?date=2026-09-12')).json();
  assert.deepEqual(empty.matches, []);
  assert.equal(app.reads.length, 5);
});

function client(overrides = {}) {
  const context = vm.createContext({ resolveQuickBetDate, window: {}, URLSearchParams,
    getFirebaseAuth: () => ({ currentUser: { getIdToken: async () => 'test-token' } }),
    getFirebaseDb: () => ({}), ...overrides });
  vm.runInContext(`${strip(source('app/firestore-data.js'))}\nglobalThis.load = loadQuickBetsFromFirestore; globalThis.cached = readQuickBetsCache;`, context);
  return context;
}

test('client deduplicates same-day requests and keeps independent day caches', async () => {
  const pending = deferred(); const requests = [];
  const app = client({ fetch: async url => { requests.push(url); await pending.promise; const date = new URL(url, 'http://localhost').searchParams.get('date');
    return { ok: true, json: async () => ({ ...metadata, selectedDate: date, matches: [{ date }] }) }; } });
  const first = app.load('2026-09-10');
  assert.equal(app.load('2026-09-10'), first);
  const second = app.load('2026-09-14');
  await Promise.resolve(); pending.resolve(); await Promise.all([first, second]);
  assert.equal(requests.length, 2);
  assert.equal(app.cached('2026-09-10').matches[0].date, '2026-09-10');
  assert.equal(app.cached('2026-09-14').matches[0].date, '2026-09-14');
});

test('SDK fallback also reads only metadata and requested date', async () => {
  const reads = [];
  const app = client({ fetch: async () => ({ ok: false }), doc: (_, ...parts) => parts.join('/'),
    getDoc: async path => { reads.push(path); return { exists: () => true, data: () => path.includes('/dates/') ? { matches: [{ date: '2026-09-14' }] } : metadata }; } });
  const payload = await app.load('2026-09-14');
  assert.equal(payload.selectedDate, '2026-09-14');
  assert.deepEqual(reads, ['dashboardData/quick_bets', 'dashboardData/quick_bets/dates/2026-09-14']);
});

test('cancelled day response cannot replace the newly selected day or clear its loading state', async () => {
  const page = source('app/dashboard/quick-bets/page.jsx');
  const start = page.indexOf('  useEffect(() => {\n    if (!data || !mobileCurrentDate');
  const end = page.indexOf('\n  }, [mobileCurrentDate, Boolean(data), activeLifecycle]);', start);
  assert.ok(start >= 0 && end > start);
  const body = page.slice(start + '  useEffect(() => {'.length, end);
  const pending = deferred(); const changes = [];
  const run = vm.runInNewContext(`() => {${body}\n}`, { data: { selectedDate: '2026-09-10' }, mobileCurrentDate: '2026-09-14', activeLifecycle: 'upcoming',
    quickBetRequest: { current: 0 }, readQuickBetsCache: () => null, loadQuickBetsFromFirestore: () => pending.promise,
    setData: value => changes.push(['data', value]), setLoading: value => changes.push(['loading', value]), setDayError: () => {} });
  const cleanup = run(); cleanup(); pending.resolve({ selectedDate: '2026-09-14' });
  await pending.promise; await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(changes, [['loading', true]]);
});

test('compact summary preserves global outcomes, captured stars and unknown history without mutating rows', () => {
  const captured = starred => ({ version: 1, state: 'captured', starred, capturedAt: '2026-09-01T00:00:00Z', label: starred ? 'Captured' : '', leagueLabel: '' });
  const match = (date, lifecycle, selections) => ({ date, lifecycle, status: lifecycle === 'result' ? 'FT' : lifecycle, markets: { winner: selections } });
  const pick = (result, extra = {}) => ({ label: 'Home', odds: 1.2, result, ...extra });
  const matches = [match('2026-09-10', 'result', [pick('hit', { starSnapshot: captured(true) }), pick('miss', { starSnapshot: captured(false) }), pick('void')]),
    match('2026-09-13', 'result', [pick('miss')]), match('2026-09-14', 'upcoming', [pick('')]),
    match('2026-09-13', 'live', [pick('', { liveLock: 'hit' })])];
  const original = structuredClone(matches); const summary = buildQuickBetSummary(matches);
  assert.deepEqual(summary.statsByLifecycle.result.winner, { hits: 1, misses: 2, voids: 1, settled: 3, rate: 33 });
  assert.equal(summary.statsByLifecycle.live.winner.hits, 1);
  assert.deepEqual(summary.starredMarkets.winner, { hits: 1, settled: 1 });
  assert.equal(summary.unrecordedStars, 1);
  assert.deepEqual(summary.datesByLifecycle.result, ['2026-09-10', '2026-09-13']);
  assert.equal(summary.matches, undefined);
  assert.deepEqual(matches, original);
});

test('late mount refresh cannot reset a day explicitly selected from cached initial data', async () => {
  const page = source('app/dashboard/quick-bets/page.jsx');
  const start = page.indexOf('  useEffect(() => {\n    let cancelled = false;');
  const end = page.indexOf('\n  }, [activeLifecycle]);', start);
  assert.ok(start >= 0 && end > start);
  const body = page.slice(start + '  useEffect(() => {'.length, end);
  const pending = deferred(); const changes = []; const quickBetRequest = { current: 0 };
  const mount = vm.runInNewContext(`() => {${body}\n}`, { quickBetRequest, data: { selectedDate: '2026-09-13' }, activeLifecycle: 'upcoming',
    readQuickBetsCache: () => ({ selectedDate: '2026-09-13' }), loadQuickBetsFromFirestore: () => pending.promise,
    setData: value => changes.push(['data', value]), setMobileSelectedDate: value => changes.push(['date', value]),
    setLoading: value => changes.push(['loading', value]), setError: value => changes.push(['error', value]) });
  mount();
  const selection = page.match(/const selectQuickBetDate = \(date\) => \{([\s\S]*?)\n  \};/)[1];
  vm.runInNewContext(`(date => {${selection}})('2026-09-14')`, { quickBetRequest, setMobileSelectedDate: value => changes.push(['date', value]) });
  pending.resolve({ selectedDate: '2026-09-13', matches: [] });
  await pending.promise; await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(changes, [['loading', false], ['date', '2026-09-14']]);
});

test('missing summary still loads a single day without inventing aggregate statistics', async () => {
  const { summary, ...legacy } = metadata;
  const app = api(legacy);
  const payload = await (await app.get('?date=2026-09-10')).json();
  assert.equal(payload.summary, undefined);
  assert.equal(payload.matches.length, 1);
  assert.equal(app.reads.length, 2);
});

test('switching lifecycle before first data replaces the initial request and completes loading', async () => {
  const page = source('app/dashboard/quick-bets/page.jsx');
  const start = page.indexOf('  useEffect(() => {\n    let cancelled = false;');
  const end = page.indexOf('\n  }, [activeLifecycle]);', start);
  assert.ok(start >= 0 && end > start);
  const body = page.slice(start + '  useEffect(() => {'.length, end);
  const first = deferred(); const second = deferred(); const calls = []; const changes = [];
  const context = vm.createContext({ data: null, activeLifecycle: 'upcoming', quickBetRequest: { current: 0 },
    readQuickBetsCache: () => null, loadQuickBetsFromFirestore: (date, lifecycle) => { calls.push([date, lifecycle]); return calls.length === 1 ? first.promise : second.promise; },
    setData: value => changes.push(['data', value.selectedDate]), setMobileSelectedDate: value => changes.push(['date', value]),
    setLoading: value => changes.push(['loading', value]), setError: () => {} });
  const mount = vm.runInContext(`() => {${body}\n}`, context);
  const cleanup = mount(); cleanup(); context.quickBetRequest.current++; context.activeLifecycle = 'result'; mount();
  first.resolve({ selectedDate: '2026-09-14' }); second.resolve({ selectedDate: '2026-09-10' });
  await Promise.all([first.promise, second.promise]); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, [['', 'upcoming'], ['', 'result']]);
  assert.deepEqual(changes.filter(change => change[0] === 'data'), [['data', '2026-09-10']]);
  assert.deepEqual(changes.at(-1), ['loading', false]);
});

test('same-date lifecycle switch replaces pending navigation and returning to loaded day clears its error', async () => {
  const page = source('app/dashboard/quick-bets/page.jsx');
  const start = page.indexOf('  useEffect(() => {\n    if (!data || !mobileCurrentDate');
  const end = page.indexOf('\n  }, [mobileCurrentDate, Boolean(data), activeLifecycle]);', start);
  assert.ok(start >= 0 && end > start);
  const body = page.slice(start + '  useEffect(() => {'.length, end);
  const first = deferred(); const second = deferred(); const calls = []; const changes = [];
  const context = vm.createContext({ data: { selectedDate: '2026-09-10' }, mobileCurrentDate: '2026-09-13', activeLifecycle: 'upcoming', quickBetRequest: { current: 0 },
    readQuickBetsCache: () => null, loadQuickBetsFromFirestore: (date, lifecycle) => { calls.push([date, lifecycle]); return calls.length === 1 ? first.promise : second.promise; },
    setData: value => changes.push(['data', value.selectedDate]), setLoading: value => changes.push(['loading', value]), setDayError: value => changes.push(['error', value]) });
  const navigate = vm.runInContext(`() => {${body}\n}`, context);
  const cleanup = navigate(); cleanup(); context.quickBetRequest.current++; context.activeLifecycle = 'result'; navigate();
  first.resolve({ selectedDate: '2026-09-13', stale: true }); second.resolve({ selectedDate: '2026-09-13' });
  await Promise.all([first.promise, second.promise]); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(calls, [['2026-09-13', 'upcoming'], ['2026-09-13', 'result']]);
  assert.equal(changes.filter(change => change[0] === 'data').length, 1);
  assert.deepEqual(changes.at(-1), ['loading', false]);
  context.mobileCurrentDate = '2026-09-10'; navigate();
  assert.deepEqual(changes.at(-1), ['error', '']);
});

test('StrictMode setup-cleanup-setup refreshes cached initial data with the surviving request owner', async () => {
  const page = source('app/dashboard/quick-bets/page.jsx');
  const start = page.indexOf('  useEffect(() => {\n    let cancelled = false;');
  const end = page.indexOf('\n  }, [activeLifecycle]);', start);
  const body = page.slice(start + '  useEffect(() => {'.length, end);
  const pending = deferred(); const changes = []; const quickBetRequest = { current: 0 };
  const cached = { selectedDate: '2026-09-13', matches: [] };
  const mount = vm.runInNewContext(`() => {${body}\n}`, { quickBetRequest, data: cached, activeLifecycle: 'upcoming',
    readQuickBetsCache: () => cached, loadQuickBetsFromFirestore: () => pending.promise,
    setData: value => changes.push(['data', value]), setMobileSelectedDate: value => changes.push(['date', value]),
    setLoading: value => changes.push(['loading', value]), setError: () => {} });
  const cleanup = mount(); cleanup(); mount();
  const fresh = { selectedDate: '2026-09-13', matches: [{ id: 'fresh' }] };
  pending.resolve(fresh);
  await pending.promise; await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(changes.filter(change => change[0] === 'data'), [['data', fresh]]);
  assert.deepEqual(changes.filter(change => change[0] === 'date'), [['date', '2026-09-13']]);
  assert.deepEqual(changes.at(-1), ['loading', false]);
});
