// Progressive enhancement for the impact diagram (ARCHITECTURE.md §6.1.4).
// Used only when render is asked for an interactive document and the page
// draws an impact diagram.
//
// IMPACT_SCRIPT is one constant, the same in every document, so its CSP
// hash is constant and the output stays deterministic. It embeds no data:
// it reads the diagram's structure from the index-based data-node,
// data-source and data-target attributes the renderer adds, and its text
// from nodes the renderer already escaped (the <title> of each node and the
// text version), copied with textContent and cloneNode. It never parses
// markup, evaluates code or touches the network, and the CSP would block
// all of that anyway. If it doesn't run, the page is the static document.

import crypto from 'node:crypto';

export const IMPACT_SCRIPT = `(function () {
  'use strict';
  var roots = document.querySelectorAll('div.impact-graph');
  for (var i = 0; i !== roots.length; i++) enhance(roots[i]);

  function all(root, selector) {
    return Array.prototype.slice.call(root.querySelectorAll(selector));
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text) e.textContent = text;
    return e;
  }

  function copies(items) {
    var ul = el('ul');
    items.forEach(function (li) {
      var copy = li.cloneNode(true);
      ['data-node', 'data-source', 'data-target'].forEach(function (a) { copy.removeAttribute(a); });
      ul.appendChild(copy);
    });
    return ul;
  }

  function enhance(root) {
    var svg = root.querySelector('svg.diagram');
    var scroll = root.querySelector('.diagram-scroll');
    var summary = root.querySelector('.diagram-summary');
    if (!svg || !scroll || !summary) return;
    var nodes = all(svg, 'g.node[data-node]');
    var edges = all(svg, 'g.edge[data-source][data-target]');
    var nodeItems = all(summary, 'li[data-node]');
    var edgeItems = all(summary, 'li[data-source][data-target]');
    if (!nodes.length) return;
    var selected = null;

    var bar = el('div', 'impact-toolbar');
    bar.appendChild(el('p', 'detail impact-hint', 'Select a node (click it, or Tab to it and press Enter or Space) to highlight its direct relationships and show its details below. Escape clears the selection. The text version further down lists everything.'));
    var reset = el('button', 'impact-reset', 'Clear selection');
    reset.type = 'button';
    reset.disabled = true;
    bar.appendChild(reset);
    var status = el('p', 'impact-status');
    status.setAttribute('role', 'status');
    var panel = el('div', 'impact-details');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Selected node details');
    panel.hidden = true;
    scroll.parentNode.insertBefore(panel, scroll.nextSibling);
    scroll.parentNode.insertBefore(status, panel);
    scroll.parentNode.insertBefore(bar, status);

    function ref(g) { return g.getAttribute('data-node'); }
    function nodeOf(r) { return nodes.filter(function (g) { return ref(g) === r; })[0] || null; }
    function titleOf(g) {
      var t = g.querySelector('title');
      return t ? t.textContent : '';
    }

    nodes.forEach(function (g) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-pressed', 'false');
      g.setAttribute('aria-label', titleOf(g));
      g.addEventListener('click', function () { toggle(ref(g)); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(ref(g));
        }
      });
    });
    reset.addEventListener('click', function () { clear(true); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && selected !== null) {
        e.preventDefault();
        clear(document.activeElement === reset);
      }
    });

    function toggle(r) {
      if (selected === r) clear(false);
      else select(r);
    }

    function select(r) {
      selected = r;
      var neighbors = Object.create(null);
      edges.forEach(function (g) {
        var s = g.getAttribute('data-source');
        var t = g.getAttribute('data-target');
        g.classList.toggle('is-incoming', t === r);
        g.classList.toggle('is-outgoing', s === r);
        if (t === r) neighbors[s] = true;
        if (s === r) neighbors[t] = true;
      });
      nodes.forEach(function (g) {
        var mine = ref(g) === r;
        g.classList.toggle('is-selected', mine);
        g.classList.toggle('is-neighbor', !mine && neighbors[ref(g)] === true);
        g.setAttribute('aria-pressed', mine ? 'true' : 'false');
      });
      root.classList.add('has-selection');

      var incoming = edgeItems.filter(function (li) { return li.getAttribute('data-target') === r; });
      var outgoing = edgeItems.filter(function (li) { return li.getAttribute('data-source') === r; });
      panel.textContent = '';
      panel.appendChild(el('h4', null, 'Selected node'));
      panel.appendChild(copies(nodeItems.filter(function (li) { return li.getAttribute('data-node') === r; })));
      [['Incoming relationships', incoming], ['Outgoing relationships', outgoing]].forEach(function (part) {
        panel.appendChild(el('h4', null, part[0] + ' (' + part[1].length + ')'));
        panel.appendChild(part[1].length ? copies(part[1]) : el('p', 'empty', 'None.'));
      });
      panel.hidden = false;
      reset.disabled = false;
      status.textContent = 'Selected ' + titleOf(nodeOf(r)) + '. ' + incoming.length + ' incoming and ' + outgoing.length + ' outgoing relationship(s); details below the diagram.';
    }

    function clear(refocus) {
      var was = selected === null ? null : nodeOf(selected);
      selected = null;
      root.classList.remove('has-selection');
      nodes.forEach(function (g) {
        g.classList.remove('is-selected', 'is-neighbor');
        g.setAttribute('aria-pressed', 'false');
      });
      edges.forEach(function (g) { g.classList.remove('is-incoming', 'is-outgoing'); });
      panel.hidden = true;
      panel.textContent = '';
      reset.disabled = true;
      status.textContent = 'Selection cleared.';
      if (refocus && was) was.focus();
    }
  }
})();
`;

/** The CSP source that allows IMPACT_SCRIPT and nothing else. */
export const IMPACT_SCRIPT_HASH = `'sha256-${crypto.createHash('sha256').update(IMPACT_SCRIPT, 'utf8').digest('base64')}'`;

/**
 * Rules for what the script adds, appended to the page's one stylesheet in
 * interactive documents only. Selection is shown by border width, dimming
 * and text, never by color alone; focus has its own outline. No animation.
 */
export const INTERACTIVE_STYLE = `.impact-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem 1rem;margin:.4rem 0}.impact-toolbar p{margin:0;flex:1 1 16rem}
button.impact-reset{font:inherit;font-size:.9em;padding:.2rem .7rem;border:1px solid var(--muted);border-radius:4px;background:var(--panel);color:var(--fg);cursor:pointer}button.impact-reset:disabled{opacity:.55;cursor:default}button.impact-reset:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.impact-status{margin:.2rem 0;font-weight:600}.impact-status:empty{display:none}
.impact-details{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:6px;padding:.2rem .8rem .4rem;margin:.6rem 0;background:var(--panel)}.impact-details h4{margin:.5rem 0 .2rem}.impact-details ul{list-style:none;padding:0;margin:.2rem 0}
svg.diagram g.node[tabindex]{cursor:pointer}svg.diagram g.node:focus{outline:none}svg.diagram g.node:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.impact-graph.has-selection svg.diagram g.node,.impact-graph.has-selection svg.diagram g.edge{opacity:.3}
.impact-graph.has-selection svg.diagram g.node.is-selected,.impact-graph.has-selection svg.diagram g.node.is-neighbor,.impact-graph.has-selection svg.diagram g.edge.is-incoming,.impact-graph.has-selection svg.diagram g.edge.is-outgoing{opacity:1}
svg.diagram g.node.is-selected rect{stroke-width:4.5}svg.diagram g.node.is-selected text.label{font-weight:700}
svg.diagram g.edge.is-incoming .line,svg.diagram g.edge.is-outgoing .line{stroke-width:3}
`;
