# gladys-marstek

[Gladys Assistant](https://gladysassistant.com) external integration for
**Marstek home batteries** (Venus E 3.0, Venus A, Venus D, Venus C, Venus E
2.0): state of charge, charge and discharge power, solar, on-grid and off-grid
power, the CT meter, energy counters and the operating mode, read and
controlled through the **local Open API** of the batteries (JSON-RPC over UDP).
No cloud. Unofficial, not affiliated with Marstek.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/178).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (MarstekApp) ⇄ src/udp.js ⇄ the batteries (UDP 30000)
                                   ├─ src/protocol.js  JSON-RPC requests and answers (pure)
                                   ├─ src/profile.js   model + firmware -> capabilities, encodings (pure)
                                   ├─ src/battery.js   one battery: identity, answers, schedule, guards
                                   ├─ src/catalog.js   answers -> feature values, the features (pure)
                                   ├─ src/devices.js   battery -> Gladys device (pure)
                                   └─ src/publisher.js states within 300/min
```

- **Discovery**: `Marstek.GetDevice` with `{"ble_mac":"0"}` broadcast on port
  30000 by the Gladys core (`gladys.scanNetwork('udp-active-broadcast')`, the
  container cannot broadcast across its bridge), plus the addresses typed in
  the configuration and the batteries already created in Gladys (their params).
- **Identity**: the Bluetooth MAC (`ble_mac`, else the end of `src`), never
  `wifi_mac` (the access point's). External ids:
  `ext:<selector>:battery:<mac>:<feature key>`.
- **Polling**: one request at a time for the whole integration, nothing sent to
  a battery during the 2 s after its answer, from a socket bound to the Open
  API port (some firmware only answers there). Each round: `ES.GetStatus`,
  `EM.GetStatus`, `ES.GetMode`; `PV.GetStatus` every 2 rounds (Venus A/D),
  `Bat.GetStatus` every 10 (safe firmware only), `Marstek.GetDevice` every 20.
  Retries only on firmware known to tolerate them; HMG-50 builds (Venus C,
  Venus E 2.0) once a minute at most.
- **Values**: firmware profile from `device` + `ver` (four-digit `ver` = app
  label, 1476 = 147.6): solar energy in 0.01 kWh from Control 149/150, PV
  channel 1 in 0.1 W, meter energy in 0.1 Wh, battery power from the power
  balance when `bat_power` is missing, unsigned 16-bit powers, placeholders of
  a silent BMS, monotonic counters.
- **Writes**: `ES.SetMode` (Auto, AI, Passive with power and duration, UPS),
  sent once; a lost answer is checked with `ES.GetMode`.
- **Transport badge**: local, degraded with a message when a request went
  unanswered or the firmware is fragile, unreachable after three silent rounds.

## Development

```bash
npm install
npm test                                        # node --test, no network but the loopback
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/answers.js` holds answers shaped like the Open API document and
the field captures of the community; `test/udp.test.js` runs the client against
a fake battery on 127.0.0.1.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## Credits

No library is used for the protocol: no maintained Node.js client of the Open
API exists (see [TODO.md](TODO.md), "Decisions"). The client was written from
Marstek's **Device Open API** document (Rev 1.0, 2.0 and 3.1), with the
firmware knowledge of these projects, read as documentation (no code copied):

- [taurgis/has-marstek-local-api](https://github.com/taurgis/has-marstek-local-api)
  (MIT): firmware families and generations, fragile firmware, HMG-50 shared
  channel, encodings, source port, request spacing;
- [jaapp/ha-marstek-local-api](https://github.com/jaapp/ha-marstek-local-api):
  the first catalogue of the methods and fields;
- [MarstekEnergy/aiomarstek](https://github.com/MarstekEnergy/aiomarstek) (MIT)
  and [Slugger2k/ioBroker.marstek-venus](https://github.com/Slugger2k/ioBroker.marstek-venus)
  (MIT): socket and timing practice.

## License

Apache-2.0. Marstek and Venus are trademarks of their owners; this project is
not affiliated with Marstek.
