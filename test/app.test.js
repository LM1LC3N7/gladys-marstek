// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake Open API client playing the batteries. Timers are mocked:
// the polling rounds and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { MarstekApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { METHODS } from '../src/protocol.js';
import {
  E3_MAC,
  VENUS_A,
  VENUS_A_MAC,
  VENUS_C,
  VENUS_C_MAC,
  VENUS_E3,
  reply,
} from './fixtures/answers.js';
import { FakeClient, settle, silent } from './helpers/fakeClient.js';

const E3_IP = '192.168.1.40';
const A_IP = '192.168.1.41';
const C_IP = '192.168.1.42';
const DEVICE_ID = (mac) => `ext:test-integration:battery:${mac}`;
const FEATURE_ID = (mac, key) => `${DEVICE_ID(mac)}:${key}`;
const ROUND = 30_000;

async function setup(
  t,
  { config = { addresses: E3_IP }, batteries = { [E3_IP]: VENUS_E3 }, devices, scanResults } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config, devices, scanResults });
  const client = new FakeClient(batteries);
  const app = new MarstekApp({ gladys, client, logger: silent, now: () => Date.now() });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, client, tick };
}

const discovered = (gladys, mac) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === DEVICE_ID(mac));
const featureKeys = (device) => device.features.map((f) => f.external_id.split(':').pop());
const feature = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
const lastTransport = (gladys, mac) =>
  gladys.fake.transports.filter((e) => e.device_external_id === DEVICE_ID(mac)).at(-1);

/** The user adds the battery from the Discovery tab. */
async function create(ctx, mac) {
  const device = discovered(ctx.gladys, mac);
  await ctx.gladys.fake.deviceCreated(device);
  await ctx.tick(TIMINGS.flushInterval);
  return device;
}

test('a typed address: identified, polled, offered with its features', async (t) => {
  const { gladys, client } = await setup(t);
  assert.deepEqual(client.methods(), [
    METHODS.DEVICE,
    METHODS.ES_STATUS,
    METHODS.METER,
    METHODS.ES_MODE,
    METHODS.BATTERY,
  ]);
  assert.deepEqual(client.calls[0].params, { ble_mac: '0' });
  assert.deepEqual(client.calls[1].params, { id: 0 });
  assert.equal(client.calls[0].port, 30000);
  // Venus E 3.0 150: read requests are sent again after a timeout.
  assert.deepEqual(client.calls[1].options, { retries: TIMINGS.requestRetries });

  const device = discovered(gladys, E3_MAC);
  assert.equal(device.name, 'Marstek Venus E 3.0');
  assert.ok(featureKeys(device).includes('soc'));
  assert.ok(featureKeys(device).includes('grid_power'));
  assert.ok(!featureKeys(device).includes('pv_power'), 'no PV on a Venus E');
  assert.equal(device.should_poll, undefined, 'the integration polls by itself');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    '1 battery answers: Marstek Venus E 3.0 (192.168.1.40).',
  );
});

test('states flow once the device is created, every round', async (t) => {
  const ctx = await setup(t);
  const { gladys, client } = ctx;
  assert.equal(gladys.fake.states.length, 0, 'nothing before the device exists in Gladys');
  await create(ctx, E3_MAC);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'soc')), 98);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'discharge_power')), 512);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'grid_power')), 115);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'charged_energy')), 3.273);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'mode')), 'auto');
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'passive_duration')), 60);
  assert.deepEqual(lastTransport(gladys, E3_MAC), {
    device_external_id: DEVICE_ID(E3_MAC),
    transport: DEVICE_TRANSPORTS.LOCAL,
  });

  client.batteries[E3_IP]['ES.GetStatus'] = { ...VENUS_E3['ES.GetStatus'], bat_soc: 99 };
  const calls = client.calls.length;
  await ctx.tick(ROUND);
  await ctx.tick(TIMINGS.flushInterval);
  assert.deepEqual(client.methods().slice(calls), [
    METHODS.ES_STATUS,
    METHODS.METER,
    METHODS.ES_MODE,
  ]);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'soc')), 99);
});

test('Discovery: the core broadcasts Marstek.GetDevice, every battery that answers is offered', async (t) => {
  const ctx = await setup(t, {
    config: {},
    batteries: { [E3_IP]: VENUS_E3, [A_IP]: VENUS_A },
    scanResults: {
      'udp-active-broadcast': [
        reply(E3_IP, VENUS_E3['Marstek.GetDevice']),
        reply(A_IP, VENUS_A['Marstek.GetDevice']),
        // The same battery twice (two interfaces), and noise.
        reply(E3_IP, VENUS_E3['Marstek.GetDevice']),
        { source_ip: '192.168.1.99', source_port: 30000, payload_base64: 'bm90IGpzb24=' },
      ],
    },
  });
  const { gladys, client } = ctx;
  assert.equal(client.calls.length, 0, 'nothing typed, nothing found yet');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /open Discovery/);

  await gladys.fake.scanRequest();
  await settle();
  const [scan] = gladys.fake.scans;
  assert.equal(scan.type, 'udp-active-broadcast');
  assert.equal(scan.port, 30000);
  assert.equal(scan.timeout_seconds, TIMINGS.scanSeconds);
  assert.deepEqual(JSON.parse(Buffer.from(scan.payload_base64, 'base64')), {
    id: 0,
    method: 'Marstek.GetDevice',
    params: { ble_mac: '0' },
  });
  // Found by the broadcast: no unicast GetDevice needed.
  assert.ok(!client.methods(E3_IP).includes(METHODS.DEVICE));
  assert.equal(gladys.fake.discoveredDevices.length, 2);

  const venusA = discovered(gladys, VENUS_A_MAC);
  assert.equal(venusA.name, 'Marstek Venus A');
  assert.ok(featureKeys(venusA).includes('pv_power'));
  assert.ok(featureKeys(venusA).includes('pv_energy'));
  assert.ok(!featureKeys(venusA).includes('grid_power'), 'no CT on this one');
  assert.ok(!featureKeys(venusA).includes('temperature'), 'Bat.GetStatus never sent below 150');
  assert.equal(feature(venusA, 'passive_power').max, 1500);
  assert.deepEqual(
    feature(venusA, 'mode').supported_options.map((o) => o.value),
    ['auto', 'ai', 'manual', 'passive'],
    'no UPS mode before firmware 150',
  );
  // Venus A 149: one datagram per request, a longer wait.
  assert.ok(client.methods(A_IP).includes(METHODS.PV));
  assert.ok(!client.methods(A_IP).includes(METHODS.BATTERY));
  assert.deepEqual(client.calls.find((c) => c.host === A_IP).options, {
    timeout: TIMINGS.oneShotTimeout,
  });

  await create(ctx, VENUS_A_MAC);
  assert.equal(gladys.fake.lastState(FEATURE_ID(VENUS_A_MAC, 'pv_power')), 297);
  assert.equal(gladys.fake.lastState(FEATURE_ID(VENUS_A_MAC, 'pv_energy')), 259.68);
  assert.equal(gladys.fake.lastState(FEATURE_ID(VENUS_A_MAC, 'charge_power')), 467);
  // Fragile firmware: works, but the badge says to update it.
  const badge = lastTransport(gladys, VENUS_A_MAC);
  assert.equal(badge.transport, DEVICE_TRANSPORTS.LOCAL);
  assert.equal(badge.degraded, true);
  assert.match(badge.message.en, /Firmware 149 may turn its Open API off/);
  assert.match(badge.message.fr, /Le firmware 149/);
});

test('a battery that moved to another address is followed by its MAC', async (t) => {
  const ctx = await setup(t, {
    batteries: { '192.168.1.45': VENUS_E3 },
    scanResults: { 'udp-active-broadcast': [reply('192.168.1.45', VENUS_E3['Marstek.GetDevice'])] },
  });
  const { gladys } = ctx;
  // Typed .40 (the old address): silent.
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  await gladys.fake.scanRequest();
  await settle();
  const device = discovered(gladys, E3_MAC);
  assert.deepEqual(device.params[0], { name: 'IP_ADDRESS', value: '192.168.1.45' });
});

test('the devices created in Gladys are polled at start, with their passive settings', async (t) => {
  const ctx = await setup(t, {
    config: {},
    devices: [
      {
        name: 'Garage battery',
        external_id: DEVICE_ID(E3_MAC),
        params: [
          { name: 'IP_ADDRESS', value: E3_IP },
          { name: 'MARSTEK_PORT', value: '30000' },
          { name: 'MARSTEK_MAC', value: E3_MAC },
          { name: 'MARSTEK_MODEL', value: 'VenusE 3.0' },
          { name: 'MARSTEK_FIRMWARE', value: '150' },
        ],
        features: [
          { external_id: FEATURE_ID(E3_MAC, 'soc') },
          { external_id: FEATURE_ID(E3_MAC, 'passive_power'), last_value: -800 },
          { external_id: FEATURE_ID(E3_MAC, 'passive_duration'), last_value: 30 },
        ],
      },
    ],
  });
  const { gladys, client } = ctx;
  assert.equal(client.calls[0].method, METHODS.DEVICE, 'the firmware is checked first');
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'soc')), 98);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'passive_power')), -800);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'grid_power')), undefined, 'not created');

  await gladys.fake.setValue(
    discovered(gladys, E3_MAC),
    feature(discovered(gladys, E3_MAC), 'mode'),
    'passive',
  );
  const setMode = client.calls.find((c) => c.method === METHODS.ES_SET_MODE);
  assert.deepEqual(setMode.params, {
    id: 0,
    config: { mode: 'Passive', passive_cfg: { power: -800, cd_time: 1800 } },
  });
});

test('the operating mode: written with ES.SetMode, never twice', async (t) => {
  const ctx = await setup(t);
  const { gladys, client } = ctx;
  const device = await create(ctx, E3_MAC);
  const set = (key, value) => gladys.fake.setValue(device, feature(device, key), value);
  const lastSetMode = () => client.calls.filter((c) => c.method === METHODS.ES_SET_MODE).at(-1);

  await set('mode', 'ai');
  assert.deepEqual(lastSetMode().params, { id: 0, config: { mode: 'AI', ai_cfg: { enable: 1 } } });
  assert.deepEqual(lastSetMode().options, { timeout: TIMINGS.writeTimeout });
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'mode')), 'ai');

  await set('mode', 'ups');
  assert.deepEqual(lastSetMode().params.config, { mode: 'UPS', ups_cfg: { enable: 1 } });

  // Passive settings are kept, then used by the passive mode.
  await set('passive_power', -1500);
  await set('passive_duration', 120);
  assert.equal(lastSetMode().params.config.mode, 'UPS', 'not in passive mode: kept only');
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(FEATURE_ID(E3_MAC, 'passive_power')), -1500);
  await set('mode', 'passive');
  assert.deepEqual(lastSetMode().params.config, {
    mode: 'Passive',
    passive_cfg: { power: -1500, cd_time: 7200 },
  });
  // In passive mode, a new power applies at once.
  await set('passive_power', 800);
  assert.deepEqual(lastSetMode().params.config.passive_cfg, { power: 800, cd_time: 7200 });

  const count = client.calls.filter((c) => c.method === METHODS.ES_SET_MODE).length;
  const refused = [
    await set('mode', 'manual'),
    await set('mode', 'turbo'),
    await set('passive_power', 3000),
    await set('passive_duration', 0),
    await set('soc', 50),
  ];
  for (const ack of refused) {
    assert.ok(ack.error, JSON.stringify(ack));
  }
  assert.match(refused[0].error, /schedule set in the Marstek app/);
  assert.equal(client.calls.filter((c) => c.method === METHODS.ES_SET_MODE).length, count);

  client.batteries[E3_IP]['ES.SetMode'] = { id: 0, set_result: false };
  assert.match((await set('mode', 'auto')).error, /refused/);
});

test('a lost ES.SetMode answer: the mode is read back instead of sent again', async (t) => {
  const ctx = await setup(t);
  const { gladys, client } = ctx;
  const device = await create(ctx, E3_MAC);
  const set = (value) => gladys.fake.setValue(device, feature(device, 'mode'), value);
  client.batteries[E3_IP]['ES.SetMode'] = undefined;
  client.batteries[E3_IP]['ES.GetMode'] = { ...VENUS_E3['ES.GetMode'], mode: 'AI' };
  const ack = await set('ai');
  assert.ok(!ack.error, JSON.stringify(ack));
  assert.deepEqual(client.methods().slice(-2), [METHODS.ES_SET_MODE, METHODS.ES_MODE]);
  const failed = await set('auto');
  assert.match(failed.error, /did not answer/);
  assert.equal(client.methods().filter((m) => m === METHODS.ES_SET_MODE).length, 2);
});

test('transport badge: degraded when a request is lost, unreachable after three silent rounds', async (t) => {
  const ctx = await setup(t);
  const { gladys, client } = ctx;
  await create(ctx, E3_MAC);
  const answers = client.batteries[E3_IP];

  client.batteries[E3_IP] = { ...answers, 'EM.GetStatus': undefined };
  await ctx.tick(ROUND);
  const lossy = lastTransport(gladys, E3_MAC);
  assert.equal(lossy.transport, DEVICE_TRANSPORTS.LOCAL);
  assert.equal(lossy.degraded, true);
  assert.equal(lossy.message.en, 'No answer to EM.GetStatus in the last round.');

  client.batteries[E3_IP] = {};
  await ctx.tick(ROUND);
  await ctx.tick(ROUND);
  assert.equal(lastTransport(gladys, E3_MAC).transport, DEVICE_TRANSPORTS.LOCAL);
  await ctx.tick(ROUND);
  assert.deepEqual(lastTransport(gladys, E3_MAC), {
    device_external_id: DEVICE_ID(E3_MAC),
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No answer from Marstek Venus E 3.0/);

  client.batteries[E3_IP] = answers;
  await ctx.tick(ROUND);
  assert.deepEqual(lastTransport(gladys, E3_MAC), {
    device_external_id: DEVICE_ID(E3_MAC),
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a method the firmware does not have is not asked again', async (t) => {
  const ctx = await setup(t, {
    batteries: {
      [E3_IP]: {
        ...VENUS_E3,
        'EM.GetStatus': { error: { code: -32601, message: 'Method not found' } },
      },
    },
  });
  const { client } = ctx;
  const calls = client.calls.length;
  await ctx.tick(ROUND);
  assert.deepEqual(client.methods().slice(calls), [METHODS.ES_STATUS, METHODS.ES_MODE]);
});

test('Venus C (HMG-50): identified by src, polled once a minute at most', async (t) => {
  const ctx = await setup(t, { config: { addresses: C_IP }, batteries: { [C_IP]: VENUS_C } });
  const { gladys, client } = ctx;
  assert.deepEqual(client.methods(), [METHODS.DEVICE, METHODS.ES_STATUS, METHODS.ES_MODE]);
  const device = discovered(gladys, VENUS_C_MAC);
  assert.ok(featureKeys(device).includes('discharge_power'));
  const calls = client.calls.length;
  await ctx.tick(ROUND);
  assert.equal(client.calls.length, calls, 'the meter shares the Wi-Fi channel: wait');
  await ctx.tick(ROUND);
  assert.equal(client.calls.length, calls + 2);
});

test('a round still running skips the next tick (one request at a time)', async (t) => {
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = await setup(t, {
    batteries: {
      [E3_IP]: { ...VENUS_E3, 'ES.GetMode': () => undefined },
    },
  });
  const { app, client } = ctx;
  const realCall = client.call.bind(client);
  client.call = async (...args) => {
    if (args[2] === METHODS.ES_STATUS) {
      await slow;
    }
    return realCall(...args);
  };
  const calls = client.calls.length;
  await ctx.tick(ROUND);
  await ctx.tick(ROUND);
  assert.equal(client.calls.length, calls, 'still waiting for ES.GetStatus');
  assert.ok(app.polling);
  release();
  await settle();
  assert.deepEqual(client.methods().slice(calls), [
    METHODS.ES_STATUS,
    METHODS.METER,
    METHODS.ES_MODE,
  ]);
});

test('connection test: the broadcast, then each battery and its Wi-Fi signal', async (t) => {
  const ctx = await setup(t, {
    config: { addresses: `${E3_IP}, 192.168.1.50` },
    batteries: { [E3_IP]: VENUS_E3, [A_IP]: VENUS_A },
    scanResults: { 'udp-active-broadcast': [reply(A_IP, VENUS_A['Marstek.GetDevice'])] },
  });
  const ack = await ctx.gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Discovery broadcast: 1 battery answered. ' +
      'Marstek Venus E 3.0 at 192.168.1.40: OK (firmware 150, Wi-Fi -59 dBm). ' +
      '192.168.1.50: no answer. ' +
      'Marstek Venus A at 192.168.1.41: OK (firmware 149). ' +
      'For a silent battery, check that the Open API is on in the Marstek app (UDP port 30000 by default) and that Gladys reaches the battery.',
  );
  assert.match(ack.data.message.fr, /Diffusion de découverte : 1 batterie a répondu/);
});

test('a scan during a round: the batteries it finds are read at once', async (t) => {
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = await setup(t, {
    batteries: { [E3_IP]: VENUS_E3, [A_IP]: VENUS_A },
    scanResults: { 'udp-active-broadcast': [reply(A_IP, VENUS_A['Marstek.GetDevice'])] },
  });
  const { gladys, client } = ctx;
  const realCall = client.call.bind(client);
  client.call = async (...args) => {
    if (args[0] === E3_IP && args[2] === METHODS.ES_STATUS) {
      await slow;
    }
    return realCall(...args);
  };
  await ctx.tick(ROUND);
  const scan = gladys.fake.scanRequest();
  await settle();
  release();
  await scan;
  assert.ok(discovered(gladys, VENUS_A_MAC), 'offered right after the scan');
});

test('configuration: ignored addresses are said, a new configuration restarts', async (t) => {
  const ctx = await setup(t, { config: { addresses: '300.1.1.1' } });
  const { gladys, client } = ctx;
  assert.equal(client.calls.length, 0);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Ignored in the configuration.*300\.1\.1\.1/,
  );
  await gladys.fake.configUpdated({ addresses: E3_IP, poll_interval: 60 });
  await settle();
  assert.equal(client.calls[0].method, METHODS.DEVICE);
  const calls = client.calls.length;
  await ctx.tick(ROUND);
  assert.equal(client.calls.length, calls, 'every 60 s now');
  await ctx.tick(ROUND);
  assert.ok(client.calls.length > calls);
});
