// The documentation-app shell around the rendered sections: pages, the
// sidebar, the top bar, previous/next links, and the stylesheet rules that
// show one page at a time.
//
// It needs no script. Each page is a <div class="page" id="page-N"> and the
// URL hash picks the page: the page that is, or contains, the :target is
// shown, and with no (or an unknown) target the overview page is. So sidebar
// links, evidence links, refresh, back and forward all work as plain
// anchors. The mobile drawer is also a :target: the menu link for page N
// targets #menu-N, a close link inside the sidebar, which opens the drawer
// and keeps page N shown; closing targets #back-N, a fixed-position anchor
// at the top of page N, so neither scrolls. Following any link in the
// drawer changes the target and so closes it.
//
// Page rules use :has(). A browser without it drops them all and shows
// every page one after the other: a complete static document. Only ids of
// the form page-N, menu-N and back-N (N a page index) reach the stylesheet;
// manifest ids never do.

import { html } from './escape.js';

/** Section kind → sidebar group. */
const KIND_GROUP = {
  overview: 'overview',
  scope: 'overview',
  architecture: 'architecture',
  implementation: 'architecture',
  impact: 'architecture',
  flows: 'behavior',
  risks: 'quality',
  testing: 'quality',
  unknowns: 'quality',
  custom: 'notes',
  references: 'reference',
  history: 'reference',
};

const GROUP_ORDER = ['overview', 'architecture', 'behavior', 'quality', 'notes', 'reference'];

/** Width at which the sidebar stops being a drawer. */
const DESKTOP = '62rem';

/**
 * @typedef {object} Page
 * @property {number} index position in the document; page 0 is the overview
 * @property {string} group a GROUP_ORDER key
 * @property {string} title the sidebar label
 * @property {string} href where the sidebar links: the page's first anchor
 * @property {{ href: string, label: string, tag: string }[]} subs diagrams on the page
 * @property {boolean} [manual] the page is a manual section
 */

/** @returns {string} the sidebar group of a section kind */
export function groupOf(kind) {
  return KIND_GROUP[kind] ?? 'notes';
}

/** Pages in reading order: groups in GROUP_ORDER, and document order within a group. */
export function readingOrder(pages) {
  return GROUP_ORDER.flatMap((g) => pages.filter((p) => p.group === g));
}

/** The skip links: one per page, only the current page's is shown. */
export function skipLinks(pages) {
  return html`${pages.map((p) => html`<a class="skip skip-${p.index}" href="#back-${p.index}">Skip to content</a>
`)}`;
}

/**
 * @param {Page[]} pages
 * @param {{ name: string, repository: string, view: string }} info
 */
export function topbar(pages, info) {
  return html`<div class="topbar" role="banner">
<a class="brand" href="#page-0"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">FeatureLens</span></a>
<span class="topbar-sep" aria-hidden="true">/</span>
<p class="topbar-title">${info.name}</p>
<p class="topbar-meta"><span class="chip chip-repo">${info.repository}</span> <span class="chip chip-mode">${info.view}</span></p>
${pages.map((p) => html`<a class="menu-link menu-link-${p.index}" href="#menu-${p.index}" aria-controls="sidebar">Menu</a>
`)}</div>`;
}

/**
 * @param {Page[]} pages
 * @param {Record<string, string>} groupLabels
 */
export function sidebar(pages, groupLabels) {
  const ordered = readingOrder(pages);
  return html`<nav class="sidebar" id="sidebar" aria-label="Documentation">
${pages.map((p) => html`<a class="drawer-close" id="menu-${p.index}" href="#back-${p.index}">Close menu</a>
`)}<div class="nav-body">
${GROUP_ORDER.filter((g) => ordered.some((p) => p.group === g)).map((g) => html`<div class="nav-group">
<p class="nav-heading" id="nav-group-${g}">${groupLabels[g]}</p>
<ul aria-labelledby="nav-group-${g}">
${ordered.filter((p) => p.group === g).map((p) => html`<li><a class="nav-link nav-${p.index}" href="${p.href}">${p.title}${p.manual ? html` <span class="badge manual">manual</span>` : ''}</a>${p.subs.length ? html`
<ul class="nav-sub">
${p.subs.map((s) => html`<li><a href="${s.href}">${s.label} <span class="nav-tag">${s.tag}</span></a></li>
`)}</ul>` : ''}</li>
`)}</ul>
</div>
`)}</div>
</nav>`;
}

/** Previous and next page, in reading order. */
export function pager(pages, page) {
  const ordered = readingOrder(pages);
  const at = ordered.indexOf(page);
  const prev = ordered[at - 1];
  const next = ordered[at + 1];
  if (!prev && !next) return '';
  return html`<div class="pager">
${prev ? html`<a class="pager-prev" href="${prev.href}"><span class="pager-dir">Previous</span><span class="pager-title">${prev.title}</span></a>
` : ''}${next ? html`<a class="pager-next" href="${next.href}"><span class="pager-dir">Next</span><span class="pager-title">${next.title}</span></a>
` : ''}</div>`;
}

/** A page: its return anchor, its content and the pager. */
export function pageWrap(pages, page, content) {
  return html`<div class="page${page.index === 0 ? ' page-home' : ''}" id="page-${page.index}">
<span class="page-anchor" id="back-${page.index}"></span>
${content}${pager(pages, page)}
</div>
`;
}

/**
 * The rules that show one page at a time and mark the current one in the
 * sidebar and top bar. Built from page indexes only.
 * @param {Page[]} pages
 */
export function pageStyle(pages) {
  const targeted = '.page:target,.page :target,.drawer-close:target';
  const current = (n) => {
    const own = `body:has(#page-${n}:target,#page-${n} :target,#menu-${n}:target)`;
    return n === 0 ? `:is(${own},body:not(:has(${targeted})))` : own;
  };
  const rules = pages.map(({ index: n }) => `${current(n)} #page-${n}{display:block}
${current(n)} .nav-${n}{color:var(--fg);background:var(--nav-active);font-weight:600;box-shadow:inset 3px 0 0 var(--accent)}
${current(n)} .skip-${n}{display:block}`).join('\n');
  const menus = pages.map(({ index: n }) => `${current(n)} .menu-link-${n}{display:inline-flex}`).join('\n');
  return `
.skip:not(.skip-0){display:none}
@media (width < ${DESKTOP}){.menu-link-0{display:inline-flex}}
@supports selector(:has(*)){
.page,.skip{display:none}
${rules}
@media (width < ${DESKTOP}){.menu-link-0{display:none}
${menus}}
}
@media print{.page{display:block!important}}
`;
}

export { DESKTOP };
