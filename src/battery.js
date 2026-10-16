// -----------------------------------------------------------------------------
// One battery: where it is, who it is (Marstek.GetDevice), its last answers,
// which requests a round sends, and the guards on its values. No network.
// -----------------------------------------------------------------------------

import { ENERGY_INDEXES, PASSIVE_DEFAULTS, num, readValues } from './catalog.js';
import { EVERY } from './constants.js';
import { displayName } from './devices.js';
import { profileOf } from './profile.js';
import { METHODS } from './protocol.js';

/** The answers kept, by method. */
const SLOT = {
  [METHODS.ES_STATUS]: 'es',
  [METHODS.ES_MODE]: 'mode',
  [METHODS.METER]: 'meter',
  [METHODS.BATTERY]: 'battery',
  [METHODS.PV]: 'pv',
};

/** Readings lower than the last counter value before it counts as a reset. */
const RESET_AFTER = 10;

/** "24:21:5E:DB:17:8F", "24215edb178f" -> "24215edb178f"; anything else -> undefined. */
export function normalizeMac(raw) {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const mac = raw.replace(/[:-]/g, '').trim().toLowerCase();
  return /^[0-9a-f]{12}$/.test(mac) && !/^0+$/.test(mac) ? mac : undefined;
}

/**
 * The identity in a Marstek.GetDevice answer. The Bluetooth MAC names the
 * battery for good (its IP address may change), else the end of `src`
 * ("VenusE 3.0-24215edb178f"; the Venus C 153 leaves the MACs out). Never
 * `wifi_mac`: on the Venus E 3.0 it is the MAC of the Wi-Fi access point,
 * the same for every battery behind it.
 */
export function identityOf(result, src) {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const fromSrc = typeof src === 'string' ? normalizeMac(src.split('-').pop()) : undefined;
  const mac = normalizeMac(result.ble_mac) ?? fromSrc;
  if (!mac) {
    return undefined;
  }
  const device =
    typeof result.device === 'string' && result.device.trim() ? result.device.trim() : '';
  return {
    mac,
    device: device.slice(0, 50),
    ver:
      result.ver === undefined || result.ver === null ? undefined : String(result.ver).slice(0, 20),
    ip: typeof result.ip === 'string' ? result.ip : undefined,
  };
}

export class Battery {
  /**
   * @param {{ host: string, port: number, mac?: string, device?: string,
   *   ver?: string, typed?: boolean }} where
   */
  constructor({ host, port, mac, device = '', ver, typed = false }) {
    this.host = host;
    this.port = port;
    this.typed = typed;
    this.mac = mac;
    this.device = device;
    this.ver = ver;
    this.profile = profileOf(device, ver);
    /** Marstek.GetDevice answered since the start (or the identity came from Gladys). */
    this.identified = false;
    this.answers = {};
    this.unsupported = new Set();
    this.rounds = 0;
    /** Rounds in a row without any answer. */
    this.failures = 0;
    /** Methods that did not answer in the last round. */
    this.missed = [];
    this.lastRound = undefined;
    /** Feature keys that carried a value since the start. */
    this.offered = new Set();
    this.counters = new Map();
    this.lower = new Map();
    this.passive = { ...PASSIVE_DEFAULTS };
  }

  get key() {
    return this.mac ? `mac:${this.mac}` : `addr:${this.host}:${this.port}`;
  }

  get label() {
    return `${displayName(this.device)} (${this.host})`;
  }

  /** A Marstek.GetDevice answer. Returns false when it names another battery. */
  identify(identity) {
    if (this.mac && identity.mac !== this.mac) {
      return false;
    }
    this.mac = identity.mac;
    if (identity.device) {
      this.device = identity.device;
    }
    if (identity.ver !== undefined) {
      this.ver = identity.ver;
    }
    this.profile = profileOf(this.device, this.ver);
    this.identified = true;
    return true;
  }

  /** The requests of the next round, in order. */
  due() {
    if (!this.identified) {
      return [METHODS.DEVICE];
    }
    const r = this.rounds;
    const p = this.profile;
    const methods = [];
    if (r > 0 && r % EVERY.device === 0) {
      methods.push(METHODS.DEVICE);
    }
    methods.push(METHODS.ES_STATUS);
    if (p.meter) {
      methods.push(METHODS.METER);
    }
    methods.push(METHODS.ES_MODE);
    if ((p.pv || this.answers.pv) && r % EVERY.pv === 0) {
      methods.push(METHODS.PV);
    }
    if (p.batteryStatus && r % EVERY.battery === 0) {
      methods.push(METHODS.BATTERY);
    }
    return methods.filter((m) => !this.unsupported.has(m));
  }

  /** The HMG-50 builds are polled once a minute at most (their meter shares the channel). */
  waitsFor(now, minimumGap) {
    return this.lastRound !== undefined && now - this.lastRound < minimumGap;
  }

  record(method, result) {
    const slot = SLOT[method];
    if (slot) {
      this.answers[slot] = result;
    }
  }

  /** The values of the features, guarded; keeps track of the offered features. */
  values() {
    const values = readValues(this.answers, this.profile);
    for (const key of ENERGY_INDEXES) {
      if (values[key] !== undefined) {
        values[key] = this.guardCounter(key, values[key]);
      }
    }
    const meter = [this.answers.meter, this.answers.mode].find((m) => m && num(m.ct_state) === 1);
    if (meter && [meter.b_power, meter.c_power].some((p) => num(p))) {
      this.threePhase = true;
    }
    if (!this.threePhase) {
      delete values.grid_power_l1;
      delete values.grid_power_l2;
      delete values.grid_power_l3;
    }
    if (values.mode !== undefined) {
      values.passive_power = this.passive.power;
      values.passive_duration = this.passive.minutes;
    }
    for (const key of Object.keys(values)) {
      this.offered.add(key);
    }
    return values;
  }

  /**
   * Lifetime counters only go up: a lower reading (a firmware glitch) keeps the
   * last value, unless it lasts (the counter was reset on the battery).
   */
  guardCounter(key, value) {
    const last = this.counters.get(key);
    if (last === undefined || value >= last) {
      this.counters.set(key, value);
      this.lower.delete(key);
      return value;
    }
    const lower = (this.lower.get(key) ?? 0) + 1;
    if (lower >= RESET_AFTER) {
      this.counters.set(key, value);
      this.lower.delete(key);
      return value;
    }
    this.lower.set(key, lower);
    return last;
  }
}
