import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  FEATURES,
  MODES,
  modeConfig,
  modeOf,
  modesFor,
  pvChannelsPower,
  readValues,
  temperatureOf,
} from '../src/catalog.js';
import { profileOf } from '../src/profile.js';
import { VENUS_A, VENUS_C, VENUS_E3 } from './fixtures/answers.js';

const answersOf = (fixture) => ({
  es: fixture['ES.GetStatus'],
  mode: fixture['ES.GetMode'],
  meter: fixture['EM.GetStatus']?.error ? undefined : fixture['EM.GetStatus'],
  battery: fixture['Bat.GetStatus'],
  pv: fixture['PV.GetStatus']?.error ? undefined : fixture['PV.GetStatus'],
});

test('Venus E 3.0: battery from the power balance, CT meter, counters', () => {
  const values = readValues(answersOf(VENUS_E3), profileOf('VenusE 3.0', 150));
  assert.deepEqual(values, {
    soc: 98,
    output_power: 512,
    off_grid_power: 0,
    // No bat_power on this firmware: 0 W of PV - 512 W out - 0 W off-grid.
    charge_power: 0,
    discharge_power: 512,
    charged_energy: 3.273,
    discharged_energy: 2.548,
    // EM.GetStatus, not the zeros of ES.GetMode; import > 0.
    grid_power: 115,
    grid_power_l1: 120,
    grid_power_l2: -40,
    grid_power_l3: 35,
    // 0.1 Wh from Control 150.
    grid_import: 3086.32,
    grid_export: 448.751,
    temperature: 25,
    mode: 'auto',
  });
});

test('Venus A 149: PV channels when ES says 0, solar energy in 0.01 kWh, charging', () => {
  const values = readValues(answersOf(VENUS_A), profileOf('VenusA', 149));
  // Channel 1 in 0.1 W: 268 W + 29 W.
  assert.equal(values.pv_power, 297);
  assert.equal(values.pv_energy, 259.68);
  // On-grid -200 W: drawing to charge, nothing delivered.
  assert.equal(values.output_power, 0);
  assert.equal(values.off_grid_power, 30);
  // 297 W of PV + 200 W from the grid - 30 W off-grid.
  assert.equal(values.charge_power, 467);
  assert.equal(values.discharge_power, 0);
  assert.equal(values.discharged_energy, 233.453);
  assert.equal(values.soc, 49);
  assert.equal(values.mode, 'passive');
  // No CT connected: no grid feature.
  assert.equal(values.grid_power, undefined);
  assert.equal(values.grid_import, undefined);
  assert.equal(values.temperature, 21.5);
});

test('Venus C: bat_power when the firmware sends it, zero counters left out', () => {
  const values = readValues(answersOf(VENUS_C), profileOf('VenusC', 153));
  assert.equal(values.discharge_power, 300);
  assert.equal(values.charge_power, 0);
  assert.equal(values.off_grid_energy, undefined);
  assert.equal(values.pv_power, undefined, 'no PV on a Venus C');
  assert.equal(values.mode, 'ai');
});

test('placeholders of a silent battery management system are not values', () => {
  const profile = profileOf('VenusE 3.0', 150);
  const silentBms = readValues(
    {
      es: { bat_soc: 0, bat_cap: 0 },
      mode: { bat_soc: 0 },
      battery: { soc: 0, bat_temp: 0, rated_capacity: 0 },
    },
    profile,
  );
  assert.equal(silentBms.soc, undefined);
  assert.equal(silentBms.temperature, undefined);
  // A real empty battery still reads 0 %.
  assert.equal(readValues({ es: { bat_soc: 0, bat_cap: 5120 } }, profile).soc, 0);
  // ES silent: ES.GetMode, then Bat.GetStatus (soc as a string).
  assert.equal(readValues({ mode: { bat_soc: 77 } }, profile).soc, 77);
  assert.equal(readValues({ battery: { soc: '66', rated_capacity: 5120 } }, profile).soc, 66);
});

test('powers sent as unsigned 16 bits, temperatures in tenths', () => {
  const values = readValues(
    { es: { ongrid_power: -1600, offgrid_power: 65526, pv_power: 0 } },
    profileOf('VenusE 3.0', 144),
  );
  // -10 W off-grid is no output; the balance uses -10 W.
  assert.equal(values.off_grid_power, 0);
  assert.equal(values.charge_power, 1610);
  assert.equal(temperatureOf({ bat_temp: 280 }), 28);
  assert.equal(temperatureOf({ bat_temp: -5.5 }), -5.5);
  assert.equal(temperatureOf({ bat_temp: 2000 }), undefined);
  assert.equal(temperatureOf(undefined), undefined);
});

test('PV channels: channel 1 in 0.1 W, the single-channel form too', () => {
  assert.equal(pvChannelsPower(undefined), undefined);
  assert.equal(pvChannelsPower({ pv1_power: 1000, pv2_power: 50 }), 150);
  assert.equal(pvChannelsPower({ pv_power: 2500 }), 250);
  assert.equal(pvChannelsPower({ pv1_power: 'unknown' }), undefined);
});

test('the Venus E mini resets its counters at midnight: no index', () => {
  const values = readValues(answersOf(VENUS_E3), profileOf('VNSEM-0', 301));
  assert.equal(values.charged_energy, undefined);
  assert.equal(values.grid_import, undefined);
  assert.equal(values.soc, 98);
});

test('modes: names, integers, and the ES.SetMode configs', () => {
  assert.equal(modeOf('Auto'), 'auto');
  assert.equal(modeOf('AI'), 'ai');
  assert.equal(modeOf('Ups'), 'ups');
  assert.equal(modeOf(3), 'passive');
  assert.equal(modeOf('2'), 'manual');
  assert.equal(modeOf('Turbo'), undefined);
  assert.equal(modeOf(null), undefined);
  assert.deepEqual(modeConfig('auto'), { mode: 'Auto', auto_cfg: { enable: 1 } });
  assert.deepEqual(modeConfig('ai'), { mode: 'AI', ai_cfg: { enable: 1 } });
  assert.deepEqual(modeConfig('ups'), { mode: 'UPS', ups_cfg: { enable: 1 } });
  assert.deepEqual(modeConfig('passive', { power: -1300.4, minutes: 90 }), {
    mode: 'Passive',
    passive_cfg: { power: -1300, cd_time: 5400 },
  });
  assert.equal(modeConfig('manual'), undefined, 'the schedule belongs to the app');
  assert.deepEqual(
    modesFor(profileOf('VenusE 3.0', 1476)).map((m) => m.value),
    ['auto', 'ai', 'manual', 'passive'],
  );
  assert.equal(modesFor(profileOf('VenusE 3.0', 150)).length, MODES.length);
});

test('features: Gladys categories, types and the units each category accepts', () => {
  const C = DEVICE_FEATURE_CATEGORIES;
  const U = DEVICE_FEATURE_UNITS;
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the Gladys core (server/utils/constants.js).
  const allowed = {
    [C.BATTERY_STORAGE]: [U.PERCENT, U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
    [C.HOME_OUTPUT_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
    [C.GRID_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
    [C.ENERGY_PRODUCTION_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
    [C.DEVICE_TEMPERATURE_SENSOR]: [U.CELSIUS, U.FAHRENHEIT],
    [C.DURATION]: [U.SECONDS, U.MINUTES],
  };
  const types = Object.values(DEVICE_FEATURE_TYPES).flatMap((t) => Object.values(t));
  const keys = new Set();
  for (const f of FEATURES) {
    assert.ok(!keys.has(f.key), `${f.key} twice`);
    keys.add(f.key);
    assert.match(f.key, /^[a-z0-9_]+$/);
    assert.ok(Object.values(C).includes(f.category), f.key);
    assert.ok(types.includes(f.type), f.key);
    if (allowed[f.category]) {
      assert.ok(allowed[f.category].includes(f.unit), `${f.key}: ${f.unit} in ${f.category}`);
    }
  }
  // Energy indexes feed the Gladys energy views.
  const pvIndex = FEATURES.find((f) => f.key === 'pv_energy');
  assert.equal(pvIndex.type, DEVICE_FEATURE_TYPES.ENERGY_PRODUCTION_SENSOR.INDEX);
  assert.equal(pvIndex.unit, U.KILOWATT_HOUR);
});
