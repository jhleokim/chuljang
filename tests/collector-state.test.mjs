import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { SOURCES, allowedUrl, safeReadLink } from '../collector/providers.js';
import { scanReceiptPage } from '../collector/scan.js';
import { applyReceiptDates } from '../collector/date-filter.js';
import { normalizeDates, matchTravelDate } from '../collector/date-scope.js';
import { sealCollector, openCollector, signCollector, verifyCollector } from '../lib/collector-security.ts';

// Only the Cloudflare platform/browser boundary
// is mocked: the class, transport handler, date helpers, and crypto are real.
const projectRequire = createRequire(new URL('../package.json', import.meta.url));
const ts = projectRequire('typescript');
const { z } = projectRequire('zod');
const source = await readFile(new URL('../server-collector/index.ts', import.meta.url), 'utf8');
const transformed = source
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export class ReceiptConnection', 'class ReceiptConnection')
  .replace('export default ', 'const worker = ');
assert.ok(transformed.includes('class ReceiptConnection'), 'actual class source must be loaded');
assert.ok(transformed.includes('const worker = '), 'actual transport source must be loaded');
const javascript = ts.transpileModule(transformed, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const secret = 'unit-test-only-collector-key-0123456789abcdefghijklmnopqrstuvwxyz';
const days = ['2026-09-09', '2026-09-11'];

function compile(overrides = {}) {
  const unavailable = async () => { throw new Error('Browser access is not permitted in these state tests'); };
  const bindings = {
    DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } },
    acquire: unavailable, connect: unavailable,
    endpointURLString: () => { throw new Error('No live browser endpoint in unit tests'); },
    z, SOURCES, allowedUrl, safeReadLink, scanReceiptPage, applyReceiptDates,
    normalizeDates, matchTravelDate, sealCollector, openCollector, verifyCollector,
    ...overrides,
  };
  return new Function(...Object.keys(bindings), javascript + '\nreturn { ReceiptConnection, worker };')(...Object.values(bindings));
}

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function memoryStorage() {
  let committed = new Map(), alarm = null, tail = Promise.resolve();
  const commits = [];
  let failNext = null;
  const copy = data => new Map([...data].map(([key, value]) => [key, clone(value)]));
  const operation = (name, key) => {
    if (failNext?.(name, key)) { failNext = null; throw new Error('Injected storage failure'); }
  };
  function handle(data, alarmState) {
    return {
      async get(key) { operation('get', key); return clone(data.get(key)); },
      async put(key, value) { operation('put', key); data.set(key, clone(value)); },
      async delete(keys) { operation('delete', keys); for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key); },
      async list() { operation('list'); return copy(data); },
      async setAlarm(value) { operation('setAlarm'); alarmState.value = value; },
      async deleteAlarm() { operation('deleteAlarm'); alarmState.value = null; },
    };
  }
  const storage = {
    async get(key) { await tail; return clone(committed.get(key)); },
    async put(key, value) { await tail; committed.set(key, clone(value)); },
    async delete(keys) { await tail; for (const key of Array.isArray(keys) ? keys : [keys]) committed.delete(key); },
    async list() { await tail; return copy(committed); },
    async setAlarm(value) { await tail; alarm = value; },
    async deleteAlarm() { await tail; alarm = null; },
    transaction(fn) {
      const result = tail.then(async () => {
        const draft = copy(committed), alarmState = { value: alarm };
        const value = await fn(handle(draft, alarmState));
        committed = draft; alarm = alarmState.value;
        commits.push({ values: copy(committed), alarm });
        return value;
      });
      tail = result.catch(() => {});
      return result;
    },
  };
  return {
    storage, commits,
    snapshot: () => copy(committed),
    alarm: () => alarm,
    failOnce(predicate) { failNext = predicate; },
  };
}

function harness(id = 'owner-alice:korail', implementation = compile()) {
  const memory = memoryStorage();
  const connection = new implementation.ReceiptConnection({ storage: memory.storage, id: { toString: () => id } }, { COLLECTOR_SECRET: secret });
  return { ...memory, connection };
}
function packet(block = '승차일 2026.09.09\n결제금액 59,800원') {
  return { version: 3, automatic: true, source: 'ktx', requestedDates: days, blocks: [block], sourceUrl: 'https://www.korail.com/ticket/mypage/ticketInfo/receipt' };
}
async function seedCapture(h, id = crypto.randomUUID(), value = packet()) {
  const meta = await h.connection.getMeta();
  await h.connection.putSecret('capture:' + id, value, meta.generation, id);
  return id;
}

test('new collection requires consent and snapshots normalized, noncontiguous dates', async () => {
  const h = harness(), jobId = crypto.randomUUID();
  const denied = await h.connection.start('korail', days, false, jobId, 0);
  assert.match(denied.error, /권한/);
  assert.equal(h.snapshot().size, 0);
  assert.equal(h.alarm(), null);
  const before = Date.now();
  const started = await h.connection.start('korail', [days[1], days[0], days[0]], true, jobId, 25000);
  assert.equal(started.state, 'queued');
  assert.deepEqual(started.requestedDates, days);
  assert.ok(started.consentedAt);
  const commit = h.commits.at(-1);
  assert.equal(commit.values.get('meta').jobId, jobId);
  assert.ok(commit.alarm >= before + 26000, 'queued state and alarm are in the same commit');
  await assert.rejects(h.connection.start('korail', [], true, crypto.randomUUID(), 0));
  assert.deepEqual((await h.connection.status()).requestedDates, days);
});

test('a failed alarm write does not strand a queued job without an alarm', async () => {
  const h = harness();
  h.failOnce(operation => operation === 'setAlarm');
  await assert.rejects(h.connection.start('korail', days, true, crypto.randomUUID(), 0), /Injected storage failure/);
  assert.equal(h.snapshot().size, 0);
  assert.equal(h.alarm(), null);
});

test('same job ID is idempotent after completion and conflicting dates are rejected', async () => {
  const h = harness(), jobId = crypto.randomUUID();
  await h.connection.start('korail', days, true, jobId, 0);
  const first = await h.connection.getMeta();
  await h.connection.patch(first.generation, { state: 'partial', count: 8, seen: ['already-collected'] });
  const snapshot = h.snapshot(), commits = h.commits.length, alarm = h.alarm();
  const repeat = await h.connection.start('korail', [...days].reverse(), false, jobId, 0);
  assert.equal(repeat.state, 'partial');
  assert.equal(repeat.count, 8);
  assert.deepEqual(h.snapshot(), snapshot);
  assert.deepEqual(h.commits.at(-1)?.values, snapshot);
  assert.equal(h.alarm(), alarm);
  const conflict = await h.connection.start('korail', ['2026-09-10'], true, jobId, 0);
  assert.match(conflict.error, /날짜/);
  assert.deepEqual(h.snapshot(), snapshot);
});

test('disconnect deletes old and orphaned secrets before close; concurrent reconnect survives', async () => {
  const h = harness();
  await h.connection.start('korail', days, true, crypto.randomUUID(), 0);
  const initial = await h.connection.getMeta();
  await h.connection.patch(initial.generation, { state: 'partial', connected: true, sessionId: 'old-session' });
  await h.connection.putSecret('auth', { cookies: [{ value: 'old-test-cookie' }] }, initial.generation);
  await seedCapture(h);
  await h.connection.putSecret('capture:orphaned-before-index', packet(), initial.generation);
  let signalClosing, releaseClose;
  const closing = new Promise(resolve => { signalClosing = resolve; });
  const closed = new Promise(resolve => { releaseClose = resolve; });
  const closeIds = [];
  h.connection.closeSession = async id => { closeIds.push(id); signalClosing(); await closed; };
  const revoking = h.connection.stop(true);
  await closing;
  try {
    assert.equal((await h.connection.status()).state, 'disconnected');
    assert.equal((await h.connection.status()).pending, 0);
    assert.deepEqual([...h.snapshot().keys()].filter(key => /^(auth|capture):/.test(key)), []);
    assert.equal(h.alarm(), null);
    await h.connection.start('korail', days, true, crypto.randomUUID(), 0);
    const fresh = await h.connection.getMeta();
    await h.connection.putSecret('auth', { cookies: [{ value: 'new-test-cookie' }] }, fresh.generation);
    const newAlarm = h.alarm();
    releaseClose();
    await revoking;
    assert.deepEqual(await h.connection.getSecret('auth'), { cookies: [{ value: 'new-test-cookie' }] });
    assert.equal(h.alarm(), newAlarm);
    assert.equal((await h.connection.getMeta()).generation, fresh.generation);
    assert.deepEqual(closeIds, ['old-session']);
    await assert.rejects(h.connection.putSecret('capture:late', packet(), initial.generation, 'late'), error => error.constructor.name === 'Revoked');
    assert.equal(h.snapshot().has('capture:late:length'), false);
  } finally { releaseClose(); await revoking; }
});

test('capture payload/index and acknowledgment are atomic; delivery survives retries and instance reload', async () => {
  const h = harness();
  await h.connection.start('korail', days, true, crypto.randomUUID(), 0);
  const first = await seedCapture(h), second = await seedCapture(h), third = await seedCapture(h);
  const firstDelivery = await h.connection.captures([]);
  assert.deepEqual(firstDelivery.map(row => row.captureId), [first, second]);
  assert.deepEqual((await h.connection.captures([])).map(row => row.captureId), [first, second]);
  assert.deepEqual((await h.connection.captures([first])).map(row => row.captureId), [second, third]);
  const reloaded = new (compile().ReceiptConnection)(h.connection.ctx, h.connection.env);
  assert.deepEqual((await reloaded.captures([])).map(row => row.captureId), [first, second]);
  await h.connection.acknowledge(crypto.randomUUID());
  assert.equal((await h.connection.status()).pending, 3);
  h.failOnce((operation, key) => operation === 'put' && key === 'meta');
  await assert.rejects(h.connection.acknowledge(first), /Injected storage failure/);
  assert.equal((await h.connection.status()).pending, 3);
  assert.ok(h.snapshot().has('capture:' + first + ':length'));
  await h.connection.acknowledge(first);
  assert.equal((await h.connection.status()).pending, 2);
  assert.equal([...h.snapshot().keys()].some(key => key.startsWith('capture:' + first + ':')), false);
  const failed = crypto.randomUUID();
  h.failOnce((operation, key) => operation === 'put' && key === 'meta');
  await assert.rejects(seedCapture(h, failed), /Injected storage failure/);
  assert.equal([...h.snapshot().keys()].some(key => key.startsWith('capture:' + failed + ':')), false);
  assert.equal((await h.connection.status()).pending, 2);
});

test('encrypted browser state and capture chunks cannot be moved between owner/provider objects', async () => {
  const alice = harness('alice:korail'), bob = harness('bob:korail'), otherProvider = harness('alice:kobus');
  await alice.connection.start('korail', days, true, crypto.randomUUID(), 0);
  const meta = await alice.connection.getMeta();
  const sensitive = { cookies: [{ name: 'session', value: 'SYNTHETIC_PRIVATE_COOKIE' }], origins: [] };
  await alice.connection.putSecret('auth', sensitive, meta.generation);
  const id = await seedCapture(alice, undefined, packet('SYNTHETIC_PRIVATE_RECEIPT'));
  const stored = JSON.stringify([...alice.snapshot()]);
  assert.equal(stored.includes('SYNTHETIC_PRIVATE_COOKIE'), false);
  assert.equal(stored.includes('SYNTHETIC_PRIVATE_RECEIPT'), false);
  assert.deepEqual(await alice.connection.getSecret('auth'), sensitive);
  for (const foreign of [bob, otherProvider]) {
    for (const [key, value] of alice.snapshot()) await foreign.storage.put(key, value);
    await assert.rejects(foreign.connection.getSecret('auth'));
    await assert.rejects(foreign.connection.getSecret('capture:' + id));
  }
});

test('signed transport binds owner and provider; another owner cannot receive or acknowledge captures', async () => {
  const implementation = compile(), objects = new Map();
  const env = {
    COLLECTOR_SECRET: secret,
    CONNECTIONS: { getByName(name) { if (!objects.has(name)) objects.set(name, harness(name, implementation)); return objects.get(name).connection; } },
  };
  async function request(value, { timestamp = String(Date.now()), signedValue = value } = {}) {
    const body = JSON.stringify(value);
    return implementation.worker.fetch(new Request('https://collector.example.test/', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-collector-time': timestamp, 'x-collector-signature': await signCollector(secret, timestamp, JSON.stringify(signedValue)) }, body,
    }), env);
  }
  const start = { owner: 'alice', action: 'start', providers: ['korail'], requestedDates: days, consent: true, jobId: crypto.randomUUID() };
  assert.equal((await request(start)).status, 200);
  const alice = objects.get(JSON.stringify(['alice', 'korail']));
  const id = await seedCapture(alice);
  const bobStatus = await (await request({ owner: 'bob', action: 'status' })).json();
  assert.deepEqual(bobStatus.captures, []);
  assert.equal((await request({ owner: 'bob', action: 'ack', provider: 'korail', captureId: id })).status, 200);
  assert.equal((await alice.connection.status()).pending, 1);
  const aliceStatus = await (await request({ owner: 'alice', action: 'status' })).json();
  assert.deepEqual(aliceStatus.captures.map(row => row.captureId), [id]);
  assert.equal((await request({ owner: 'bob', action: 'status' }, { signedValue: { owner: 'alice', action: 'status' } })).status, 401);
  assert.equal((await request({ owner: 'alice', action: 'status' }, { timestamp: String(Date.now() - 120000) })).status, 401);
  assert.equal((await request({ ...start, providers: ['unknown-provider'] })).status, 400);
  assert.equal((await request({ owner: 'alice', action: 'ack', provider: 'kobus', captureId: id })).status, 200);
  assert.equal((await alice.connection.status()).pending, 1);
  assert.equal((await request({ owner: 'alice', action: 'ack', provider: 'korail', captureId: id })).status, 200);
  assert.equal((await alice.connection.status()).pending, 0);
});
