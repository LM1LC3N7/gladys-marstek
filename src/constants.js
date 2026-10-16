// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

export const OPEN_API = {
  /** The UDP port of the Open API, as the Marstek app sets it by default. */
  defaultPort: 30000,
  /**
   * Ports the Gladys core may broadcast the discovery request on (manifest
   * `network_discovery`): the default one only.
   */
  discoveryPorts: [30000],
};

/** Polling bounds (seconds), mirrored by the manifest. Marstek's own app polls every 30 s. */
export const POLL_INTERVAL = { min: 10, max: 300, default: 30 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Size of an answer read (bytes): a Marstek answer is a few hundred bytes. */
  answerBytes: 8 * 1024,
  /** JSON-RPC ids wrap after this one. */
  maxRequestId: 65535,
  /** Batteries followed (typed addresses + found ones). */
  batteries: 16,
};

export const TIMINGS = {
  /** Wait for an answer this long before sending the request again. */
  requestTimeout: 3000,
  /** Requests sent again after a timeout (firmware that tolerates it). */
  requestRetries: 2,
  /**
   * One single datagram, waited for longer: the firmware that loses its Open
   * API settings under repeated requests (Control below 150) and the HMG-50
   * builds whose meter shares the Wi-Fi channel.
   */
  oneShotTimeout: 7000,
  /**
   * After answering, a battery ignores requests for a second or two (its meter
   * task catches up): the next request to it waits this long after its answer.
   */
  afterAnswer: 2000,
  /** An ES.SetMode is never sent twice: one datagram, a longer wait. */
  writeTimeout: 8000,
  /** HMG-50 builds (Venus C, Venus E 2.0): one round of requests a minute at most. */
  sharedChannelInterval: 60_000,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** How long the Gladys core listens for answers to the discovery broadcast (s). */
  scanSeconds: 4,
};

/** Every n-th round of a battery reads the slower methods (times at the default interval). */
export const EVERY = {
  /** PV.GetStatus (Venus A/D): once a minute. */
  pv: 2,
  /** Bat.GetStatus (temperature): every 5 minutes. */
  battery: 10,
  /** Marstek.GetDevice (firmware, address): every 10 minutes. */
  device: 20,
};

/** Rounds without any answer before a battery shows as unreachable. */
export const FAILURES_BEFORE_UNREACHABLE = 3;
