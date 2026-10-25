# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-25

### Fixed

- The battery never reached the Discovery tab: the labels of the operating-mode
  options were multi-language objects, and Gladys refuses the whole publication
  ("[0].label must be a string"). They are plain strings now (forum topic 11402).

### Changed

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-16

### Added

- Marstek home batteries (Venus E 3.0, Venus A, Venus D, Venus C, Venus E 2.0)
  through their local Open API (JSON-RPC over UDP, port 30000): no cloud.
- Discovery: the Gladys core broadcasts `Marstek.GetDevice` on the network;
  batteries can also be typed by IP address (with `:port`), and the ones
  created in Gladys are followed by their Bluetooth MAC when their address
  changes.
- One device per battery, in the Gladys energy categories: state of charge,
  charge and discharge power, charged and discharged energy, on-grid and
  off-grid output power, off-grid energy, solar power and energy (Venus A/D),
  the CT meter (grid power, phases on three-phase installations, import and
  export energy) and the battery temperature.
- The operating mode, settable: self-consumption (Auto), AI, passive and
  backup (UPS, firmware 150+); manual shows, and is chosen in the Marstek app.
- Passive mode power (negative to charge) and duration, applied at once in
  passive mode.
- Firmware-aware reading: values scaled per model and firmware, gentle polling
  of the firmware that may turn its Open API off, HMG-50 builds read once a
  minute at most.
- Transport badges (local, degraded with the reason, unreachable) and a "Test
  the connection" button listing the batteries, their firmware and Wi-Fi
  signal.

[Unreleased]: https://github.com/LM1LC3N7/gladys-marstek/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-marstek/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-marstek/releases/tag/v0.1.1
