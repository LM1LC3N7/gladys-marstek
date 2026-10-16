import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, familyOf, generationOf, profileOf, versionOf } from '../src/profile.js';

test('families from the device names the batteries report', () => {
  const cases = {
    'VenusE 3.0': FAMILIES.VENUS_E,
    'VNSE3-0': FAMILIES.VENUS_E,
    VenusE: FAMILIES.VENUS_E2,
    'Venus E 2.0': FAMILIES.VENUS_E2,
    VenusC: FAMILIES.VENUS_C,
    VenusD: FAMILIES.VENUS_D,
    'Venus D': FAMILIES.VENUS_D,
    'VNSD-0': FAMILIES.VENUS_D,
    VenusA: FAMILIES.VENUS_A,
    'Venus A': FAMILIES.VENUS_A,
    'VenusA 3.0': FAMILIES.VENUS_A,
    'VNSA-0': FAMILIES.VENUS_A,
    'VNSEM-0': FAMILIES.VENUS_E_MINI,
    'Venus E mini': FAMILIES.VENUS_E_MINI,
    'VenusE Pro': FAMILIES.UNKNOWN,
    '': FAMILIES.UNKNOWN,
  };
  for (const [name, family] of Object.entries(cases)) {
    assert.equal(familyOf(name), family, name);
  }
  assert.equal(familyOf(undefined), FAMILIES.UNKNOWN);
});

test('firmware versions: integers, app labels and four-digit encodings', () => {
  assert.equal(versionOf(150), 150);
  assert.equal(versionOf('150'), 150);
  assert.equal(versionOf('150.9'), 150);
  assert.equal(versionOf(150.9), 150);
  assert.equal(versionOf('v150'), undefined);
  assert.equal(versionOf(-1), undefined);
  assert.equal(versionOf(null), undefined);
  assert.equal(generationOf(1476), 147);
  assert.equal(generationOf(1509), 150);
  assert.equal(generationOf(301), 301);
  assert.equal(generationOf(undefined), undefined);
});

test('Venus E 3.0: safe from Control 150, fragile before', () => {
  const recent = profileOf('VenusE 3.0', 150);
  assert.equal(recent.resetProne, false);
  assert.equal(recent.batteryStatus, true);
  assert.equal(recent.retries, true);
  assert.equal(recent.ups, true);
  assert.equal(recent.pv, false);
  assert.equal(recent.meterEnergyWh, 0.1);
  assert.equal(recent.maxPower, 2500);

  // App 147.6: the Open API may switch itself off, Bat.GetStatus is never sent.
  const old = profileOf('VenusE 3.0', 1476);
  assert.equal(old.generation, 147);
  assert.equal(old.resetProne, true);
  assert.equal(old.batteryStatus, false);
  assert.equal(old.retries, false);
  assert.equal(old.ups, false);
  assert.equal(old.meterEnergyWh, 1);
});

test('Venus A/D: PV, and solar energy in 0.01 kWh from 149 (Venus A app 148.7 too)', () => {
  assert.equal(profileOf('VenusA', 148).pvEnergyWh, 1);
  assert.equal(profileOf('VenusA', 1487).pvEnergyWh, 10);
  assert.equal(profileOf('VenusA', 149).pvEnergyWh, 10);
  assert.equal(profileOf('VenusD', 149).pvEnergyWh, 10);
  assert.equal(profileOf('VenusD', 147).pvEnergyWh, 1);
  assert.equal(profileOf('VenusE 3.0', 150).pvEnergyWh, 10);
  assert.equal(profileOf('VenusA', 150).maxPower, 1500);
  assert.equal(profileOf('VenusD', 150).maxPower, 2200);
  assert.ok(profileOf('VenusD', 150).pv);
});

test('HMG-50 (Venus C, Venus E 2.0): shared Wi-Fi channel, meter from 155, stable from 156', () => {
  const c153 = profileOf('VenusC', 153);
  assert.equal(c153.sharedChannel, true);
  assert.equal(c153.meter, false);
  assert.equal(c153.resetProne, true);
  assert.equal(c153.ups, false);
  assert.equal(c153.retries, false);
  assert.equal(profileOf('VenusC', 155).meter, true);
  const e2 = profileOf('VenusE', 156);
  assert.equal(e2.resetProne, false);
  assert.equal(e2.retries, false, 'never a second datagram on the meter channel');
  assert.equal(e2.ups, false);
});

test('unknown models stay careful, the Venus E mini counts per day', () => {
  const unknown = profileOf('VenusE Pro', undefined);
  assert.equal(unknown.batteryStatus, false);
  assert.equal(unknown.retries, false);
  assert.equal(profileOf('VenusE Pro', 120).resetProne, true);
  assert.equal(profileOf('VenusE Pro', 1508).batteryStatus, true);
  assert.equal(profileOf('VNSEM-0', 301).dailyCounters, true);
  assert.equal(profileOf('VenusE 3.0', 150).dailyCounters, false);
});
