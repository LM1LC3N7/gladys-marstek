import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_PARAMS, METHODS, decodeAnswer, encodeRequest } from '../src/protocol.js';

test('requests are compact JSON-RPC (the firmware drops more of the spaced ones)', () => {
  assert.equal(
    encodeRequest(7, METHODS.ES_STATUS).toString(),
    '{"id":7,"method":"ES.GetStatus","params":{"id":0}}',
  );
  assert.equal(
    encodeRequest(0, METHODS.DEVICE, DISCOVERY_PARAMS).toString(),
    '{"id":0,"method":"Marstek.GetDevice","params":{"ble_mac":"0"}}',
  );
});

test('answers: a result, an error, or nothing usable', () => {
  assert.deepEqual(
    decodeAnswer(
      Buffer.from('{"id":1,"src":"VenusE 3.0-a1b2c3d4e5f6","result":{"id":0,"bat_soc":98}}'),
    ),
    {
      id: 1,
      src: 'VenusE 3.0-a1b2c3d4e5f6',
      result: { id: 0, bat_soc: 98 },
    },
  );
  assert.deepEqual(
    decodeAnswer(
      '{"id":"3","src":"VenusE","error":{"code":-32601,"message":"Method not found","data":424}}',
    ),
    { id: 3, src: 'VenusE', error: { code: -32601, message: 'Method not found' } },
  );
  for (const junk of [
    '',
    'not json',
    '[]',
    '{"id":1}',
    '{"result":{}}',
    '{"id":"x","result":{}}',
    '{"id":1,"result":"OK"}',
  ]) {
    assert.equal(decodeAnswer(Buffer.from(junk)), undefined, junk);
  }
});
