// -----------------------------------------------------------------------------
// A battery -> its Gladys device for the Discovery tab (pure).
//
// External ids are forever: device = externalIds('battery', <MAC>) (the
// Bluetooth MAC, which survives an IP address change), feature =
// `<device>:<catalog key>`.
// -----------------------------------------------------------------------------

import { FEATURES, PASSIVE_MINUTES, modesFor } from './catalog.js';

/** "VenusE 3.0" -> "Marstek Venus E 3.0". */
export function displayName(device) {
  const model = (device || 'battery').replace(/^Venus(?=[A-Z])/, 'Venus ');
  return `Marstek ${model}`.slice(0, 100);
}

function featureOf(f, battery, ids) {
  const feature = {
    name: f.name,
    external_id: ids.feature(f.key),
    category: f.category,
    type: f.type,
    ...(f.unit ? { unit: f.unit } : {}),
    min: f.min ?? 0,
    max: f.max ?? 0,
    read_only: f.kind === 'measure',
    has_feedback: true,
    keep_history: f.kind === 'measure',
  };
  if (f.kind === 'select') {
    feature.supported_options = modesFor(battery.profile).map((m, i) => ({
      value: m.value,
      label: m.label,
      sort_order: i + 1,
    }));
  }
  if (f.key === 'passive_power') {
    feature.min = -battery.profile.maxPower;
    feature.max = battery.profile.maxPower;
  }
  if (f.key === 'passive_duration') {
    feature.min = PASSIVE_MINUTES.min;
    feature.max = PASSIVE_MINUTES.max;
  }
  return feature;
}

/**
 * @param {import('./battery.js').Battery} battery identified (MAC known)
 * @param {(type: string, id: string) => { device: string, feature: Function }} externalIds
 * @param {string} [name] the device name (made unique by the caller)
 */
export function buildDevice(battery, externalIds, name = displayName(battery.device)) {
  const ids = externalIds('battery', battery.mac);
  const params = [
    { name: 'IP_ADDRESS', value: battery.host },
    { name: 'MARSTEK_PORT', value: String(battery.port) },
    { name: 'MARSTEK_MAC', value: battery.mac },
  ];
  if (battery.device) {
    params.push({ name: 'MARSTEK_MODEL', value: battery.device });
  }
  if (battery.ver !== undefined) {
    params.push({ name: 'MARSTEK_FIRMWARE', value: battery.ver });
  }
  return {
    name,
    external_id: ids.device,
    params,
    features: FEATURES.filter((f) => battery.offered.has(f.key)).map((f) =>
      featureOf(f, battery, ids),
    ),
  };
}

/** Same model twice: the end of the MAC tells them apart. */
export function deviceNames(batteries) {
  const counts = new Map();
  for (const b of batteries) {
    const name = displayName(b.device);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return new Map(
    batteries.map((b) => {
      const name = displayName(b.device);
      return [b, counts.get(name) > 1 ? `${name} ${b.mac.slice(-4)}` : name];
    }),
  );
}
