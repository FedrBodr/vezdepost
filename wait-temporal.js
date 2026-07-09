// Blocks container startup until temporal accepts TCP connections.
// Used from docker-compose.override.yaml: the backend crashes for good
// (pm2 exhausts its restarts) if it starts before the temporal stack,
// which takes 1-2 minutes to boot after a reboot.
const net = require('net');
const t0 = Date.now();
console.log('waiting for temporal:7233 ...');
(function tryConnect() {
  const s = net.connect(7233, 'temporal');
  s.on('connect', () => {
    s.end();
    console.log('temporal is up after ' + Math.round((Date.now() - t0) / 1000) + 's');
    process.exit(0);
  });
  s.on('error', () => {
    s.destroy();
    setTimeout(tryConnect, 3000);
  });
})();
