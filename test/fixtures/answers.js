// -----------------------------------------------------------------------------
// Answers of Marstek batteries, shaped like the examples of the Marstek Device
// Open API (Rev 1.0 to 3.1) and the field captures the community projects
// published (firmware quirks: no bat_power, PV channel 1 in 0.1 W, counters in
// 0.01 kWh...). MAC and IP addresses are made up.
// -----------------------------------------------------------------------------

export const E3_MAC = 'a1b2c3d4e5f6';
export const VENUS_A_MAC = '0a1b2c3d4e5f';
export const VENUS_C_MAC = '112233445566';

/** Venus E 3.0, firmware 150: no PV, a three-phase CT meter, Auto mode. */
export const VENUS_E3 = {
  'Marstek.GetDevice': {
    device: 'VenusE 3.0',
    ver: 150,
    ble_mac: E3_MAC,
    // The Wi-Fi access point, not the battery.
    wifi_mac: 'f0f1f2f3f4f5',
    wifi_name: 'MY_HOME',
    ip: '192.168.1.40',
  },
  'ES.GetStatus': {
    id: 0,
    bat_soc: 98,
    bat_cap: 5120,
    pv_power: 0,
    ongrid_power: 512,
    offgrid_power: 0,
    total_pv_energy: 0,
    total_grid_output_energy: 2548,
    total_grid_input_energy: 3273,
    total_load_energy: 0,
  },
  'ES.GetMode': {
    id: 0,
    mode: 'Auto',
    ongrid_power: 512,
    offgrid_power: 0,
    bat_soc: 98,
    // Rev 3.1 CT fields: zeros on this firmware, EM.GetStatus is the truth.
    ct_state: 0,
    a_power: 0,
    b_power: 0,
    c_power: 0,
    total_power: 0,
    input_energy: 0,
    output_energy: 0,
  },
  'EM.GetStatus': {
    id: 0,
    ct_state: 1,
    a_power: 120,
    b_power: -40,
    c_power: 35,
    total_power: 115,
    input_energy: 30863200,
    output_energy: 4487510,
  },
  'Bat.GetStatus': {
    id: 0,
    soc: 98,
    charg_flag: true,
    dischrg_flag: true,
    bat_temp: 25.0,
    bat_capacity: 5017.6,
    rated_capacity: 5120.0,
  },
  'Wifi.GetStatus': {
    id: 0,
    wifi_mac: 'f0f1f2f3f4f5',
    ssid: 'MY_HOME',
    rssi: -59,
    sta_ip: '192.168.1.40',
    sta_gate: '192.168.1.1',
    sta_mask: '255.255.255.0',
    sta_dns: '192.168.1.1',
  },
  'PV.GetStatus': { error: { code: -32601, message: 'Method not found', data: 424 } },
  'ES.SetMode': { id: 0, set_result: true },
};

/** Venus A, firmware 149: four PV channels, solar energy in 0.01 kWh, charging. */
export const VENUS_A = {
  'Marstek.GetDevice': {
    device: 'VenusA',
    ver: 149,
    ble_mac: VENUS_A_MAC,
    wifi_mac: 'f0f1f2f3f4f5',
    wifi_name: 'MY_HOME',
    ip: '192.168.1.41',
  },
  'ES.GetStatus': {
    id: 0,
    bat_soc: 49,
    bat_cap: 2080,
    // ES.GetStatus says 0 with live PV on this firmware: the channels say more.
    pv_power: 0,
    ongrid_power: -200,
    offgrid_power: 30,
    total_pv_energy: 25968,
    total_grid_output_energy: 233453,
    total_grid_input_energy: 120000,
    total_load_energy: 0,
  },
  'ES.GetMode': { id: 0, mode: 'Passive', ongrid_power: -200, offgrid_power: 30, bat_soc: 49 },
  'EM.GetStatus': {
    id: 0,
    ct_state: 0,
    a_power: 0,
    b_power: 0,
    c_power: 0,
    total_power: 0,
    input_energy: 0,
    output_energy: 0,
  },
  'PV.GetStatus': {
    id: 0,
    pv1_power: 2680,
    pv1_voltage: 38,
    pv1_current: 7,
    pv1_state: 1,
    pv2_power: 29,
    pv2_voltage: 37,
    pv2_current: 7,
    pv2_state: 1,
    pv3_power: 0,
    pv3_voltage: 10,
    pv3_current: 0,
    pv3_state: 0,
    pv4_power: 0,
    pv4_voltage: 10,
    pv4_current: 0,
    pv4_state: 0,
  },
  'Bat.GetStatus': {
    id: 0,
    soc: '49',
    charg_flag: true,
    dischrg_flag: true,
    bat_temp: 21.5,
    bat_capacity: 1019.2,
    rated_capacity: 2080.0,
  },
  'ES.SetMode': { id: 0, set_result: true },
};

/** Venus C (HMG-50), firmware 153: no MAC in the answer, a fragile Open API. */
export const VENUS_C = {
  'Marstek.GetDevice': { device: 'VenusC', ver: 153, ip: '192.168.1.42' },
  'ES.GetStatus': {
    id: 0,
    bat_soc: 60,
    bat_cap: 5120,
    pv_power: 0,
    ongrid_power: 0,
    offgrid_power: 0,
    bat_power: -300,
    total_pv_energy: 0,
    total_grid_output_energy: 1000,
    total_grid_input_energy: 2000,
    total_load_energy: 0,
  },
  'ES.GetMode': { id: 0, mode: 'AI', ongrid_power: 0, offgrid_power: 0, bat_soc: 60 },
};

/** The `src` each battery puts in its answers. */
export const SOURCES = {
  '192.168.1.40': `VenusE 3.0-${E3_MAC}`,
  '192.168.1.41': `VenusA-${VENUS_A_MAC}`,
  '192.168.1.42': `VenusC-${VENUS_C_MAC}`,
};

/** A datagram as the Gladys core relays it from the discovery broadcast. */
export function reply(sourceIp, result) {
  const body = { id: 0, src: SOURCES[sourceIp], result };
  return {
    source_ip: sourceIp,
    source_port: 30000,
    payload_base64: Buffer.from(JSON.stringify(body)).toString('base64'),
  };
}
