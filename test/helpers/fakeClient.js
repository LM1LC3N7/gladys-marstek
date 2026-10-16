// A fake Open API client: batteries by IP address, each answering from a table
// of results per method (a function receives the params; `undefined` is
// silence). Records every call. The real client is tested on the loopback in
// test/udp.test.js.

import { OpenApiError } from '../../src/udp.js';
import { SOURCES } from '../fixtures/answers.js';

export class FakeClient {
  constructor(batteries = {}) {
    // A copy per battery: the tests change the answers of their own fake.
    this.batteries = Object.fromEntries(
      Object.entries(batteries).map(([host, answers]) => [host, { ...answers }]),
    );
    this.calls = [];
    this.closed = false;
  }

  async call(host, port, method, params, options) {
    this.calls.push({ host, port, method, params, options });
    if (this.closed) {
      throw new OpenApiError('client closed', { kind: 'closed' });
    }
    let answer = this.batteries[host]?.[method];
    if (typeof answer === 'function') {
      answer = answer(params);
    }
    if (answer === undefined) {
      throw new OpenApiError('no answer', { kind: 'timeout' });
    }
    if (answer.error) {
      throw new OpenApiError(answer.error.message, { kind: 'rpc', code: answer.error.code });
    }
    return { result: structuredClone(answer), src: SOURCES[host] };
  }

  methods(host) {
    return this.calls.filter((c) => !host || c.host === host).map((c) => c.method);
  }

  close() {
    this.closed = true;
  }

  reopen() {
    this.closed = false;
  }
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

export const silent = { debug() {}, info() {}, warn() {}, error() {} };
