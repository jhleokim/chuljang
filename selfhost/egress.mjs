import { createServer } from 'node:http';
import { connect, isIP, BlockList } from 'node:net';
import { lookup } from 'node:dns/promises';
const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip, bits);
export function publicIPv4(ip) { return isIP(ip) === 4 && !blocked.check(ip); }
export async function publicAddress(hostname, resolver = lookup) {
  const addresses = await resolver(hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(row => !publicIPv4(row.address))) throw new Error('Private destination blocked');
  return addresses[0].address;
}
// Resolve once, validate, then connect to the validated IP. Browser sessions
// cannot use DNS rebinding to reach the Proxmox host or other LAN services.
export async function startEgress() {
  const sockets = new Set();
  const proxy = createServer((req, res) => { res.writeHead(403); res.end(); });
  proxy.on('connect', async (req, client, head) => {
    try {
      const url = new URL('https://' + req.url);
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.port && url.port !== '443')) throw new Error('HTTPS only');
      const address = await publicAddress(url.hostname);
      if (client.destroyed) return;
      const upstream = connect({ host: address, port: 443 });
      sockets.add(upstream); upstream.setTimeout(120000, () => upstream.destroy());
      upstream.on('close', () => sockets.delete(upstream));
      upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
      upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); upstream.pipe(client); client.pipe(upstream); });
    } catch { if (!client.destroyed) client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setTimeout(120000, () => socket.destroy()); });
  await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  return { url: 'http://127.0.0.1:' + proxy.address().port, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve)); } };
}
