// A minimal headless Chrome driver for browser tests, over the DevTools
// protocol with Node's built-in WebSocket: no dependencies. CHROME_PATH
// chooses the browser. Test-only: nothing in src/ or bin/ uses a browser or
// the network.
//
// Policy (docs/EVALUATION.md): without Chrome, each browser test is
// reported as skipped, one by one, so the summary's "skipped" count shows
// the coverage that did not run. With FEATURELENS_REQUIRE_BROWSER=1
// (`npm run test:browser`, `npm run check:release`), a missing Chrome is a
// failure instead.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** @returns {string | null} a Chrome executable (CHROME_PATH when set, even if missing), or null when there is none */
export function findChrome() {
  if (typeof WebSocket !== 'function') return null;
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : CANDIDATES;
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export const REQUIRE_BROWSER = process.env.FEATURELENS_REQUIRE_BROWSER === '1';

/**
 * The `skip` option for each browser test: false when `chrome` was found or
 * a browser is required (the test then fails on the missing browser), else
 * the reason, which node:test prints next to every skipped test.
 * @param {string | null} chrome
 */
export function browserSkip(chrome) {
  if (chrome || REQUIRE_BROWSER) return false;
  return `no Chrome or Chromium found (set CHROME_PATH, or FEATURELENS_REQUIRE_BROWSER=1 to fail instead)`;
}

/**
 * Start headless Chrome with one page.
 * @returns {Promise<Browser>}
 */
export async function launch(executable) {
  if (!executable) throw new Error(`browser tests required (FEATURELENS_REQUIRE_BROWSER=1) but no Chrome or Chromium was found${process.env.CHROME_PATH ? ` at CHROME_PATH=${process.env.CHROME_PATH}` : ''}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'featurelens-chrome-'));
  const proc = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 150 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    } catch { /* not started yet */ }
  }
  if (!port) {
    proc.kill();
    throw new Error('Chrome did not start');
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return new Browser(ws, proc, dir);
}

class Browser {
  constructor(ws, proc, dir) {
    this.ws = ws;
    this.proc = proc;
    this.dir = dir;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`${m.error.message}`));
        else resolve(m.result);
      } else if (m.method) {
        for (const l of this.listeners) l(m);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      this.pending.set(++this.id, { resolve, reject });
      this.ws.send(JSON.stringify({ id: this.id, method, params }));
    });
  }

  waitFor(method) {
    return new Promise((resolve) => {
      const l = (m) => {
        if (m.method === method) {
          this.listeners.splice(this.listeners.indexOf(l), 1);
          resolve(m.params);
        }
      };
      this.listeners.push(l);
    });
  }

  /**
   * Load `html` from a temporary file at the given viewport and color scheme,
   * at `#hash` when one is given (a page of the document, test/layout-browser.test.js),
   * with prefers-reduced-motion when `reducedMotion` is set (no smooth scrolling to wait for).
   * CSP violations are recorded in `window.__cspViolations`.
   */
  async open(html, { width = 1280, height = 900, dark = false, hash = '', reducedMotion = false } = {}) {
    await this.send('Page.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    if (!this.watching) {
      await this.send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.__cspViolations = []; document.addEventListener("securitypolicyviolation", (e) => window.__cspViolations.push(e.violatedDirective + " " + e.blockedURI));',
      });
      this.watching = true;
    }
    const file = path.join(this.dir, `page-${++this.id}.html`);
    fs.writeFileSync(file, html);
    const loaded = this.waitFor('Page.loadEventFired');
    await this.send('Page.navigate', { url: `file://${file}${hash ? `#${hash}` : ''}` });
    await loaded;
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  /** Press `key`; `modifiers` is the DevTools bit mask (8 = Shift). */
  async key(key, modifiers = 0) {
    const codes = { Tab: ['Tab', 9], Enter: ['Enter', 13, '\r'], ' ': ['Space', 32, ' '], Escape: ['Escape', 27] };
    const [code, vk, text] = codes[key];
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}), ...(modifiers ? { modifiers } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, ...(modifiers ? { modifiers } : {}) });
  }

  /** Click the center of the first element matching `selector`, scrolled into view. */
  async click(selector) {
    const at = await this.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    }
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  async close() {
    this.ws.close();
    const exited = new Promise((resolve) => this.proc.once('exit', resolve));
    this.proc.kill();
    await exited;
    fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
