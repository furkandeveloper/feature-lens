// The documentation layout in a real browser: sidebar, pages chosen by the
// URL hash, the mobile drawer, keyboard use, both modes, and the fallback
// when :has() is unavailable, under the real CSP in headless Chrome and with
// no script at all. Skipped without Chrome, failed instead with
// FEATURELENS_REQUIRE_BROWSER=1 (test/chrome.js).

import { describe, test as nodeTest, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/render/render.js';
import { sampleManifest, staleEntry } from './helpers.js';
import { findChrome, launch, browserSkip } from './chrome.js';

const chrome = findChrome();
const skip = browserSkip(chrome);
/** Every test carries the skip itself, so a run without Chrome counts each one as skipped. */
const test = (name, fn) => nodeTest(name, { skip }, chrome ? fn : () => launch(chrome));

const m = sampleManifest();
const inputs = { excerpts: [], stale: [staleEntry(m, 'ev-route')] };
const pages = { developer: render(m, inputs), product: render(m, inputs, { mode: 'product' }) };
const doc = pages.developer;

/** What the page shows: the visible page, the highlighted sidebar link, the drawer and the hash. */
const STATE = `(() => {
  const shown = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const active = [...document.querySelectorAll('.nav-link')].filter((a) => getComputedStyle(a).fontWeight === '600');
  const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
  const body = document.querySelector('.nav-body');
  return {
    pages: [...document.querySelectorAll('.page')].filter(shown).map((p) => p.id),
    active: active.map((a) => a.getAttribute('href')),
    hash: location.hash,
    drawer: shown(body) && getComputedStyle(body).position === 'fixed',
    navShown: shown(body),
    sidebarWidth: Math.round(sidebar.width),
    menu: [...document.querySelectorAll('.menu-link')].filter(shown).map((a) => a.getAttribute('href')),
    closeLinks: [...document.querySelectorAll('.drawer-close')].filter(shown).map((a) => a.getAttribute('href')),
    focus: document.activeElement?.getAttribute('href') ?? document.activeElement?.tagName ?? null,
    scrollY: Math.round(scrollY),
    overflow: document.documentElement.scrollWidth - innerWidth,
    csp: window.__cspViolations.length,
    scripts: document.scripts.length,
  };
})()`;

describe('documentation layout in Chrome', () => {
  let b;
  before(async () => {
    if (chrome) {
      b = await launch(chrome);
      // Headless pages are not focused; without this, focus() does not match :focus.
      await b.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    }
  });
  after(async () => {
    await b?.close();
  });

  const state = () => b.eval(STATE);
  /** Open a page with smooth scrolling off, so positions can be read right away. */
  const open = (html, options) => b.open(html, { reducedMotion: true, ...options });
  /** Follow a link the way a tap does, without the test helper scrolling it into view first. */
  const follow = (selector) => b.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const settle = () => new Promise((r) => setTimeout(r, 150));

  test('desktop: a sticky sidebar of 240-300px, the overview first, and nothing else shown', async () => {
    await open(doc, { width: 1280 });
    const s = await state();
    assert.deepEqual(s.pages, ['page-0']);
    assert.deepEqual(s.active, ['#page-0']);
    assert.ok(s.sidebarWidth >= 240 && s.sidebarWidth <= 300, `sidebar ${s.sidebarWidth}px`);
    assert.equal(s.navShown, true);
    assert.equal(s.drawer, false);
    assert.deepEqual(s.menu, [], 'no menu button on desktop');
    assert.deepEqual([s.csp, s.scripts, s.overflow <= 0], [0, 0, true]);
    await b.eval('window.scrollTo(0, 500)');
    const top = await b.eval(`document.querySelector('.sidebar').getBoundingClientRect().top`);
    const bar = await b.eval(`(() => { const r = document.querySelector('.topbar').getBoundingClientRect(); return { top: r.top, height: r.height }; })()`);
    assert.equal(Math.round(top), Math.round(bar.height), 'the sidebar stays under the top bar while the page scrolls');
    assert.equal(Math.round(bar.top), 0, 'the top bar stays at the top');
  });

  test('clicking sidebar links switches pages, highlights the link and updates the hash; refresh keeps the page', async () => {
    await open(doc, { width: 1280 });
    await b.click('.sidebar a[href="#section-risks"]');
    await settle();
    let s = await state();
    const risks = await b.eval(`document.querySelector('#section-risks').closest('.page').id`);
    assert.deepEqual(s.pages, [risks]);
    assert.deepEqual(s.active, ['#section-risks']);
    assert.equal(s.hash, '#section-risks');
    await b.click('.sidebar a[href="#viz-seq-pay"]');
    await settle();
    s = await state();
    const flows = await b.eval(`document.querySelector('#viz-seq-pay').closest('.page').id`);
    assert.deepEqual(s.pages, [flows]);
    assert.deepEqual(s.active, ['#section-flows'], 'a diagram link marks its page');
    const inView = await b.eval(`(() => { const r = document.querySelector('#viz-seq-pay + figure').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })()`);
    assert.ok(inView, 'the diagram is scrolled into view');

    await b.eval('location.reload()');
    await settle();
    assert.deepEqual((await state()).pages, [flows], 'reload keeps the page');
  });

  test('claim → evidence → back: the evidence entry is shown with its code location, and Back returns to the claim', async () => {
    await open(doc, { width: 1280, hash: 'section-overview' });
    const link = await b.eval(`document.querySelector('#finding-f-overview a.ref').getAttribute('href')`);
    await b.click('#finding-f-overview a.ref');
    await settle();
    let s = await state();
    const evidencePage = await b.eval(`document.querySelector(${JSON.stringify(link)}).closest('.page').id`);
    assert.deepEqual(s.pages, [evidencePage]);
    const entry = await b.eval(`(() => { const e = document.querySelector(${JSON.stringify(link)}); const r = e.getBoundingClientRect(); return { top: r.top, head: e.querySelector('h4').textContent, outline: getComputedStyle(e).outlineStyle }; })()`);
    assert.ok(entry.top >= 0 && entry.top < 300, `entry at ${entry.top}`);
    assert.match(entry.head, /^src\/[\w/.]+:\d+-\d+/);
    assert.equal(entry.outline, 'solid', 'the target is marked');
    await b.eval('history.back()');
    await settle();
    s = await state();
    assert.deepEqual(s.pages, ['page-0']);
    assert.equal(s.hash, '#section-overview');
  });

  test('an unknown hash shows the overview', async () => {
    await open(doc, { width: 1280, hash: 'nothing-here' });
    assert.deepEqual((await state()).pages, ['page-0']);
  });

  test('keyboard: the skip link comes first and jumps into the current page; sidebar links work with Enter', async () => {
    await open(doc, { width: 1280 });
    await b.key('Tab');
    assert.equal((await state()).focus, '#back-0', 'the skip link is focused first');
    // On another page, only that page's skip link is there.
    await open(doc, { width: 1280, hash: 'section-risks' });
    const risks = await b.eval(`document.querySelector('#section-risks').closest('.page').id.replace('page-', '')`);
    const skips = await b.eval(`[...document.querySelectorAll('.skip')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getAttribute('href'))`);
    assert.deepEqual(skips, [`#back-${risks}`]);
    await b.eval(`document.querySelector('.skip-${risks}').focus()`);
    let s = await state();
    const skipBox = await b.eval(`document.activeElement.getBoundingClientRect().top`);
    assert.ok(skipBox >= 0, 'visible when focused');
    await b.key('Enter');
    await settle();
    await b.key('Tab');
    const inPage = await b.eval(`!!document.activeElement.closest('#page-${risks}')`);
    assert.ok(inPage, 'Tab after the skip link lands in the page');
    assert.deepEqual((await state()).pages, [`page-${risks}`], 'and the page did not change');

    await b.eval(`document.querySelector('.sidebar a[href="#section-scope"]').focus()`);
    const ring = await b.eval(`getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth`);
    assert.equal(ring, 'solid 2px', 'visible focus');
    await b.key('Enter');
    await settle();
    s = await state();
    assert.equal(s.hash, '#section-scope');
    assert.deepEqual(s.active, ['#section-scope']);
    await b.key('Tab');
    const scope = await b.eval(`document.querySelector('#section-scope').closest('.page').id`);
    assert.ok(await b.eval(`!!document.activeElement.closest('#${scope}')`), 'the next Tab continues in the page just opened');
  });

  for (const width of [390, 768]) {
    test(`${width}px: the sidebar is a drawer: Menu opens it over the current page, a link closes it, Close keeps the page and scroll`, async () => {
      await open(doc, { width, hash: 'section-architecture' });
      let s = await state();
      const arch = s.pages[0];
      const n = arch.replace('page-', '');
      assert.equal(s.navShown, false, 'drawer closed');
      assert.deepEqual(s.menu, [`#menu-${n}`], 'one menu button, for this page');
      await b.eval('window.scrollTo(0, 600)');
      const y = (await state()).scrollY;
      await follow(`.menu-link-${n}`);
      await settle();
      s = await state();
      assert.equal(s.drawer, true, 'drawer open');
      assert.deepEqual(s.pages, [arch], 'the page behind stays');
      assert.equal(s.scrollY, y, 'opening does not scroll');
      assert.deepEqual(s.closeLinks, [`#back-${n}`]);
      const widthOf = await b.eval(`document.querySelector('.nav-body').getBoundingClientRect().width`);
      assert.ok(widthOf <= width * 0.9 && widthOf >= 280 * Math.min(1, width / 390) * 0.9, `drawer ${widthOf}px`);

      await follow('.drawer-close:target');
      await settle();
      s = await state();
      assert.equal(s.navShown, false, 'closed');
      assert.deepEqual(s.pages, [arch]);
      assert.equal(s.scrollY, y, 'closing does not scroll');

      await follow(`.menu-link-${n}`);
      await settle();
      await b.click('.nav-body a[href="#section-unknowns"]');
      await settle();
      s = await state();
      assert.equal(s.navShown, false, 'following a link closes the drawer');
      assert.equal(s.hash, '#section-unknowns');
      assert.deepEqual(s.pages, [await b.eval(`document.querySelector('#section-unknowns').closest('.page').id`)]);
      assert.ok(s.overflow <= 0);
    });
  }

  test('mobile keyboard: Enter on Menu opens the drawer and Tab moves into its links', async () => {
    await open(doc, { width: 390 });
    await b.eval(`document.querySelector('.menu-link-0').focus()`);
    await b.key('Enter');
    await settle();
    assert.equal((await state()).drawer, true);
    await b.key('Tab');
    const f = await b.eval(`({ href: document.activeElement.getAttribute('href'), inDrawer: !!document.activeElement.closest('.nav-body') })`);
    assert.deepEqual(f, { href: '#page-0', inDrawer: true });
    await b.key('Tab', 8);
    assert.equal((await state()).focus, '#back-0', 'Shift+Tab reaches the close link');
    await b.key('Enter');
    await settle();
    assert.equal((await state()).navShown, false);
  });

  for (const mode of ['developer', 'product']) {
    for (const width of [1440, 1280, 1024, 768, 390]) {
      test(`${mode} ${width}px: every page fits the viewport, with readable text and no CSP violation`, async () => {
        for (const dark of width === 390 || width === 1280 ? [false, true] : [false]) {
          await open(pages[mode], { width, dark });
          const ids = await b.eval(`[...document.querySelectorAll('.page')].map((p) => p.id)`);
          for (const id of ids) {
            await b.eval(`location.hash = '${id}'`);
            await settle();
            const r = await b.eval(`(() => {
              const rgb = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return m.length === 4 && m[3] === 0 ? null : m.slice(0, 3); };
              const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
              const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
              const bg = (e) => { for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c) return c; } return [255, 255, 255]; };
              const low = [...document.querySelectorAll('#${id} :is(p, li, a, span, h2, h3, h4, dt, dd, summary, code)')]
                .filter((e) => e.getClientRects().length && e.textContent.trim() && !e.closest('svg, .diagram-scroll'))
                .map((e) => [e.className || e.tagName, ratio(rgb(getComputedStyle(e).color), bg(e))]).filter(([, c]) => c < 4.5);
              const main = document.querySelector('main').getBoundingClientRect();
              return { overflow: document.documentElement.scrollWidth - innerWidth, shown: [...document.querySelectorAll('.page')].filter((p) => p.getClientRects().length).map((p) => p.id), low: low.slice(0, 3), mainWidth: main.width };
            })()`);
            assert.deepEqual(r.shown, [id]);
            assert.ok(r.overflow <= 0, `${id}${dark ? ' dark' : ''}: page overflows by ${r.overflow}px`);
            assert.deepEqual(r.low, [], `${id}${dark ? ' dark' : ''}: contrast`);
            assert.ok(r.mainWidth >= Math.min(width, 700) - 40, `${id}: content column ${r.mainWidth}px`);
          }
          const s = await state();
          assert.deepEqual([s.csp, s.scripts], [0, 0]);
        }
      });
    }
  }

  test('product view: technical details start collapsed and open with the keyboard', async () => {
    await open(pages.product, { width: 1280, hash: 'section-risks' });
    const closed = await b.eval(`[...document.querySelectorAll('#section-risks details.tech')].every((d) => !d.open)`);
    assert.ok(closed);
    await b.eval(`document.querySelector('#section-risks details.tech summary').focus()`);
    await b.key('Enter');
    const opened = await b.eval(`(() => { const d = document.querySelector('#section-risks details.tech'); return { open: d.open, links: [...d.querySelectorAll('a.ref')].filter((a) => a.getClientRects().length).length }; })()`);
    assert.equal(opened.open, true);
    assert.ok(opened.links > 0, 'the sources are reachable');
  });

  test('without :has() support, every page is shown one after the other: a complete static document', async () => {
    const old = doc.replace('@supports selector(:has(*)){', '@supports selector(:no-such-selector){');
    assert.notEqual(old, doc);
    await open(old, { width: 1280, hash: 'section-risks' });
    const s = await state();
    assert.equal(s.pages.length, await b.eval(`document.querySelectorAll('.page').length`));
    assert.equal(await b.eval(`[...document.querySelectorAll('.skip')].filter((e) => getComputedStyle(e).display !== 'none').length`), 1, 'one skip link');
    assert.equal(await b.eval(`document.querySelectorAll('svg.diagram').length`), 6);
    await open(old, { width: 390 });
    assert.deepEqual((await state()).menu, ['#menu-0'], 'one menu button');
  });

  test('printing shows every page and no navigation', async () => {
    await open(doc, { width: 1280 });
    await b.send('Emulation.setEmulatedMedia', { media: 'print' });
    const s = await b.eval(`({ pages: [...document.querySelectorAll('.page')].filter((p) => p.getClientRects().length).length, all: document.querySelectorAll('.page').length, nav: document.querySelector('.sidebar').getClientRects().length })`);
    await b.send('Emulation.setEmulatedMedia', { media: '' });
    assert.equal(s.pages, s.all);
    assert.equal(s.nav, 0);
  });
});
