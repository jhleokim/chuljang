import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { connect } from 'node:net';
import { chromium,devices } from 'playwright';
import { startEgress } from './egress.mjs';

async function until(check, process) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (process.exitCode !== null) throw new Error('Browser display exited');
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Browser display startup timeout');
}
function waitPort(port) { return new Promise(resolve => { const socket = connect(port, '127.0.0.1'); socket.setTimeout(200); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); }); }); }
export async function openBrowser(slot, saved, options={}) {
  if (process.platform !== 'linux') throw new Error('Home browser requires the Linux container');
  const display = ':' + (100 + slot), port = 5900 + slot;
  const mobile=options.mobile===true,width=mobile?480:1280,height=960;
  const children = [];
  let browser, egress, closing;
  const childEnv=Object.fromEntries(['PATH','HOME','LANG','LC_ALL','TMPDIR','PLAYWRIGHT_BROWSERS_PATH'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
  const close = () => closing ||= (async () => {
    const browserClosed=browser?.close().catch(() => {});
    await Promise.all(children.map(child=>new Promise(resolve=>{
      if(child.exitCode!==null)return resolve();
      const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
    })));
    await egress?.close();
    if(browserClosed)await Promise.race([browserClosed,new Promise(resolve=>{const timer=setTimeout(resolve,5000);timer.unref();})]);
  })();
  try {
    const x = spawn('Xvfb', [display, '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp', '-ac'], { stdio: 'ignore', env:childEnv }); children.push(x);
    x.on('error', () => {});
    await until(() => access('/tmp/.X11-unix/X' + (100 + slot)).then(() => true, () => false), x);
    const vnc = spawn('x11vnc', ['-display', display, '-rfbport', String(port), '-localhost', '-forever', '-shared', '-nopw', '-quiet', '-xkb'], { stdio: 'ignore', env:childEnv }); children.push(vnc); vnc.on('error', () => {});
    await until(() => waitPort(port), vnc);
    egress = await startEgress();
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, env: { ...childEnv, DISPLAY: display }, proxy: { server: egress.url, bypass: '<-loopback>' }, args: [`--window-size=${width},${height}`, '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--no-first-run'] });
    const context = await browser.newContext({ ...(mobile?{...devices['Pixel 7'],deviceScaleFactor:1,viewport:{width:460,height:850}}:{viewport:{width:1260,height:850}}), locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: false, ...(saved ? { storageState: saved } : {}) });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    return { browser, context, page, port, close };
  } catch (error) { await close(); throw error; }
}
