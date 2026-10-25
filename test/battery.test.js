import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battery, identityOf, normalizeMac } from '../src/battery.js';
import { EVERY } from '../src/constants.js';
import { buildDevice, deviceNames, displayName } from '../src/devices.js';
import { METHODS } from '../src/protocol.js';
import { E3_MAC, VENUS_C, VENUS_E3 } from './fixtures/answers.js';

const ids = (type, id) => ({
  device: `ext:test:${type}:${id}`,
  feature: (key) => `ext:test:${type}:${id}:${key}`,
});

function e3() {
  const battery = new Battery({ host: '192.168.1.40', port: 30000, typed: true });
  battery.identify(identityOf(VENUS_E3['Marstek.GetDevice']));
  for (const method of [METHODS.ES_STATUS, METHODS.ES_MODE, METHODS.METER, METHODS.BATTERY]) {
    battery.record(method, VENUS_E3[method]);
  }
  return battery;
}

test('identity: the Bluetooth MAC, else the end of src, never the Wi-Fi MAC (the access point)', () => {
  assert.equal(normalizeMac('A1:B2:C3:D4:E5:F6'), 'a1b2c3d4e5f6');
  assert.equal(normalizeMac('000000000000'), undefined);
  assert.equal(normalizeMac('0'), undefined);
  assert.deepEqual(identityOf(VENUS_E3['Marstek.GetDevice']), {
    mac: E3_MAC,
    device: 'VenusE 3.0',
    ver: '150',
    ip: '192.168.1.40',
  });
  assert.equal(identityOf(VENUS_C['Marstek.GetDevice'], 'VenusC-112233445566').mac, '112233445566');
  assert.equal(identityOf({ device: 'VenusE 3.0', wifi_mac: 'f0f1f2f3f4f5' }), undefined);
  assert.equal(identityOf(null), undefined);
});

test('a round: GetDevice first, then the methods the firmware supports, slow ones now and then', () => {
  const battery = new Battery({ host: '192.168.1.40', port: 30000 });
  assert.deepEqual(battery.due(), [METHODS.DEVICE]);
  battery.identify(identityOf(VENUS_E3['Marstek.GetDevice']));
  assert.deepEqual(battery.due(), [
    METHODS.ES_STATUS,
    METHODS.METER,
    METHODS.ES_MODE,
    METHODS.BATTERY,
  ]);
  battery.rounds = 1;
  assert.deepEqual(battery.due(), [METHODS.ES_STATUS, METHODS.METER, METHODS.ES_MODE]);
  battery.rounds = EVERY.device;
  assert.deepEqual(battery.due(), [
    METHODS.DEVICE,
    METHODS.ES_STATUS,
    METHODS.METER,
    METHODS.ES_MODE,
    METHODS.BATTERY,
  ]);
  battery.unsupported.add(METHODS.METER);
  assert.ok(!battery.due().includes(METHODS.METER));

  // Venus C 153: no meter before 155, no Bat.GetStatus on a fragile Open API.
  const c = new Battery({ host: '192.168.1.42', port: 30000 });
  c.identify(identityOf(VENUS_C['Marstek.GetDevice'], 'VenusC-112233445566'));
  assert.deepEqual(c.due(), [METHODS.ES_STATUS, METHODS.ES_MODE]);
  c.lastRound = 1000;
  assert.ok(c.waitsFor(30_000, 60_000));
  assert.ok(!c.waitsFor(61_000, 60_000));
});

test('values: the passive settings come with the mode, the phases with a three-phase CT', () => {
  const battery = e3();
  const values = battery.values();
  assert.equal(values.passive_power, 0);
  assert.equal(values.passive_duration, 60);
  assert.equal(values.grid_power_l2, -40);
  assert.ok(battery.offered.has('grid_power_l3'));

  const single = e3();
  single.record(METHODS.METER, { ...VENUS_E3['EM.GetStatus'], b_power: 0, c_power: 0 });
  const singleValues = single.values();
  assert.equal(singleValues.grid_power, 115);
  assert.equal(singleValues.grid_power_l1, undefined, 'single phase: the total says it all');
});

test('counters only go up, unless the lower value lasts (reset on the battery)', () => {
  const battery = e3();
  assert.equal(battery.values().charged_energy, 3.273);
  battery.record(METHODS.ES_STATUS, { ...VENUS_E3['ES.GetStatus'], total_grid_input_energy: 100 });
  for (let i = 0; i < 9; i += 1) {
    assert.equal(battery.values().charged_energy, 3.273, `glitch ${i}`);
  }
  assert.equal(battery.values().charged_energy, 0.1, 'the tenth lower reading is a reset');
  battery.record(METHODS.ES_STATUS, { ...VENUS_E3['ES.GetStatus'], total_grid_input_energy: 4000 });
  assert.equal(battery.values().charged_energy, 4);
});

test('the Gladys device: MAC external id, params, features, mode options, passive bounds', () => {
  const battery = e3();
  battery.values();
  const device = buildDevice(battery, ids);
  assert.equal(device.name, 'Marstek Venus E 3.0');
  assert.equal(device.external_id, `ext:test:battery:${E3_MAC}`);
  assert.deepEqual(device.params, [
    { name: 'IP_ADDRESS', value: '192.168.1.40' },
    { name: 'MARSTEK_PORT', value: '30000' },
    { name: 'MARSTEK_MAC', value: E3_MAC },
    { name: 'MARSTEK_MODEL', value: 'VenusE 3.0' },
    { name: 'MARSTEK_FIRMWARE', value: '150' },
  ]);
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.deepEqual(Object.keys(byKey), [
    'soc',
    'charge_power',
    'discharge_power',
    'charged_energy',
    'discharged_energy',
    'output_power',
    'off_grid_power',
    'grid_power',
    'grid_power_l1',
    'grid_power_l2',
    'grid_power_l3',
    'grid_import',
    'grid_export',
    'temperature',
    'mode',
    'passive_power',
    'passive_duration',
  ]);
  assert.equal(byKey.soc.read_only, true);
  assert.equal(byKey.mode.read_only, false);
  assert.equal(byKey.mode.keep_history, false);
  assert.deepEqual(
    byKey.mode.supported_options.map((o) => o.value),
    ['auto', 'ai', 'manual', 'passive', 'ups'],
  );
  // The core refuses the whole publication unless every label is a plain string
  // (forum topic 11402: "[0].label must be a string").
  for (const option of byKey.mode.supported_options) {
    assert.equal(typeof option.label, 'string', `label of ${option.value}`);
    assert.ok(option.label.length > 0);
    assert.equal(typeof option.sort_order, 'number');
  }
  assert.equal(byKey.mode.supported_options[0].label, 'Self-consumption (Auto)');
  assert.equal(byKey.passive_power.min, -2500);
  assert.equal(byKey.passive_power.max, 2500);
  assert.equal(byKey.passive_power.read_only, false);
  assert.equal(byKey.passive_duration.unit, 'minutes');
});

test('names: the model, the end of the MAC when two batteries share it', () => {
  assert.equal(displayName('VenusE 3.0'), 'Marstek Venus E 3.0');
  assert.equal(displayName('VNSA-0'), 'Marstek VNSA-0');
  assert.equal(displayName(''), 'Marstek battery');
  const a = e3();
  const b = new Battery({ host: '192.168.1.43', port: 30000 });
  b.identify({ mac: 'ffeeddccbbaa', device: 'VenusE 3.0', ver: '150' });
  const names = deviceNames([a, b]);
  assert.equal(names.get(a), 'Marstek Venus E 3.0 e5f6');
  assert.equal(names.get(b), 'Marstek Venus E 3.0 bbaa');
});
