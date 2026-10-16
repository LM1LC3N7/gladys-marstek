// -----------------------------------------------------------------------------
// The integration: the batteries (typed in the configuration, found by the
// discovery broadcast of the Gladys core, or created in Gladys), a polling
// round every few seconds through the Open API client, the states within the
// Gladys rate limit, the operating mode written back, the transport badges and
// the connection test. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Battery, identityOf, normalizeMac } from './battery.js';
import { MODES, PASSIVE_MINUTES, modeConfig, modeOf } from './catalog.js';
import { normalizeConfig } from './config.js';
import { FAILURES_BEFORE_UNREACHABLE, LIMITS, OPEN_API, TIMINGS } from './constants.js';
import { buildDevice, deviceNames, displayName } from './devices.js';
import { T } from './i18n.js';
import { DISCOVERY_PARAMS, METHODS, RPC_ERRORS, decodeAnswer, encodeRequest } from './protocol.js';
import { StatePublisher } from './publisher.js';
import { OpenApiClient } from './udp.js';

/** Answers meaning "this battery does not have that method". */
const UNSUPPORTED = new Set([RPC_ERRORS.METHOD_NOT_FOUND, RPC_ERRORS.INVALID_REQUEST]);

/** Connection test: batteries asked at most. */
const TEST_TARGETS = 6;

const param = (device, name) => device.params?.find((p) => p.name === name)?.value;

export class MarstekApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'marstek' }),
    client,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.client = client ?? new OpenApiClient({ timers, now, logger });
    this.config = normalizeConfig();
    /** key (mac:… or addr:host:port) -> Battery */
    this.batteries = new Map();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    /** feature external ids of the devices created in Gladys */
    this.created = new Set();
    /** featureId -> last state, sent when the user creates the device */
    this.lastValues = new Map();
    /** deviceId -> JSON of the transport entry last published */
    this.transports = new Map();
    this.publishedDevices = undefined;
    this.pollTimer = undefined;
    this.polling = null;
    this.generation = 0;
    this.lastStatus = undefined;
    this.warned = new Set();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.client.reopen?.();
    this.refreshCreated();
    this.batteries = new Map();
    this.lastValues.clear();
    this.publishedDevices = undefined;
    this.loadCreated();
    for (const address of this.config.addresses) {
      this.addTyped(address);
    }
    if (this.config.invalidAddresses.length > 0) {
      this.logger.warn(`Ignored addresses: ${this.config.invalidAddresses.join(', ')}`);
    }
    this.publisher.configure({ intervalSeconds: 0, throttled: new Set() });
    this.publisher.start();
    await this.setStatus(false, this.batteries.size > 0 ? T.connecting : this.idleMessage());
    if (generation !== this.generation) {
      // Started again meanwhile (configuration saved while Gladys reconnected).
      return;
    }
    this.pollTimer = this.timers.setInterval(() => this.poll(), this.config.pollInterval * 1000);
    this.poll();
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.polling = null;
    this.publisher.stop();
    this.client.close();
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  idleMessage() {
    return this.config.invalidAddresses.length > 0
      ? T.badAddresses(this.config.invalidAddresses.join(', '))
      : T.notConfigured;
  }

  // --- The batteries -----------------------------------------------------------

  /** The batteries created in Gladys: their address and MAC are in the params. */
  loadCreated() {
    for (const device of this.gladys.devices ?? []) {
      const mac =
        normalizeMac(param(device, 'MARSTEK_MAC')) ??
        normalizeMac(
          String(device.external_id ?? '')
            .split(':')
            .pop(),
        );
      const host = param(device, 'IP_ADDRESS');
      if (!mac || !host || this.batteries.size >= LIMITS.batteries) {
        continue;
      }
      const battery = new Battery({
        host,
        port: Number(param(device, 'MARSTEK_PORT')) || OPEN_API.defaultPort,
        mac,
        device: param(device, 'MARSTEK_MODEL') ?? '',
        ver: param(device, 'MARSTEK_FIRMWARE'),
      });
      // The passive mode settings live in Gladys, as the last value of their feature.
      for (const f of device.features ?? []) {
        const v = Number(f.last_value);
        if (f.last_value !== null && f.last_value !== undefined && Number.isFinite(v)) {
          if (f.external_id?.endsWith(':passive_power')) {
            battery.passive.power = v;
          } else if (f.external_id?.endsWith(':passive_duration')) {
            battery.passive.minutes = v;
          }
        }
      }
      this.batteries.set(battery.key, battery);
    }
  }

  addTyped({ host, port }) {
    const known = [...this.batteries.values()].find((b) => b.host === host && b.port === port);
    if (known) {
      known.typed = true;
    } else if (this.batteries.size < LIMITS.batteries) {
      const battery = new Battery({ host, port, typed: true });
      this.batteries.set(battery.key, battery);
    }
  }

  /**
   * A Marstek.GetDevice answer from `host`:`port`: the battery it names gets
   * that address (merged with the one already known by its MAC).
   */
  found(identity, host, port, from) {
    const byMac = this.batteries.get(`mac:${identity.mac}`);
    const atAddress = from ?? [...this.batteries.values()].find((b) => !b.mac && b.host === host);
    if (byMac) {
      if (byMac.host !== host || byMac.port !== port) {
        this.logger.info(`Battery ${identity.mac} now answers at ${host}:${port}`);
        byMac.host = host;
        byMac.port = port;
      }
      byMac.lost = false;
      byMac.identify(identity);
      if (atAddress && atAddress !== byMac && !atAddress.mac) {
        byMac.typed ||= atAddress.typed;
        this.batteries.delete(atAddress.key);
      }
      return byMac;
    }
    if (atAddress && !atAddress.mac) {
      this.batteries.delete(atAddress.key);
      atAddress.port = port;
      atAddress.identify(identity);
      this.batteries.set(atAddress.key, atAddress);
      return atAddress;
    }
    if (this.batteries.size >= LIMITS.batteries) {
      this.warnOnce('too-many', `More than ${LIMITS.batteries} batteries: ${identity.mac} ignored`);
      return undefined;
    }
    const battery = new Battery({ host, port });
    battery.identify(identity);
    this.batteries.set(battery.key, battery);
    this.logger.info(`Battery found: ${battery.device || '?'} ${identity.mac} at ${host}:${port}`);
    return battery;
  }

  /** How a request to this battery is sent (no repeated datagram on fragile firmware). */
  requestOptions(battery) {
    return battery.profile.retries
      ? { retries: TIMINGS.requestRetries }
      : { timeout: TIMINGS.oneShotTimeout };
  }

  // --- Polling -------------------------------------------------------------------

  /** One round over every battery; a round still running skips this tick. */
  poll() {
    if (!this.polling) {
      const generation = this.generation;
      this.polling = this.round(generation)
        .catch((err) => this.logger.error(`Polling failed: ${err.message}`))
        .finally(() => {
          if (generation === this.generation) {
            this.polling = null;
          }
        });
    }
    return this.polling;
  }

  async round(generation) {
    for (const battery of [...this.batteries.values()]) {
      if (generation !== this.generation) {
        return;
      }
      if (
        // Merged into another one meanwhile (same MAC).
        this.batteries.get(battery.key) !== battery ||
        battery.lost ||
        (battery.profile.sharedChannel &&
          battery.waitsFor(this.now(), TIMINGS.sharedChannelInterval))
      ) {
        continue;
      }
      await this.pollBattery(battery, generation);
    }
    if (generation === this.generation) {
      await this.afterRound();
    }
  }

  /** Marstek.GetDevice: who answers at the address of this battery. */
  async identify(battery) {
    const { result, src } = await this.client.call(
      battery.host,
      battery.port,
      METHODS.DEVICE,
      DISCOVERY_PARAMS,
      this.requestOptions(battery),
    );
    const identity = identityOf(result, src);
    if (!identity) {
      this.warnOnce(`anonymous:${battery.host}`, `${battery.host} answers without a MAC address`);
      return undefined;
    }
    if (battery.mac && identity.mac !== battery.mac) {
      // The address now belongs to another battery (DHCP): this one waits for a scan.
      this.logger.warn(`${battery.host} now answers as ${identity.mac}, not ${battery.mac}`);
      battery.lost = true;
      return this.found(identity, battery.host, battery.port);
    }
    return this.found(identity, battery.host, battery.port, battery);
  }

  async pollBattery(start, generation) {
    let battery = start;
    battery.lastRound = this.now();
    const missed = [];
    let answered = 0;
    if (!battery.identified) {
      try {
        const identified = await this.identify(battery);
        answered += 1;
        if (!identified || identified !== battery || battery.lost) {
          battery.failures = 0;
          return;
        }
        battery = identified;
      } catch (err) {
        if (err.kind !== 'closed') {
          battery.failures += 1;
          battery.missed = [METHODS.DEVICE];
        }
        return;
      }
    }
    for (const method of battery.due()) {
      if (generation !== this.generation) {
        return;
      }
      try {
        const { result, src } = await this.client.call(
          battery.host,
          battery.port,
          method,
          method === METHODS.DEVICE ? DISCOVERY_PARAMS : { id: 0 },
          this.requestOptions(battery),
        );
        answered += 1;
        if (method === METHODS.DEVICE) {
          const identity = identityOf(result, src);
          if (identity && identity.mac === battery.mac) {
            battery.identify(identity);
          }
        } else {
          battery.record(method, result);
        }
      } catch (err) {
        if (err.kind === 'closed') {
          return;
        }
        if (err.kind === 'rpc' && UNSUPPORTED.has(err.code)) {
          answered += 1;
          battery.unsupported.add(method);
          this.logger.info(`${battery.label} does not support ${method}`);
        } else {
          missed.push(method);
          this.logger.debug(`${battery.label}: ${method} failed (${err.message})`);
        }
      }
    }
    battery.rounds += 1;
    battery.missed = missed;
    battery.failures = answered > 0 ? 0 : battery.failures + 1;
    if (answered > 0) {
      this.publishValues(battery);
    }
  }

  publishValues(battery) {
    if (!battery.mac) {
      return;
    }
    const ids = this.gladys.externalIds('battery', battery.mac);
    for (const [key, value] of Object.entries(battery.values())) {
      const featureId = ids.feature(key);
      const state = typeof value === 'string' ? { text: value } : { state: value };
      this.lastValues.set(featureId, state);
      if (this.created.has(featureId)) {
        this.publisher.push(featureId, state);
      }
    }
  }

  async afterRound() {
    await this.rebuild();
    await this.publishAllTransports();
    await this.updateStatus();
  }

  async updateStatus() {
    const batteries = [...this.batteries.values()];
    if (batteries.length === 0) {
      await this.setStatus(false, this.idleMessage());
      return;
    }
    const answering = batteries.filter((b) => b.identified && !b.lost && b.failures === 0);
    const names = (list) =>
      list
        .slice(0, 3)
        .map((b) => b.label)
        .join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
    if (answering.length > 0) {
      await this.setStatus(true, T.connected(answering.length, batteries.length, names(answering)));
    } else if (batteries.some((b) => b.failures > 0 || b.lost)) {
      await this.setStatus(false, T.unreachable(names(batteries)));
    }
  }

  // --- Devices ---------------------------------------------------------------------

  async rebuild({ force = false } = {}) {
    const batteries = [...this.batteries.values()].filter((b) => b.mac && b.offered.size > 0);
    const names = deviceNames(batteries);
    const devices = batteries.map((b) =>
      buildDevice(b, (type, id) => this.gladys.externalIds(type, id), names.get(b)),
    );
    const json = JSON.stringify(devices);
    if (force || json !== this.publishedDevices) {
      this.publishedDevices = json;
      await this.gladys
        .publishDiscoveredDevices(devices)
        .catch((err) => this.logger.warn(`Publishing the devices failed: ${err.message}`));
    }
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  batteryOf(deviceId) {
    return [...this.batteries.values()].find(
      (b) => b.mac && this.gladys.externalIds('battery', b.mac).device === deviceId,
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    await this.publishAllTransports();
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Transport badge -----------------------------------------------------------

  transportOf(battery) {
    if (battery.lost || battery.failures >= FAILURES_BEFORE_UNREACHABLE) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    if (battery.missed.length > 0) {
      return {
        transport: DEVICE_TRANSPORTS.LOCAL,
        degraded: true,
        message: T.badge.missed(battery.missed.join(', ')),
      };
    }
    if (battery.identified && battery.profile.resetProne) {
      return {
        transport: DEVICE_TRANSPORTS.LOCAL,
        degraded: true,
        message: T.badge.resetProne(battery.ver ?? '?'),
      };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  async publishAllTransports() {
    const created = this.createdDevices();
    const entries = [];
    for (const battery of this.batteries.values()) {
      if (!battery.mac) {
        continue;
      }
      const deviceId = this.gladys.externalIds('battery', battery.mac).device;
      if (!created.has(deviceId)) {
        continue;
      }
      const entry = { external_id: deviceId, ...this.transportOf(battery) };
      const json = JSON.stringify(entry);
      if (this.transports.get(deviceId) !== json) {
        this.transports.set(deviceId, json);
        entries.push(entry);
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Discovery -------------------------------------------------------------------

  /** The discovery request, broadcast by the Gladys core: the raw answers. */
  async broadcast() {
    try {
      const replies = await this.gladys.scanNetwork('udp-active-broadcast', {
        port: OPEN_API.defaultPort,
        payload: encodeRequest(0, METHODS.DEVICE, DISCOVERY_PARAMS),
        timeoutSeconds: TIMINGS.scanSeconds,
      });
      const found = new Map();
      for (const reply of Array.isArray(replies) ? replies : []) {
        const answer = decodeAnswer(Buffer.from(String(reply.payload_base64 ?? ''), 'base64'));
        const identity = answer?.result ? identityOf(answer.result, answer.src) : undefined;
        if (identity && typeof reply.source_ip === 'string') {
          found.set(identity.mac, { identity, host: reply.source_ip });
        }
      }
      return [...found.values()];
    } catch (err) {
      this.logger.warn(`Discovery broadcast failed: ${err.message}`);
      return [];
    }
  }

  /** Gladys asks for the devices: a broadcast, then a round, then the list. */
  async scan() {
    const generation = this.generation;
    for (const { identity, host } of await this.broadcast()) {
      this.found(identity, host, OPEN_API.defaultPort);
    }
    if (generation !== this.generation) {
      return;
    }
    // A round already under way does not know the batteries just found.
    const running = Boolean(this.polling);
    await this.poll();
    if (running) {
      await this.poll();
    }
    await this.rebuild({ force: true });
  }

  // --- Commands --------------------------------------------------------------------

  async setValue(device, feature, value) {
    const battery = this.batteryOf(device?.external_id);
    if (!battery) {
      throw new Error('this battery is not known yet: open Discovery');
    }
    const key = String(feature?.external_id ?? '').slice(String(device.external_id).length + 1);
    switch (key) {
      case 'mode':
        await this.setMode(battery, String(value));
        break;
      case 'passive_power': {
        const power = Number(value);
        const max = battery.profile.maxPower;
        if (!Number.isFinite(power) || Math.abs(power) > max) {
          throw new Error(`the passive power must be between -${max} and ${max} W, not ${value}`);
        }
        battery.passive.power = Math.round(power);
        await this.applyPassive(battery);
        break;
      }
      case 'passive_duration': {
        const minutes = Number(value);
        if (
          !Number.isFinite(minutes) ||
          minutes < PASSIVE_MINUTES.min ||
          minutes > PASSIVE_MINUTES.max
        ) {
          throw new Error(
            `the passive duration must be between ${PASSIVE_MINUTES.min} and ${PASSIVE_MINUTES.max} minutes, not ${value}`,
          );
        }
        battery.passive.minutes = Math.round(minutes);
        await this.applyPassive(battery);
        break;
      }
      default:
        throw new Error(`${feature?.name ?? key} cannot be controlled`);
    }
  }

  /** A new passive setting applies at once when the battery is in passive mode. */
  async applyPassive(battery) {
    if (modeOf(battery.answers.mode?.mode) === 'passive') {
      await this.setMode(battery, 'passive');
    } else {
      this.publishValues(battery);
    }
  }

  async setMode(battery, value) {
    const mode = MODES.find((m) => m.value === value);
    if (!mode || (value === 'ups' && !battery.profile.ups)) {
      throw new Error(`unknown mode "${value}"`);
    }
    if (value === 'manual') {
      throw new Error('the manual mode runs the schedule set in the Marstek app: choose it there');
    }
    const config = modeConfig(value, battery.passive);
    let answer;
    try {
      // Never sent twice: a mode applied but whose answer was lost is read back.
      answer = await this.client.call(
        battery.host,
        battery.port,
        METHODS.ES_SET_MODE,
        { id: 0, config },
        { timeout: TIMINGS.writeTimeout },
      );
    } catch (err) {
      if (err.kind !== 'timeout') {
        throw new Error(`the battery refused the mode: ${err.message}`, { cause: err });
      }
      const result = await this.client
        .call(battery.host, battery.port, METHODS.ES_MODE, { id: 0 }, this.requestOptions(battery))
        .then(
          (read) => read.result,
          () => undefined,
        );
      if (result) {
        battery.record(METHODS.ES_MODE, result);
      }
      if (modeOf(result?.mode) !== value) {
        throw new Error('the battery did not answer', { cause: err });
      }
    }
    if (answer && [false, 'false'].includes(answer.result.set_result)) {
      throw new Error('the battery refused the mode');
    }
    if (answer) {
      battery.record(METHODS.ES_MODE, { ...battery.answers.mode, mode: mode.api });
    }
    this.logger.info(`${battery.label}: mode ${mode.api}`);
    this.publishValues(battery);
  }

  // --- Configuration screen button -------------------------------------------------

  /** The discovery broadcast, then each battery asked who it is and its Wi-Fi signal. */
  async testConnection() {
    const lines = [];
    const found = await this.broadcast();
    lines.push(T.test.found(found.length));
    const targets = new Map();
    for (const address of this.config.addresses) {
      targets.set(`${address.host}:${address.port}`, address);
    }
    for (const b of this.batteries.values()) {
      targets.set(`${b.host}:${b.port}`, { host: b.host, port: b.port });
    }
    for (const { host } of found) {
      targets.set(`${host}:${OPEN_API.defaultPort}`, { host, port: OPEN_API.defaultPort });
    }
    if (targets.size === 0) {
      return T.test.none;
    }
    let silent = 0;
    for (const { host, port } of [...targets.values()].slice(0, TEST_TARGETS)) {
      const options = { timeout: TIMINGS.requestTimeout };
      try {
        const { result, src } = await this.client.call(
          host,
          port,
          METHODS.DEVICE,
          DISCOVERY_PARAMS,
          options,
        );
        const identity = identityOf(result, src);
        let rssi;
        try {
          const wifi = await this.client.call(host, port, METHODS.WIFI, { id: 0 }, options);
          rssi = Number.isFinite(wifi.result.rssi) ? wifi.result.rssi : undefined;
        } catch {
          // The signal is a bonus.
        }
        lines.push(
          T.test.battery({
            name: displayName(identity?.device ?? result?.device),
            host: port === OPEN_API.defaultPort ? host : `${host}:${port}`,
            ver: identity?.ver,
            rssi,
          }),
        );
      } catch {
        silent += 1;
        lines.push(T.test.silent(port === OPEN_API.defaultPort ? host : `${host}:${port}`));
      }
    }
    if (silent > 0) {
      lines.push(T.test.hint);
    }
    return T.test.ok(lines);
  }
}
