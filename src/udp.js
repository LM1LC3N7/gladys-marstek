// -----------------------------------------------------------------------------
// The only network access: Marstek's Open API, JSON-RPC over UDP, in unicast.
//
// The batteries are small Wi-Fi devices that answer one request at a time.
// The client sends ONE request at a time for the whole integration (a queue),
// sends nothing to a battery during the 2 s that follow its last answer (it
// ignores requests then), waits for the answer with a timeout and sends the
// request again only when asked to. An answer is matched by its JSON-RPC
// `id` and the address it came from; a late answer to an earlier attempt of the
// same call still counts.
//
// Some firmware answers to the Open API port of the battery (30000), not to
// the port the request came from: requests to a battery on port N leave from
// a socket bound to the local port N (inside the container; Docker keeps the
// source port through its NAT when it is free), any port if N is taken.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { LIMITS, TIMINGS } from './constants.js';
import { decodeAnswer, encodeRequest } from './protocol.js';

/** An answer carrying a JSON-RPC `error`, or no answer at all. */
export class OpenApiError extends Error {
  constructor(message, { code, kind } = {}) {
    super(message);
    this.name = 'OpenApiError';
    this.code = code;
    /** 'timeout' | 'rpc' | 'socket' | 'closed' */
    this.kind = kind;
  }
}

const defaultSocket = () => dgram.createSocket({ type: 'udp4' });

export class OpenApiClient {
  constructor({
    createSocket = defaultSocket,
    timers = globalThis,
    now = Date.now,
    logger,
    localPortFor = (port) => port,
    timeout = TIMINGS.requestTimeout,
    afterAnswer = TIMINGS.afterAnswer,
  } = {}) {
    this.createSocket = createSocket;
    this.timers = timers;
    this.now = now;
    this.logger = logger;
    this.localPortFor = localPortFor;
    this.timeout = timeout;
    this.afterAnswer = afterAnswer;
    /** host -> time of its last answer */
    this.answeredAt = new Map();
    /** destination port -> bound socket */
    this.sockets = new Map();
    /** destination port -> binding in progress */
    this.binding = new Map();
    this.nextId = 1;
    /** The call waiting for its answer: { host, ids, resolve, reject }. */
    this.current = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  /** The socket for a destination port, bound on first use. */
  socketFor(port) {
    const socket = this.sockets.get(port);
    if (socket) {
      return Promise.resolve(socket);
    }
    if (!this.binding.has(port)) {
      const local = this.localPortFor(port);
      const pending = this.bind(local)
        .catch((err) => {
          if (local === 0) {
            throw err;
          }
          this.logger?.info(
            `Local UDP port ${local} unavailable (${err.code ?? err.message}): using any port`,
          );
          return this.bind(0);
        })
        .then((bound) => {
          if (this.closed) {
            bound.close();
            throw new OpenApiError('client closed', { kind: 'closed' });
          }
          this.sockets.set(port, bound);
          return bound;
        })
        .finally(() => this.binding.delete(port));
      this.binding.set(port, pending);
    }
    return this.binding.get(port);
  }

  bind(port) {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket();
      const onError = (err) => {
        socket.removeListener('listening', onListening);
        try {
          socket.close();
        } catch {
          // already closed
        }
        reject(err);
      };
      const onListening = () => {
        socket.removeListener('error', onError);
        socket.on('error', (err) => this.logger?.warn(`UDP socket: ${err.message}`));
        socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
        resolve(socket);
      };
      socket.once('error', onError);
      socket.once('listening', onListening);
      socket.bind(port);
    });
  }

  /** The local port used towards a destination port (logs, tests). */
  localPort(port) {
    return this.sockets.get(port)?.address().port;
  }

  /** Back in service after close(). */
  reopen() {
    this.closed = false;
  }

  close() {
    this.closed = true;
    const current = this.current;
    this.current = null;
    current?.reject(new OpenApiError('client closed', { kind: 'closed' }));
    for (const socket of this.sockets.values()) {
      socket.removeAllListeners('message');
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    this.sockets.clear();
  }

  onMessage(msg, rinfo) {
    const current = this.current;
    if (!current || rinfo.address !== current.host || msg.length > LIMITS.answerBytes) {
      return;
    }
    const answer = decodeAnswer(msg);
    if (!answer || !current.ids.includes(answer.id)) {
      return;
    }
    this.current = null;
    this.answeredAt.set(current.host, this.now());
    if (answer.error) {
      current.reject(
        new OpenApiError(answer.error.message || `error ${answer.error.code}`, {
          code: answer.error.code,
          kind: 'rpc',
        }),
      );
    } else {
      current.resolve({ result: answer.result, src: answer.src });
    }
  }

  /**
   * Calls `method` on the battery at `host`:`port`, after the calls already
   * queued. Resolves with `{ result, src }`, rejects with an OpenApiError.
   * @param {{ timeout?: number, retries?: number }} [options] retries: how many
   *   times the request is sent again after a timeout (0 by default).
   */
  call(host, port, method, params = { id: 0 }, options = {}) {
    const run = () => this.send(host, port, method, params, options);
    const result = this.queue.then(run, run);
    // The queue goes on whatever this call becomes.
    this.queue = result.catch(() => {});
    return result;
  }

  async send(host, port, method, params, { timeout = this.timeout, retries = 0 } = {}) {
    if (this.closed) {
      throw new OpenApiError('client closed', { kind: 'closed' });
    }
    const socket = await this.socketFor(port);
    const ids = [];
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const answeredAt = this.answeredAt.get(host);
      if (answeredAt !== undefined) {
        await this.wait(answeredAt + this.afterAnswer - this.now());
      }
      if (this.closed) {
        throw new OpenApiError('client closed', { kind: 'closed' });
      }
      const id = this.takeId();
      ids.push(id);
      try {
        return await this.attempt(
          socket,
          host,
          port,
          ids,
          encodeRequest(id, method, params),
          timeout,
        );
      } catch (err) {
        lastError = err;
        if (err.kind !== 'timeout') {
          throw err;
        }
      }
    }
    throw lastError;
  }

  attempt(socket, host, port, ids, payload, timeout) {
    return new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        if (this.current === call) {
          this.current = null;
        }
        reject(new OpenApiError('no answer', { kind: 'timeout' }));
      }, timeout);
      const call = {
        host,
        ids,
        resolve: (value) => {
          this.timers.clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          this.timers.clearTimeout(timer);
          reject(err);
        },
      };
      this.current = call;
      const failed = (err) => {
        if (this.current === call) {
          this.current = null;
        }
        call.reject(new OpenApiError(err.message, { kind: 'socket', code: err.code }));
      };
      try {
        socket.send(payload, port, host, (err) => err && failed(err));
      } catch (err) {
        // The socket was closed meanwhile.
        failed(err);
      }
    });
  }

  takeId() {
    const id = this.nextId;
    this.nextId = this.nextId >= LIMITS.maxRequestId ? 1 : this.nextId + 1;
    return id;
  }

  wait(ms) {
    return ms > 0
      ? new Promise((resolve) => this.timers.setTimeout(resolve, ms))
      : Promise.resolve();
  }
}
