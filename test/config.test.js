import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseAddresses } from '../src/config.js';
import { POLL_INTERVAL } from '../src/constants.js';

test('the defaults: no address, Discovery finds the batteries', () => {
  assert.deepEqual(normalizeConfig(), {
    addresses: [],
    invalidAddresses: [],
    pollInterval: POLL_INTERVAL.default,
  });
  assert.equal(DEFAULTS.poll_interval, 30);
});

test('addresses: IPs and names, an optional port, any separator, no duplicate', () => {
  assert.deepEqual(
    parseAddresses(' 192.168.1.40, 192.168.1.41:30001;venus-e.lan\n192.168.1.40:30000 '),
    {
      addresses: [
        { host: '192.168.1.40', port: 30000 },
        { host: '192.168.1.41', port: 30001 },
        { host: 'venus-e.lan', port: 30000 },
      ],
      invalid: [],
    },
  );
  assert.deepEqual(parseAddresses('300.1.1.1, http://x, 10.0.0.1:0, 10.0.0.1:70000, a_b').invalid, [
    '300.1.1.1',
    'http://x',
    '10.0.0.1:0',
    '10.0.0.1:70000',
    'a_b',
  ]);
  assert.deepEqual(parseAddresses(null), { addresses: [], invalid: [] });
});

test('the polling interval is kept within its bounds', () => {
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, POLL_INTERVAL.min);
  assert.equal(normalizeConfig({ poll_interval: 9999 }).pollInterval, POLL_INTERVAL.max);
  assert.equal(normalizeConfig({ poll_interval: '45' }).pollInterval, 45);
  assert.equal(normalizeConfig({ poll_interval: 'fast' }).pollInterval, POLL_INTERVAL.default);
  assert.equal(normalizeConfig({ poll_interval: null }).pollInterval, POLL_INTERVAL.default);
});
