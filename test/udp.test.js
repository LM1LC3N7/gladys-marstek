// -----------------------------------------------------------------------------
// The Open API client over real UDP sockets, on the loopback only (127.0.0.1):
// a fake battery answers like the firmware does. Short timings keep it fast.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { OpenApiClient, OpenApiError } from '../src/udp.js';
import { silent } from './helpers/fakeClient.js';

const HOST = '127.0.0.1';

/**
 * A battery on the loopback. `behave(request, n)` returns the answer body
 * (`{ result }`, `{ error }`), `null` for silence, or `{ delay, ...body }`.
 */
async function fakeBattery(t, behave) {
  const socket = dgram.createSocket('udp4');
  const requests = [];
  socket.on('message', (msg, rinfo) => {
    const request = JSON.parse(msg.toString());
    requests.push({ request, at: Date.now(), from: rinfo.port });
    const answer = behave(request, requests.length);
    if (!answer) {
      return;
    }
    const { delay = 0, ...body } = answer;
    const send = () =>
      socket.send(
        JSON.stringify({ id: request.id, src: 'VenusE 3.0-a1b2c3d4e5f6', ...body }),
        rinfo.port,
        rinfo.address,
      );
    if (delay) {
      setTimeout(send, delay);
    } else {
      send();
    }
  });
  await new Promise((resolve) => socket.bind(0, HOST, resolve));
  t.after(() => socket.close());
  return { port: socket.address().port, requests, socket };
}

function client(t, options = {}) {
  const c = new OpenApiClient({
    logger: silent,
    localPortFor: () => 0,
    timeout: 150,
    afterAnswer: 60,
    ...options,
  });
  t.after(() => c.close());
  return c;
}

test('a request, its answer, and the src of the battery', async (t) => {
  const battery = await fakeBattery(t, () => ({ result: { id: 0, bat_soc: 98 } }));
  const c = client(t);
  const answer = await c.call(HOST, battery.port, 'ES.GetStatus');
  assert.deepEqual(answer, { result: { id: 0, bat_soc: 98 }, src: 'VenusE 3.0-a1b2c3d4e5f6' });
  assert.deepEqual(battery.requests[0].request, {
    id: 1,
    method: 'ES.GetStatus',
    params: { id: 0 },
  });
});

test('the local port is the Open API port of the battery, any port when it is taken', async (t) => {
  // The fake battery holds its port on the loopback: binding it again fails.
  const battery = await fakeBattery(t, () => ({ result: { id: 0 } }));
  const infos = [];
  const c = client(t, {
    localPortFor: (port) => port,
    logger: { ...silent, info: (m) => infos.push(m) },
  });
  await c.call(HOST, battery.port, 'ES.GetMode');
  assert.notEqual(c.localPort(battery.port), battery.port);
  assert.match(infos[0], new RegExp(`Local UDP port ${battery.port} unavailable`));

  // A free port: the socket takes it, and the battery sees it as the source.
  const probe = dgram.createSocket('udp4');
  await new Promise((resolve) => probe.bind(0, HOST, resolve));
  const free = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const own = client(t, { localPortFor: () => free });
  await own.call(HOST, battery.port, 'ES.GetMode');
  assert.equal(own.localPort(battery.port), free);
  assert.equal(battery.requests.at(-1).from, free);
});

test('one request at a time, and a pause after each answer', async (t) => {
  const battery = await fakeBattery(t, () => ({ delay: 30, result: { id: 0 } }));
  const c = client(t, { afterAnswer: 80 });
  await Promise.all([
    c.call(HOST, battery.port, 'ES.GetStatus'),
    c.call(HOST, battery.port, 'EM.GetStatus'),
    c.call(HOST, battery.port, 'ES.GetMode'),
  ]);
  assert.deepEqual(
    battery.requests.map((r) => r.request.method),
    ['ES.GetStatus', 'EM.GetStatus', 'ES.GetMode'],
  );
  for (let i = 1; i < battery.requests.length; i += 1) {
    const gap = battery.requests[i].at - battery.requests[i - 1].at;
    // 30 ms to answer, then 80 ms of silence.
    assert.ok(gap >= 100, `request ${i} sent ${gap} ms after the previous one`);
  }
});

test('no answer: a timeout error, and the request sent again only when asked', async (t) => {
  const battery = await fakeBattery(t, () => null);
  const c = client(t);
  await assert.rejects(c.call(HOST, battery.port, 'ES.GetStatus'), (err) => {
    assert.ok(err instanceof OpenApiError);
    assert.equal(err.kind, 'timeout');
    return true;
  });
  assert.equal(battery.requests.length, 1);
  await assert.rejects(c.call(HOST, battery.port, 'ES.GetStatus', { id: 0 }, { retries: 2 }));
  assert.equal(battery.requests.length, 4);
  assert.deepEqual(
    battery.requests.slice(1).map((r) => r.request.id),
    [2, 3, 4],
    'a new id per attempt',
  );
});

test('a lost datagram: the retry gets the answer; a late answer to the first attempt counts too', async (t) => {
  const lost = await fakeBattery(t, (request, n) => (n === 1 ? null : { result: { id: 0, n } }));
  const c = client(t);
  const answer = await c.call(HOST, lost.port, 'ES.GetStatus', { id: 0 }, { retries: 1 });
  assert.equal(answer.result.n, 2);

  const slow = await fakeBattery(t, (request, n) =>
    n === 1 ? { delay: 200, result: { id: 0, n } } : null,
  );
  const late = await c.call(HOST, slow.port, 'ES.GetStatus', { id: 0 }, { retries: 1 });
  assert.equal(late.result.n, 1);
  assert.equal(slow.requests.length, 2);
});

test('errors of the battery, and answers that are not ours', async (t) => {
  const battery = await fakeBattery(t, (request) =>
    request.method === 'PV.GetStatus'
      ? { error: { code: -32601, message: 'Method not found', data: 424 } }
      : { id: request.id + 100, result: { id: 0 } },
  );
  const c = client(t);
  await assert.rejects(c.call(HOST, battery.port, 'PV.GetStatus'), (err) => {
    assert.equal(err.kind, 'rpc');
    assert.equal(err.code, -32601);
    assert.equal(err.message, 'Method not found');
    return true;
  });
  // Another id (an answer meant for another client): ignored, then timeout.
  await assert.rejects(c.call(HOST, battery.port, 'ES.GetStatus'), { kind: 'timeout' });
  // Another address: ignored too.
  c.current = { host: '192.0.2.1', ids: [1] };
  c.onMessage(Buffer.from('{"id":1,"result":{}}'), { address: HOST });
  assert.ok(c.current, 'still waiting');
  c.current = null;
});

test('closing rejects the call in flight and the next ones', async (t) => {
  const battery = await fakeBattery(t, () => null);
  const c = client(t, { timeout: 5000 });
  const pending = c.call(HOST, battery.port, 'ES.GetStatus');
  await new Promise((resolve) => setTimeout(resolve, 30));
  c.close();
  await assert.rejects(pending, { kind: 'closed' });
  await assert.rejects(c.call(HOST, battery.port, 'ES.GetStatus'), { kind: 'closed' });
  c.reopen();
  await assert.rejects(c.call(HOST, battery.port, 'ES.GetStatus', { id: 0 }, { timeout: 50 }), {
    kind: 'timeout',
  });
});
