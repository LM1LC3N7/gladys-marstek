// -----------------------------------------------------------------------------
// The answers of a battery -> the values of its Gladys features, and the
// features themselves (pure).
//
// Fields and units: Marstek Device Open API Rev 3.1, read with the firmware
// findings of src/profile.js. Category conventions: the comments of
// DEVICE_FEATURE_TYPES in the SDK and the units the Gladys core accepts per
// category (DEVICE_FEATURE_UNITS_BY_CATEGORY):
//   - battery-storage: level (%), charge/discharge power (W, both >= 0) and
//     indexes (kWh);
//   - home-output-sensor: the power the battery itself delivers to the home
//     (>= 0), its backup (off-grid) output and index;
//   - grid-sensor: the exchange with the public grid measured by the CT meter,
//     `power` signed (import > 0), import/export indexes;
//   - energy-production-sensor: solar power (>= 0) and index (Venus A/D);
//   - device-temperature-sensor: the battery pack itself, kept out of the room
//     temperature (battery-storage has no °C).
//
// Feature keys are part of the external ids: never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';

// --- Operating modes -----------------------------------------------------------

/**
 * ES.GetMode / ES.SetMode. `value`s are frozen: scenes store them. `code` is
 * the integer some firmware answers instead of the name.
 */
export const MODES = [
  {
    value: 'auto',
    api: 'Auto',
    code: 0,
    label: { en: 'Self-consumption (Auto)', fr: 'Autoconsommation (Auto)' },
  },
  { value: 'ai', api: 'AI', code: 1, label: { en: 'AI optimisation', fr: 'Optimisation IA' } },
  {
    value: 'manual',
    api: 'Manual',
    code: 2,
    label: { en: 'Manual (schedule of the app)', fr: "Manuel (programme de l'app)" },
  },
  {
    value: 'passive',
    api: 'Passive',
    code: 3,
    label: { en: 'Passive (fixed power)', fr: 'Passif (puissance fixe)' },
  },
  { value: 'ups', api: 'UPS', code: 4, label: { en: 'Backup (UPS)', fr: 'Secours (UPS)' } },
];

/** The mode a battery answers ("Auto", "auto", 0, "0"...) -> its `value`. */
export function modeOf(raw) {
  if (typeof raw === 'number') {
    return MODES.find((m) => m.code === raw)?.value;
  }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  const text = raw.trim().toLowerCase();
  if (/^\d+$/.test(text)) {
    return MODES.find((m) => m.code === Number(text))?.value;
  }
  return MODES.find((m) => m.value === text || m.api.toLowerCase() === text)?.value;
}

/** The modes a battery offers: UPS only on the firmware that has it. */
export const modesFor = (profile) => MODES.filter((m) => m.value !== 'ups' || profile.ups);

/** Passive mode defaults: no power, an hour. */
export const PASSIVE_DEFAULTS = { power: 0, minutes: 60 };
export const PASSIVE_MINUTES = { min: 1, max: 1440 };

/**
 * The `config` of an ES.SetMode. Manual runs the schedule of the Marstek app:
 * writing it needs a time slot, so it is only chosen in the app.
 */
export function modeConfig(value, { power = 0, minutes = PASSIVE_DEFAULTS.minutes } = {}) {
  switch (value) {
    case 'auto':
      return { mode: 'Auto', auto_cfg: { enable: 1 } };
    case 'ai':
      return { mode: 'AI', ai_cfg: { enable: 1 } };
    case 'passive':
      return {
        mode: 'Passive',
        passive_cfg: { power: Math.round(power), cd_time: Math.round(minutes * 60) },
      };
    case 'ups':
      return { mode: 'UPS', ups_cfg: { enable: 1 } };
    default:
      return undefined;
  }
}

// --- Values ----------------------------------------------------------------------

/** A number the battery sent (some fields come as strings, e.g. Bat.GetStatus soc). */
export function num(v) {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/** A power some firmware sends as an unsigned 16-bit value (65526 = -10 W). */
const signed16 = (v) => (v !== undefined && v > 32767 && v < 65536 ? v - 65536 : v);

const round = (n, digits = 0) => {
  const factor = 10 ** digits;
  const r = Math.round(n * factor) / factor;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * A lifetime counter in Wh -> kWh. Zero is left out: firmware that does not
 * count answers 0, and an index jumping from 0 to its real value would show
 * as a huge production or consumption in Gladys.
 */
const kwh = (wh) => (wh !== undefined && wh > 0 && wh < 1e9 ? round(wh / 1000, 3) : undefined);

const positive = (n) => (n === undefined ? undefined : Math.max(0, round(n)));

/** PV.GetStatus: channels 1-4 (channel 1 in 0.1 W on every firmware seen), or a single one. */
export function pvChannelsPower(pv) {
  if (!pv) {
    return undefined;
  }
  let total;
  for (const n of [1, 2, 3, 4]) {
    const p = num(pv[`pv${n}_power`]);
    if (p !== undefined) {
      total = (total ?? 0) + (n === 1 ? p / 10 : p);
    }
  }
  if (total === undefined && num(pv.pv_power) !== undefined) {
    total = num(pv.pv_power) / 10;
  }
  return total;
}

/** Battery temperature in °C: a few builds send tenths of a degree. */
export function temperatureOf(bat) {
  let t = num(bat?.bat_temp);
  if (t === undefined || (t === 0 && num(bat.rated_capacity) === 0)) {
    // A silent battery management system answers zeros.
    return undefined;
  }
  if (Math.abs(t) > 100) {
    t /= 10;
  }
  return t >= -40 && t <= 100 ? round(t, 1) : undefined;
}

/**
 * The last answers of a battery -> { featureKey: number | string }.
 * @param {{ es?, mode?, meter?, battery?, pv? }} answers ES.GetStatus,
 *   ES.GetMode, EM.GetStatus, Bat.GetStatus and PV.GetStatus results.
 * @param {ReturnType<import('./profile.js').profileOf>} profile
 */
export function readValues(answers, profile) {
  const es = answers.es ?? {};
  const mode = answers.mode ?? {};
  const bat = answers.battery;
  const values = {};

  // State of charge: ES first. A zero SOC with a zero capacity, or a zero in
  // ES.GetMode, is a placeholder of a silent battery management system.
  let soc = num(es.bat_soc);
  if (soc === 0 && num(es.bat_cap) === 0) {
    soc = undefined;
  }
  if (soc === undefined && num(mode.bat_soc)) {
    soc = num(mode.bat_soc);
  }
  if (soc === undefined && bat && num(bat.rated_capacity) !== 0) {
    soc = num(bat.soc);
  }
  if (soc !== undefined && soc >= 0 && soc <= 100) {
    values.soc = round(soc);
  }

  // Solar: ES.GetStatus pv_power, or the PV channels when ES says 0 (Venus A).
  const esPv = num(es.pv_power);
  const channels = pvChannelsPower(answers.pv);
  const pvPower = esPv > 0 ? esPv : (channels ?? esPv);
  if (profile.pv || answers.pv) {
    values.pv_power = positive(pvPower);
    values.pv_energy = kwh(
      num(es.total_pv_energy) === undefined
        ? undefined
        : num(es.total_pv_energy) * profile.pvEnergyWh,
    );
  }

  // AC side: on-grid > 0 is delivered to the home, < 0 drawn to charge.
  const ongrid = num(es.ongrid_power) ?? num(mode.ongrid_power);
  const offgrid = signed16(num(es.offgrid_power) ?? num(mode.offgrid_power));
  values.output_power = positive(ongrid);
  values.off_grid_power = positive(offgrid);

  // Battery power (+ charging). Older firmware omits it: power balance.
  let battery = num(es.bat_power);
  if (battery === undefined && !('bat_power' in es) && ongrid !== undefined) {
    battery = (pvPower ?? 0) - ongrid - (offgrid ?? 0);
  }
  if (battery !== undefined) {
    values.charge_power = positive(battery);
    values.discharge_power = positive(-battery);
  }

  // Lifetime counters (Wh on the AC side of the battery).
  values.charged_energy = kwh(num(es.total_grid_input_energy));
  values.discharged_energy = kwh(num(es.total_grid_output_energy));
  values.off_grid_energy = kwh(num(es.total_load_energy));

  // CT meter: EM.GetStatus, else the CT fields of ES.GetMode (Rev 3.1).
  const meter = [answers.meter, mode].find((m) => m && num(m.ct_state) === 1);
  if (meter) {
    const phases = ['a', 'b', 'c'].map((p) => num(meter[`${p}_power`]));
    const total =
      num(meter.total_power) ??
      (phases.some((p) => p !== undefined) ? phases.reduce((s, p) => s + (p ?? 0), 0) : undefined);
    values.grid_power = total === undefined ? undefined : round(total);
    phases.forEach((p, i) => {
      values[`grid_power_l${i + 1}`] = p === undefined ? undefined : round(p);
    });
    // Zeros mean "not counted" on the firmware without meter energy.
    for (const [key, field] of [
      ['grid_import', 'input_energy'],
      ['grid_export', 'output_energy'],
    ]) {
      const raw = num(meter[field]);
      values[key] = raw === undefined ? undefined : kwh(raw * profile.meterEnergyWh);
    }
  }

  values.temperature = temperatureOf(bat);
  values.mode = modeOf(mode.mode);

  for (const key of Object.keys(values)) {
    if (values[key] === undefined || (profile.dailyCounters && ENERGY_INDEXES.has(key))) {
      delete values[key];
    }
  }
  return values;
}

// --- Features --------------------------------------------------------------------

const MAX_W = 100_000;
const MAX_KWH = 1_000_000;

function measure(key, name, category, type, unit, min, max, digits = 0) {
  return { key, name, category, type, unit, min, max, digits };
}

/**
 * Every feature a battery may have. `kind`: measure (from the answers),
 * select (the mode), setting (a value kept by the integration).
 */
export const FEATURES = [
  measure(
    'soc',
    'State of charge',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.BATTERY_LEVEL,
    U.PERCENT,
    0,
    100,
  ),
  measure(
    'charge_power',
    'Charge power',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.CHARGE_POWER,
    U.WATT,
    0,
    MAX_W,
  ),
  measure(
    'discharge_power',
    'Discharge power',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.DISCHARGE_POWER,
    U.WATT,
    0,
    MAX_W,
  ),
  measure(
    'charged_energy',
    'Charged energy (AC)',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.CHARGE_INDEX,
    U.KILOWATT_HOUR,
    0,
    MAX_KWH,
    3,
  ),
  measure(
    'discharged_energy',
    'Discharged energy (AC)',
    C.BATTERY_STORAGE,
    T.BATTERY_STORAGE.DISCHARGE_INDEX,
    U.KILOWATT_HOUR,
    0,
    MAX_KWH,
    3,
  ),
  measure(
    'output_power',
    'On-grid output power',
    C.HOME_OUTPUT_SENSOR,
    T.HOME_OUTPUT_SENSOR.POWER,
    U.WATT,
    0,
    MAX_W,
  ),
  measure(
    'off_grid_power',
    'Off-grid output power',
    C.HOME_OUTPUT_SENSOR,
    T.HOME_OUTPUT_SENSOR.OFF_GRID_POWER,
    U.WATT,
    0,
    MAX_W,
  ),
  measure(
    'off_grid_energy',
    'Off-grid output energy',
    C.HOME_OUTPUT_SENSOR,
    T.HOME_OUTPUT_SENSOR.OFF_GRID_INDEX,
    U.KILOWATT_HOUR,
    0,
    MAX_KWH,
    3,
  ),
  measure(
    'pv_power',
    'Solar power',
    C.ENERGY_PRODUCTION_SENSOR,
    T.ENERGY_PRODUCTION_SENSOR.POWER,
    U.WATT,
    0,
    MAX_W,
  ),
  measure(
    'pv_energy',
    'Solar energy',
    C.ENERGY_PRODUCTION_SENSOR,
    T.ENERGY_PRODUCTION_SENSOR.INDEX,
    U.KILOWATT_HOUR,
    0,
    MAX_KWH,
    3,
  ),
  measure(
    'grid_power',
    'Grid power (CT)',
    C.GRID_SENSOR,
    T.GRID_SENSOR.POWER,
    U.WATT,
    -MAX_W,
    MAX_W,
  ),
  // The phases are not grid-sensor: a sum over the grid features must never
  // count the exchange twice.
  measure(
    'grid_power_l1',
    'Grid power phase A (CT)',
    C.ENERGY_SENSOR,
    T.ENERGY_SENSOR.POWER,
    U.WATT,
    -MAX_W,
    MAX_W,
  ),
  measure(
    'grid_power_l2',
    'Grid power phase B (CT)',
    C.ENERGY_SENSOR,
    T.ENERGY_SENSOR.POWER,
    U.WATT,
    -MAX_W,
    MAX_W,
  ),
  measure(
    'grid_power_l3',
    'Grid power phase C (CT)',
    C.ENERGY_SENSOR,
    T.ENERGY_SENSOR.POWER,
    U.WATT,
    -MAX_W,
    MAX_W,
  ),
  measure(
    'grid_import',
    'Grid import (CT)',
    C.GRID_SENSOR,
    T.GRID_SENSOR.INPUT_INDEX,
    U.KILOWATT_HOUR,
    0,
    MAX_KWH,
    3,
  ),
  measure(
    'grid_export',
    'Grid export (CT)',
    C.GRID_SENSOR,
    T.GRID_SENSOR.OUTPUT_INDEX,
    U.KILOWATT_HOUR,
    0,
    MAX_KWH,
    3,
  ),
  measure(
    'temperature',
    'Battery temperature',
    C.DEVICE_TEMPERATURE_SENSOR,
    T.SENSOR.DECIMAL,
    U.CELSIUS,
    -40,
    100,
    1,
  ),
  {
    key: 'mode',
    name: 'Operating mode',
    category: C.TEXT,
    type: T.TEXT.SELECT,
    min: 0,
    max: 0,
    kind: 'select',
  },
  {
    key: 'passive_power',
    name: 'Passive mode power (charge < 0, discharge > 0)',
    // Gladys has no type for a power setpoint: a writable number, in W.
    category: C.UNKNOWN,
    type: T.UNKNOWN.UNKNOWN,
    unit: U.WATT,
    kind: 'setting',
  },
  {
    key: 'passive_duration',
    name: 'Passive mode duration',
    category: C.DURATION,
    type: T.DURATION.DECIMAL,
    unit: U.MINUTES,
    min: PASSIVE_MINUTES.min,
    max: PASSIVE_MINUTES.max,
    kind: 'setting',
  },
].map((f) => ({ kind: 'measure', ...f }));

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const ENERGY_INDEXES = new Set(
  FEATURES.filter((f) => f.unit === U.KILOWATT_HOUR).map((f) => f.key),
);
