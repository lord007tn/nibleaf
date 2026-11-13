// Preload in every rehearsal process (NODE_OPTIONS=--import=<absolute file URL>).
// Recorded fetch answers still work; a real non-loopback connection fails before
// Node resolves its hostname or opens a socket. This covers fetch, got and SDKs.
import net from 'node:net';

const connect = net.Socket.prototype.connect;
const attempted = [];
globalThis[Symbol.for('nibleaf.import-network-attempts')] = attempted;
net.Socket.prototype.connect = function (...args) {
  let options = args[0];
  while (Array.isArray(options)) options = options[0];
  const host = typeof options === 'object' && options !== null ? options.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    attempted.push(host);
    throw new Error(`Importer rehearsal blocked a non-local connection: ${host}`);
  }
  return connect.apply(this, args);
};
process.on('exit', () => {
  console.log(`Importer rehearsal network: ${JSON.stringify({ pid: process.pid, outsideTransportAttempts: attempted.length })}`);
  if (attempted.length) process.exitCode = 1;
});
