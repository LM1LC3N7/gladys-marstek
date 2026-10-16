// -----------------------------------------------------------------------------
// The JSON-RPC messages of Marstek's Open API (pure).
//
// Request:  {"id":1,"method":"ES.GetStatus","params":{"id":0}}
// Answer:   {"id":1,"src":"VenusE 3.0-<mac>","result":{"id":0,...}}
// Error:    {"id":1,"src":"...","error":{"code":-32601,"message":"Method not found"}}
//
// `params.id` is the device instance (always 0 on a single battery);
// discovery asks `Marstek.GetDevice` with `{"ble_mac":"0"}`, which every
// battery on the network answers.
// -----------------------------------------------------------------------------

export const METHODS = {
  DEVICE: 'Marstek.GetDevice',
  WIFI: 'Wifi.GetStatus',
  BATTERY: 'Bat.GetStatus',
  PV: 'PV.GetStatus',
  ES_STATUS: 'ES.GetStatus',
  ES_MODE: 'ES.GetMode',
  ES_SET_MODE: 'ES.SetMode',
  METER: 'EM.GetStatus',
};

/** JSON-RPC error codes the batteries use. */
export const RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

/** The discovery request every battery answers (broadcast through the Gladys core). */
export const DISCOVERY_PARAMS = { ble_mac: '0' };

export function encodeRequest(id, method, params = { id: 0 }) {
  return Buffer.from(JSON.stringify({ id, method, params }));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A datagram -> { id, src, result } | { id, src, error: { code, message } },
 * or undefined when it is not a JSON-RPC answer.
 */
export function decodeAnswer(buffer) {
  let message;
  try {
    message = JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer));
  } catch {
    return undefined;
  }
  if (!isObject(message) || message.id === undefined || message.id === null) {
    return undefined;
  }
  const src = typeof message.src === 'string' ? message.src : undefined;
  const id = Number(message.id);
  if (!Number.isFinite(id)) {
    return undefined;
  }
  if (isObject(message.error)) {
    const code = Number(message.error.code);
    return {
      id,
      src,
      error: {
        code: Number.isFinite(code) ? code : undefined,
        message: typeof message.error.message === 'string' ? message.error.message : '',
      },
    };
  }
  if (isObject(message.result)) {
    return { id, src, result: message.result };
  }
  return undefined;
}
