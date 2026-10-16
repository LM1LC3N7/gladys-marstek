# Marstek

This integration brings your **Marstek home batteries** (Venus E, Venus C,
Venus D, Venus A) into Gladys: state of charge, powers, energy and operating
mode, read live on your local network through Marstek's official **Open API**
(JSON over UDP). Nothing goes through the Internet nor the Marstek cloud.
Unofficial, not affiliated with Marstek.

> **Development version (0.1).** Built from Marstek's Open API document
> (Rev 3.1) and the readings the community published, not tested with a real
> battery yet. Feedback is welcome on the GitHub repository.

## What you get

Each battery becomes a Gladys device in the **Discovery** tab, named after its
model ("Marstek Venus E 3.0"). A value only shows up when your battery gives it.

| In Gladys                           | Where it comes from                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| State of charge                     | % of the battery                                                              |
| Charge / discharge power            | always positive; from the power balance when the firmware leaves it out       |
| Charged / discharged energy (AC)    | lifetime counters of the battery on its plug side, in kWh                     |
| On-grid output power                | what the battery delivers to the home through its plug                        |
| Off-grid output power and energy    | the backup (EPS) socket of the battery                                        |
| Solar power and energy              | Venus A and D (PV inputs), in kWh for the energy views                        |
| Grid power (CT)                     | the CT meter of the battery: positive when importing, negative when exporting |
| Phases A, B, C (CT)                 | three-phase installations only                                                |
| Grid import / export (CT)           | firmware 150 or later                                                         |
| Battery temperature                 | every 5 minutes, on the safe firmware (see below)                             |
| **Operating mode**                  | Self-consumption (Auto), AI optimisation, Manual, Passive, Backup (UPS)       |
| **Passive mode power and duration** | the passive mode setpoint: negative to charge, positive to discharge          |

The values use the Gladys energy categories (battery storage, home output,
grid, production): they show in the energy views like any other brand.

**What you can control**:

- the **mode**: Self-consumption, AI, Passive, and Backup (UPS) from firmware 150. **Manual** runs the time schedule set in the Marstek app: choose it in
  the app;
- the **passive mode**: set the **power** first (for example `-1500` to charge
  at 1,500 W, `800` to deliver 800 W) and the **duration** in minutes, then
  choose the **Passive** mode. In passive mode, a new power applies at once.
  Scene example: "charge at 2,000 W during off-peak hours".

## Requirements

- A Marstek **Venus E 3.0, Venus A or Venus D** (or Venus C, Venus E 2.0: see
  the limits) on your network (Wi-Fi or Ethernet).
- The **Open API turned on** in the Marstek app for each battery, with its UDP
  port (30000 by default).
- A **fixed IP address** for each battery in your router (DHCP reservation), as
  Marstek recommends.
- Up-to-date firmware: **150 or later** for the Venus E 3.0, A and D.

## Installation

1. In the Marstek app, turn on the **Open API** of each battery.
2. In Gladys, open the **Discovery** tab of the integration: Gladys broadcasts a
   request on the network and lists the batteries that answer.
3. A battery is missing? Type its **IP address** in the configuration (several
   addresses separated by commas, with `:port` when the Open API does not use
   30000), then open Discovery again.
4. Add the batteries you want.

The **Test the connection** button lists the batteries that answer, with their
firmware and Wi-Fi signal.

## Options

| Option           | Default | Role                                        |
| ---------------- | ------- | ------------------------------------------- |
| IP addresses     | empty   | the batteries Discovery does not find       |
| Reading interval | 30 s    | from 10 to 300 s; 30 s like the Marstek app |

## How it works

The batteries answer one request at a time: the integration sends a single
request at a time, waits 2 seconds after each answer, then reads at each round
the status (`ES.GetStatus`), the CT meter (`EM.GetStatus`) and the mode
(`ES.GetMode`); the PV inputs every minute, the temperature every 5 minutes and
the firmware every 10 minutes. A battery is followed by its Bluetooth MAC
address: Discovery finds it again when its IP address changes.

The transport badge of each battery shows **local**, with an orange dot when a
request went unanswered or the firmware is fragile, and **unreachable** after
three rounds without an answer.

## Known limits

- **Discovery does not find every battery.** Gladys broadcasts the request from
  any port; several firmware builds only answer to port 30000 (Venus C, Venus E
  2.0) and the Venus E mini ignores the broadcast: type their IP address.
- **Firmware older than 150** (Venus E 3.0, A, D): gentle polling (one attempt
  per request, no temperature reading), because this firmware may turn its
  Open API off or lose its settings when polled. Update the battery from the
  Marstek app.
- **Venus C and Venus E 2.0**: their meter shares the Wi-Fi channel of the Open
  API; polling may lose the CT meter and stop self-consumption. They are read
  once a minute at most.
- **Venus E mini** (firmware 301): it answers in broadcast, which never reaches
  the container of the integration; not supported yet.
- The **Manual** mode and its time slots are set in the app.

## Troubleshooting

- **"No answer"**: the Open API is off (some firmware turns it off by itself:
  turn it on again in the app), the port is wrong, or the battery is on another
  network than Gladys.
- **Missing values**: some firmware leaves fields empty (solar energy at 0,
  off-grid energy always 0); the integration only shows what the battery gives.
- **"the battery refused the mode"**: the firmware does not take that mode
  (Backup before firmware 150).

## Privacy

Everything stays on your network: the integration only talks to your
batteries, over UDP. Marstek's Open API has no password: any device on your
network can read and control it.

## Disclaimer

Unofficial integration, not affiliated with Marstek. Marstek and Venus are
trademarks of their owners. Changing the mode or the charging power acts on a
real electrical installation: do it knowingly.
