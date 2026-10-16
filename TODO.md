# TODO — Marstek v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #178) gets one recap message there, with
  a link to each repo, once the ten are published.

## Status

- [x] **Milestone 1 — core** (2026-10-16): own Open API client (UDP, one
      request at a time, 2 s after each answer, socket on the Open API port,
      retries on safe firmware only), discovery by the core's
      `udp-active-broadcast` + typed addresses + created devices, firmware
      profiles, one device per battery (state of charge, charge/discharge
      power, AC counters, on-grid/off-grid output, solar for Venus A/D, CT
      meter with phases and indexes, temperature, mode, passive power and
      duration), `ES.SetMode` (Auto, AI, Passive, UPS), transport badges,
      connection test, manifest, docs en/fr. Unit tests on fixtures and the SDK
      fake Gladys, the client on the loopback; never against a real battery.
- [ ] **Milestone 2 — real batteries**: run with testers (Venus E 3.0 150+,
      Venus A/D, Venus C), collect the answers of each method as fixtures,
      check the points below, adjust `src/profile.js`.
- [ ] **Milestone 3 — more**: manual mode schedules (a scene action writing a
      `manual_cfg` slot), depth of discharge (`DOD.SET`, firmware 150+, write
      only), a "battery charging" binary feature, the Wi-Fi signal, the
      Venus E mini (needs broadcast answers to reach the container: core
      side), maybe Modbus TCP for the Venus E 3.0 users whose Open API keeps
      switching off.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).

## To check on a real battery

- Discovery through the core: which models answer the broadcast sent from an
  ephemeral port (Venus E 3.0 / A / D are expected to, Venus C / E 2.0 not).
- The answers reach the container: socket bound to 30000 inside it, Docker
  keeping the source port through its NAT.
- Signs: `ongrid_power` (> 0 delivered), CT `total_power` (> 0 import),
  passive `power` (< 0 charge), `bat_power` (> 0 charge) where present.
- Encodings by firmware: `total_pv_energy` (0.01 kWh from 149/150), `pv1_power`
  (0.1 W), EM `input_energy`/`output_energy` (0.1 Wh from 150), `bat_temp`
  (tenths on old Venus E 3.0), HMG-50 grid counters (jaapp claims ×10 / ×100).
- `ES.SetMode`: `"UPS"` accepted, `set_result`, what the battery does when the
  passive countdown ends, `ES.GetMode` as a string or an integer.
- The 2 s pause and the retries: answer rate on Wi-Fi and Ethernet.
- `ES.GetMode` with `params.id` 0 (the vendor library tries 1 first).

## Decisions

- **Not a duplicate** (checked 2026-10-16): the Gladys core (5.2.1, 39
  services, release notes 4.80 → 5.2.1) has no Marstek, Hame or Venus code;
  the store index (405 entries, 75 in energy) has no Marstek/Hame entry; the
  forum has no Marstek topic or request; GitHub has no other Gladys Marstek
  repo. The only indirect route is the core MQTT Home Assistant discovery with
  a cloud bridge (hm2mqtt / hame-relay), cloud-based and not the Open API.
  Related store integrations, other brands: Zendure (Terdious/gladys-zendure,
  cloud), Anker SOLIX (guim31/gladys-anker-solix, cloud), EcoFlow
  (LM1LC3N7/gladys-ecoflow), Victron (LM1LC3N7/gladys-victron), Tesla
  Powerwall (guim31/gladys-tesla), HomeWizard (guim31), hybrid inverters
  (GoodWe, Huawei, SMA, SolarEdge, FoxESS, Fronius, Growatt, Solarman, SolaX).
  Tracker row n° 248 "Marstek (Modbus)", claim not picked up yet.
- **The Open API, not Modbus**: official, documented, no extra hardware
  (Modbus needs an RS485 bridge on most models), covers the Venus E 3.0, A, D,
  C and E 2.0. Modbus TCP stays an option for milestone 3.
- **Own client, no dependency**: no maintained Node.js library of the Open
  API exists. npm only has `iobroker.marstek-venus` (an ioBroker adapter, MIT,
  ~10 downloads/week) and `homebridge-marstek-venus` (a read-only Homebridge
  plugin); the Homey app is GPL-3.0; the reference clients are Python
  (taurgis/has-marstek-local-api MIT, very active; vendor aiomarstek MIT,
  minimal; jaapp/ha-marstek-local-api, no licence, inactive since 2025-11).
  The protocol is small (~300 lines on `node:dgram`); the value is in the
  firmware quirks, taken from taurgis and the vendor document and credited in
  the README. Runtime dependency: the SDK only.
- **Identity**: the Bluetooth MAC (`ble_mac`, else the end of `src`), never
  `wifi_mac`: on the Venus E 3.0 it is the access point's BSSID, the same for
  every battery. The address is a device param (`IP_ADDRESS`), updated when the
  broadcast finds the battery elsewhere.
- **Socket on the Open API port**: some firmware (HMG-50, Venus E mini) only
  answers to its own port, not to the request's source port; the vendor
  library and taurgis bind 30000 too. Any port when it is taken.
- **Discovery through the core** (`udp-active-broadcast`, port 30000, the only
  declared one): the core sends from an ephemeral port, so the firmware that
  answers to 30000 only is not found; typed addresses cover it. A core option
  to broadcast from the destination port would fix it (to propose upstream).
- **Request pacing**: one request at a time for the whole integration, nothing
  to a battery during the 2 s after its answer (taurgis: 0/23 answers under
  1 s, 13/13 after 2 s), 3 s timeout with 2 retries on safe firmware, one 7 s
  attempt otherwise; default interval 30 s (the vendor app), 10–300 s.
  Tiers: `ES.GetStatus`, `EM.GetStatus`, `ES.GetMode` every round; PV every 2;
  `Bat.GetStatus` every 10; `Marstek.GetDevice` every 20.
- **Fragile firmware** (Control < 150 on Venus E 3.0/A/D, HMG-50 < 156): no
  retry, no `Bat.GetStatus` (suspected of resetting them), badge degraded with
  "update the battery". HMG-50 (Venus C, Venus E 2.0): one round a minute at
  most, never a second datagram (their meter shares the Wi-Fi channel).
- **Battery power**: `bat_power` (> 0 charging) when present, else the power
  balance `pv - ongrid - offgrid` (most firmware omits it); split into
  `charge-power` and `discharge-power` (both >= 0).
- **AC counters**: `total_grid_input_energy` / `total_grid_output_energy`
  (energy taken from / given to the home by the battery's plug) are the
  battery-storage charge/discharge indexes; `total_load_energy` is the
  off-grid index. `ongrid_power` > 0 is `home-output-sensor/power`.
- **CT meter**: `EM.GetStatus` (the zeros of `ES.GetMode` are ignored), total
  in `grid-sensor/power` (import > 0); the phases only when a second or third
  phase carries power, in `energy-sensor/power` so that a sum over the grid
  features never counts the exchange twice; import/export indexes from
  firmware 150 (0.1 Wh).
- **Temperature**: `device-temperature-sensor` (battery-storage has no °C; the
  pack's own temperature stays out of the room temperature).
- **Counters**: never a zero (an index jumping from 0 would show as a huge
  production), only going up (a lower reading is ignored, unless it lasts ten
  rounds: a reset). The Venus E mini's counters are daily: no index for it.
- **Mode**: `text`/`select` with frozen values `auto`, `ai`, `manual`,
  `passive`, `ups` (UPS only on firmware 150+, never HMG-50). Manual needs a
  schedule slot: chosen in the app only, refused with an explanation.
  `ES.SetMode` is sent once; a lost answer is read back with `ES.GetMode`.
- **Passive mode**: two writable features kept by the integration, power
  (`unknown`, W, -max..+max of the family, < 0 charges) and duration
  (`duration`, minutes, 1–1440); restored from their Gladys `last_value` at
  start; a change applies at once when the battery is in passive mode.
- **Transport badge**: local; degraded with the methods that did not answer, or
  with the fragile firmware warning; unreachable after three silent rounds.
- **`gladys_version >= 5.0.0`**: mediated discovery (4.84), categories in the
  manifest (4.86), energy features of external devices (5.0).
