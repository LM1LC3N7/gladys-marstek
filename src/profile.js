// -----------------------------------------------------------------------------
// What a battery supports and how it encodes its values, from the `device` and
// `ver` of its Marstek.GetDevice answer (pure).
//
// The Open API document (Rev 3.1) is not the whole story: the firmware of each
// family differs. The rules below come from the findings of the community
// projects, which ran the vendor firmware images (credited in the README):
//   - taurgis/has-marstek-local-api (MIT): firmware families and generations,
//     the "Control" generation of the four-digit `ver` (1476 = app 147.6),
//     the firmware that disables its Open API under repeated requests
//     (Control below 150, HMG-50 below 156), the HMG-50 builds (Venus C and
//     Venus E 2.0) whose meter shares the Wi-Fi channel of the Open API, the
//     solar energy counted in 0.01 kWh from Control 149/150;
//   - jaapp/ha-marstek-local-api (MIT): the first catalogue of the methods.
// -----------------------------------------------------------------------------

export const FAMILIES = {
  VENUS_A: 'Venus A',
  VENUS_C: 'Venus C',
  VENUS_D: 'Venus D',
  VENUS_E: 'Venus E 3.0',
  VENUS_E2: 'Venus E 2.0',
  VENUS_E_MINI: 'Venus E mini',
  UNKNOWN: 'Unknown',
};

/** First match wins: the bare "VenusE" is the Venus E 2.0 (HMG-50), not the 3.0. */
const PATTERNS = [
  [FAMILIES.VENUS_E_MINI, /^(?:venus ?e ?mini|vnsem)(?:\b|\d)/],
  [FAMILIES.VENUS_E2, /^(?:venus ?e ?2(?:\.\d+)?|vnse2|hmg)(?:\b|\d)|^venus ?e$/],
  [FAMILIES.VENUS_E, /^(?:venus ?e ?3|vnse3)(?:\b|\.|\d)/],
  [FAMILIES.VENUS_A, /^(?:venus ?a|vnsa)(?:\b|\d)/],
  [FAMILIES.VENUS_C, /^venus ?c(?:\b|\d)/],
  [FAMILIES.VENUS_D, /^(?:venus ?d|vnsd)(?:\b|\d)/],
];

const KNOWN = new Set(Object.values(FAMILIES).filter((f) => f !== FAMILIES.UNKNOWN));
const PV_FAMILIES = new Set([FAMILIES.VENUS_A, FAMILIES.VENUS_D]);
const SHARED_CHANNEL = new Set([FAMILIES.VENUS_C, FAMILIES.VENUS_E2]);

/** Maximum charge/discharge power of a family (W), for the passive mode. */
const MAX_POWER = {
  [FAMILIES.VENUS_A]: 1500,
  [FAMILIES.VENUS_D]: 2200,
};
const DEFAULT_MAX_POWER = 2500;

export function familyOf(device) {
  if (typeof device !== 'string') {
    return FAMILIES.UNKNOWN;
  }
  const name = device
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ');
  return PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? FAMILIES.UNKNOWN;
}

/** `ver` as an integer: 150, "150", "150.9" and 150.9 all give 150. */
export function versionOf(ver) {
  if (typeof ver === 'number') {
    return Number.isFinite(ver) && ver >= 0 ? Math.floor(ver) : undefined;
  }
  if (typeof ver === 'string') {
    const match = /^\s*(\d+)(?:\.\d+)*\s*$/.exec(ver);
    return match ? Number(match[1]) : undefined;
  }
  return undefined;
}

/** The Control generation: four-digit versions are app labels (1476 = 147.6). */
export function generationOf(version) {
  if (version === undefined) {
    return undefined;
  }
  return version >= 1000 && version <= 1999 ? Math.floor(version / 10) : version;
}

/**
 * @returns {{
 *   family: string, version?: number, generation?: number,
 *   pv: boolean, ups: boolean, meter: boolean, batteryStatus: boolean,
 *   resetProne: boolean, sharedChannel: boolean, retries: boolean,
 *   pvEnergyWh: number, meterEnergyWh: number, dailyCounters: boolean, maxPower: number
 * }}
 */
export function profileOf(device, ver) {
  const family = familyOf(device);
  const version = versionOf(ver);
  const generation = generationOf(version);
  const known = KNOWN.has(family);
  const at = (n) => generation !== undefined && generation >= n;
  const sharedChannel = SHARED_CHANNEL.has(family);
  let resetProne;
  if (sharedChannel) {
    // HMG-50: the Open API stability fix is Control 156.
    resetProne = !at(156);
  } else if (known) {
    resetProne = !at(150);
  } else {
    resetProne = generation !== undefined && generation >= 100 && generation < 150;
  }
  const pv = PV_FAMILIES.has(family);
  // total_pv_energy: Wh on old firmware, 0.01 kWh (10 Wh) from Control 150
  // (149 on Venus A/D, and the Venus A app 148.7 = 1487 already).
  const scaledPv =
    known &&
    (at(150) ||
      (pv && at(149)) ||
      (family === FAMILIES.VENUS_A && version >= 1487 && version < 1490));
  return {
    family,
    version,
    generation,
    pv,
    ups: known && !sharedChannel && at(150),
    // EM.GetStatus: the HMG-50 builds serve it from Control 155.
    meter: sharedChannel ? at(155) : true,
    // Bat.GetStatus is the request suspected of resetting the fragile firmware:
    // never sent to it, nor to an unknown model without a recent firmware.
    batteryStatus: !resetProne && (known || at(150)),
    resetProne,
    sharedChannel,
    // Requests sent again after a timeout only where it is known to be safe.
    retries: known && !resetProne && !sharedChannel && generation !== undefined,
    pvEnergyWh: scaledPv ? 10 : 1,
    // EM input/output energy: 0.1 Wh from Control 150 (zeros before).
    meterEnergyWh: at(150) ? 0.1 : 1,
    // The Venus E mini resets its "total" counters at midnight: not indexes.
    dailyCounters: family === FAMILIES.VENUS_E_MINI,
    maxPower: MAX_POWER[family] ?? DEFAULT_MAX_POWER,
  };
}
