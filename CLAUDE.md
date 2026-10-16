# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency. It reads Marstek home batteries (Venus series) through
their local **Open API** (JSON-RPC over UDP, port 30000), turns each battery
into a Gladys device in the energy categories and writes the operating mode
back. Unofficial, not affiliated with Marstek.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/catalog.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          MarstekApp: batteries, polling rounds, discovery through
                    the core, states, mode writes, transports, connection test
src/udp.js          the only network access: one socket per Open API port,
                    one request at a time, timeouts, retries, 2 s after answers
src/protocol.js     JSON-RPC requests and answers, method names (pure)
src/profile.js      device name + firmware -> capabilities and encodings (pure)
src/battery.js      one battery: identity, last answers, schedule, guards
src/catalog.js      answers -> feature values; the features; modes (pure)
src/devices.js      battery -> Gladys device (pure)
src/publisher.js    states within the Gladys rate limit
src/config.js       config_schema normalized (addresses, interval)
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      answers shaped like the Open API document and field captures
test/helpers/       a fake Open API client; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `gladys.externalIds('battery', <MAC>)`
  with the Bluetooth MAC (never `wifi_mac`, the access point's), feature =
  `<device>:<catalog key>`. Never rename a catalog key, never change how ids
  are built.
- Manifest keys (`test_connection`, `addresses`, `poll_interval`) and the mode
  option values (`auto`, `ai`, `manual`, `passive`, `ups`) are frozen: users
  and scenes store them.
- Field names, units and signs come from the Marstek Device Open API document
  (Rev 3.1) and the firmware findings listed in `src/profile.js` and TODO.md.
  Never guess a field; a new firmware quirk goes into `src/profile.js` with its
  source.
- **Never harm a battery**: one request at a time, nothing during the 2 s after
  an answer, no repeated datagram on fragile firmware (`profile.retries`),
  never `Bat.GetStatus` on it, HMG-50 builds once a minute at most, an
  `ES.SetMode` is sent once (a lost answer is read back with `ES.GetMode`).
  Never send the SYS methods (`DOD.SET`, `Ble.Adv`, `Led.Ctrl`, `Set.Ver`) nor
  `Reset.Factory`.
- Category conventions: the comments of `DEVICE_FEATURE_TYPES` in the SDK and
  the units the core accepts per category (`DEVICE_FEATURE_UNITS_BY_CATEGORY`
  in `server/utils/constants.js`); checked by `test/catalog.test.js`.
- Lifetime counters only go up (`Battery.guardCounter`) and a zero counter is
  never published: an index jumping from 0 shows as a huge production.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network: unicast to the batteries only, broadcast through
  `gladys.scanNetwork` (declared in the manifest `network_discovery`).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Tests never touch the network, except `test/udp.test.js` on 127.0.0.1.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
