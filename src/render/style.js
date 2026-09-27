// The page's one stylesheet, constant apart from the page rules layout.js
// appends. Colors are tokens, redefined for dark mode. Status is never
// shown by color alone: every badge carries its word, and borders differ in
// style as well as color. No web fonts, images, url() or @import.

export const STYLE = `
:root{--fg:#16181d;--fg-2:#3a3f48;--muted:#5b626e;--bg:#fff;--bg-subtle:#f7f8fa;--panel:#f1f3f6;--card:#fff;--hover:#eceff3;--line:#e2e5ea;--line-strong:#c9ced6;--accent:#2952bd;--accent-bg:#edf2fd;--nav-active:#e8eefb;--warn:#9a3b00;--warn-bg:#fff1e6;--ok:#1d6a34;--ok-bg:#e8f5ec;--derived:#6b4fa0;--derived-bg:#f1ecfa;--danger:#b3261e;--danger-bg:#fdecea;--caution:#865400;--caution-bg:#fff5dc;--info:#33567f;--info-bg:#eaf0f7;--shade:rgba(16,18,24,.45);--topbar:3.25rem;--sidebar:17rem;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--fg:#e6e8ec;--fg-2:#c5cad3;--muted:#9aa2ae;--bg:#101216;--bg-subtle:#15181d;--panel:#1b1f26;--card:#14171c;--hover:#1f242c;--line:#272c34;--line-strong:#3a414c;--accent:#8fb0ff;--accent-bg:#1b2437;--nav-active:#1d2638;--warn:#ffb784;--warn-bg:#3a2415;--ok:#8fd4a4;--ok-bg:#16301f;--derived:#c8b4f0;--derived-bg:#2a2238;--danger:#ffa097;--danger-bg:#3b1a17;--caution:#f3c667;--caution-bg:#33280f;--info:#a9c3ea;--info-bg:#1a2433;--shade:rgba(0,0,0,.6)}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg);overflow-wrap:anywhere}
[id]{scroll-margin-top:calc(var(--topbar) + 1.25rem)}
h1,h2,h3,h4{color:var(--fg);line-height:1.25}
h1{font-size:2rem;letter-spacing:-.02em;margin:.2rem 0 .6rem}
h2{font-size:1.5rem;letter-spacing:-.015em;margin:0}
h3{font-size:1.02rem;margin:2.25rem 0 .75rem}
h4{font-size:.92rem;margin:1rem 0 .3rem}
p{margin:.5rem 0}
a{color:var(--accent);text-underline-offset:.15em}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code,pre{font-family:var(--mono);font-size:.86em}
.body{white-space:pre-line}
.prose{font-size:1rem;color:var(--fg-2);max-width:46rem}
.detail,.provenance,.empty{color:var(--muted);font-size:.86rem}
.empty{font-style:italic}
.kind{font-weight:500;color:var(--muted);font-size:.78rem}
.lede{font-size:1.12rem;color:var(--fg-2);max-width:46rem;margin:0 0 1.1rem}
.eyebrow{margin:0 0 .45rem;font-size:.72rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--accent)}
.skip{position:fixed;left:.75rem;top:-4rem;z-index:60;padding:.5rem .9rem;border-radius:8px;background:var(--accent);color:var(--bg);font-weight:600;text-decoration:none}
.skip:focus{top:.5rem}

.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:.75rem;height:var(--topbar);padding:0 1.25rem;background:var(--bg);border-bottom:1px solid var(--line)}
.brand{display:inline-flex;align-items:center;gap:.5rem;flex:none;font-weight:700;letter-spacing:-.01em;color:var(--fg);text-decoration:none}
.brand-mark{width:1.05rem;height:1.05rem;border:3px solid var(--accent);border-radius:50%;box-shadow:inset 0 0 0 2px var(--accent-bg)}
.topbar-sep{color:var(--line-strong);flex:none}
.topbar-title{flex:1 1 auto;min-width:0;margin:0;font-weight:600;color:var(--fg-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topbar-meta{flex:none;display:flex;gap:.4rem;margin:0}
.chip{display:inline-flex;align-items:center;max-width:16rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:.05rem .65rem;font-size:.76rem;color:var(--muted);background:var(--bg-subtle)}
.chip-mode{color:var(--accent);background:var(--accent-bg);border-color:transparent;font-weight:600}
.menu-link{display:none;flex:none;align-items:center;gap:.55rem;margin-left:auto;padding:.35rem .75rem;border:1px solid var(--line-strong);border-radius:8px;background:var(--bg);color:var(--fg);font-size:.86rem;font-weight:600;text-decoration:none}
.menu-link::before{content:"";width:14px;height:2px;background:currentColor;box-shadow:0 -4px 0 currentColor,0 4px 0 currentColor}

.shell{display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr);align-items:start}
.sidebar{position:sticky;top:var(--topbar);height:calc(100vh - var(--topbar));overflow-y:auto;overscroll-behavior:contain;padding:1rem .75rem 2.5rem;background:var(--bg-subtle);border-right:1px solid var(--line)}
.drawer-close{display:none}
.nav-heading{margin:1.35rem .6rem .4rem;font-size:.7rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.nav-group:first-child .nav-heading{margin-top:.4rem}
.nav-group ul{list-style:none;margin:0;padding:0}
.nav-link{display:block;padding:.34rem .6rem;border-radius:6px;color:var(--fg-2);font-size:.9rem;line-height:1.35;text-decoration:none}
.nav-link:hover{background:var(--hover);color:var(--fg)}
.nav-link .badge{margin-left:.25rem}
.nav-group .nav-sub{margin:.1rem 0 .35rem .85rem;padding-left:.55rem;border-left:1px solid var(--line)}
.nav-sub a{display:block;padding:.22rem .5rem;border-radius:5px;color:var(--muted);font-size:.82rem;line-height:1.3;text-decoration:none}
.nav-sub a:hover{background:var(--hover);color:var(--fg)}
.nav-tag{display:block;font-size:.68rem;letter-spacing:.02em;opacity:.85}

main{min-width:0;padding:2.5rem clamp(1.25rem,4vw,3.5rem) 2rem}
.page{max-width:56rem;margin:0 auto}
.page-anchor{position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;pointer-events:none}
.anchor{display:block;height:0}
.page-head{margin:0 0 1.75rem;padding:0 0 1.1rem;border-bottom:1px solid var(--line)}
.provenance{margin:.55rem 0 0;font-size:.78rem}
.provenance .person .detail{font-size:1em}
.list-title{margin-top:1.75rem}
footer{margin:0 0 0 var(--sidebar);padding:1.25rem clamp(1.25rem,4vw,3.5rem) 2.5rem;border-top:1px solid var(--line);color:var(--muted);font-size:.78rem}
footer p{max-width:56rem;margin:0 auto}

.badge{display:inline-block;border-radius:999px;padding:.02rem .5rem;font-size:.72rem;font-weight:600;line-height:1.5;border:1px solid var(--line-strong);background:var(--bg);color:var(--fg-2);white-space:nowrap;vertical-align:.08em;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.badge.certainty-observed,.badge.current{color:var(--ok);background:var(--ok-bg);border-color:var(--ok)}
.badge.certainty-inferred{color:var(--info);background:var(--info-bg);border-color:var(--info)}
.badge.certainty-proposed{color:var(--derived);background:var(--derived-bg);border-color:var(--derived);border-style:dashed}
.badge.certainty-unknown{color:var(--muted);border-style:dotted}
.badge.level-high{color:var(--danger);background:var(--danger-bg);border-color:var(--danger)}
.badge.level-medium{color:var(--caution);background:var(--caution-bg);border-color:var(--caution)}
.badge.level-low{color:var(--info);background:var(--info-bg);border-color:var(--info)}
.badge.unverified,.badge.missing{color:var(--warn);background:var(--warn-bg);border-color:var(--warn)}
.badge.derived{color:var(--derived);background:var(--derived-bg);border-color:var(--derived)}
.badge.manual{border-style:dashed}
.badge.unknown{color:var(--info);background:var(--info-bg);border-color:var(--info)}
.unknown-limitation .badge.unknown{color:var(--fg-2);background:var(--panel);border-color:var(--line-strong)}

ul.claims,ul.files,ul.impact-derived{list-style:none;margin:0 0 1.5rem;padding:0;display:grid;gap:.75rem}
ul.claims>li,ul.files>li,ul.impact-derived>li{border:1px solid var(--line);border-radius:10px;padding:.95rem 1.1rem;background:var(--card)}
ul.components{grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))}
ul.relationships>li,ul.files>li,ul.impact-derived>li{padding:.65rem .9rem}
.claim-head{margin:0 0 .35rem;font-weight:600;line-height:1.45}
.claim-head .badge{margin-right:.2rem}
li:target,article:target{outline:2px solid var(--accent);outline-offset:2px}
.sources{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;margin:.65rem 0 0;font-size:.8rem;color:var(--muted)}
.sources-label{margin-right:.15rem;font-size:.66rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.ref-chip{display:inline-flex;flex-wrap:wrap;align-items:center;gap:.1rem .4rem;max-width:100%;padding:.08rem .45rem;border:1px solid var(--line);border-radius:6px;background:var(--bg-subtle)}
a.ref{text-decoration:none}a.ref:hover{text-decoration:underline}
.ref-sym{font-size:.76rem;color:var(--fg-2)}.ref-sym code{font-size:1em}
.ref-list{list-style:none;margin:.5rem 0 0;padding:0;display:grid;gap:.5rem;font-size:.82rem}
.ref-why{display:block;margin-top:.15rem;color:var(--fg-2)}
.note-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin:.65rem 0 0;font-size:.8rem;color:var(--muted)}
.note-foot .sources{margin:0}
ul.notes>li.note{border-left-width:4px}
ul.notes>li.severity-high{border-left-color:var(--danger)}ul.notes>li.severity-medium{border-left-color:var(--caution)}ul.notes>li.severity-low{border-left-color:var(--info)}
ul.notes .claim-head{font-size:1.02rem}
ul.unknowns>li{border-left:4px solid var(--info)}ul.unknowns>li.unknown-limitation{border-left:4px dashed var(--line-strong)}
.why{margin:.45rem 0 0;color:var(--fg-2)}
.why-label{display:block;margin-bottom:.1rem;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}

details>summary{cursor:pointer;list-style:none;color:var(--accent);font-size:.84rem;font-weight:600}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"";display:inline-block;width:.4em;height:.4em;margin:0 .55em .12em .1em;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg)}
details[open]>summary::before{transform:rotate(45deg);margin-bottom:.25em}
details.tech{margin-top:.6rem}
details.tech[open]{padding:.1rem 0 .1rem .75rem;border-left:2px solid var(--line)}
details.tech[open]>summary{margin-left:-.75rem}
details.tech .sources{margin-top:.35rem}
details.more{margin:1.5rem 0;padding:.75rem 1rem;border:1px solid var(--line);border-radius:10px;background:var(--bg-subtle)}
details.more>summary{font-size:.92rem}
details.more[open]>summary{margin-bottom:.75rem}
details.code{margin:.4rem 0}

dl.meta{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.3rem 1.25rem;font-size:.88rem}dl.meta dt{font-weight:600;color:var(--fg-2)}dl.meta dd{margin:0}
dl.request{margin:1.25rem 0 0;padding:.75rem 1rem;border:1px solid var(--line);border-radius:10px;background:var(--bg-subtle)}
ul.people{list-style:none;margin:0;padding:0}

.page-home>header{margin:0 0 1.75rem;padding:.25rem 0 1.5rem;border-bottom:1px solid var(--line)}
.hero-meta{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;margin:0 0 .9rem;padding:0;font-size:.86rem;color:var(--fg-2)}
.hm-label{margin-right:.35rem;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.status-line{margin:0 0 .75rem;font-size:.86rem;color:var(--fg-2)}
details.doc-details dl{margin:.75rem 0 0;padding:.9rem 1rem;border:1px solid var(--line);border-radius:10px;background:var(--bg-subtle)}
ul.facts{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(8.25rem,1fr));gap:.65rem;margin:0 0 2.25rem;padding:0}
ul.facts>li{position:relative;padding:.7rem .9rem;border:1px solid var(--line);border-radius:10px;background:var(--card)}
ul.facts a{color:inherit;text-decoration:none}ul.facts a::after{content:"";position:absolute;inset:0;border-radius:10px}
ul.facts a:hover .fact-l{color:var(--accent)}
ul.facts a:focus-visible{outline:none}ul.facts a:focus-visible::after{outline:2px solid var(--accent);outline-offset:2px}
.fact-n{display:block;font-size:1.55rem;font-weight:700;letter-spacing:-.02em;line-height:1.15}
.fact-l{font-size:.8rem;color:var(--muted)}
.fact-note{display:block;margin-top:.1rem;font-size:.72rem;font-weight:600;color:var(--warn)}
.page-home section .page-head{margin-bottom:1rem;padding-bottom:0;border:0}
.page-home section h2{font-size:1.2rem}
.home-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:1rem;margin:2.25rem 0 0}
.card{min-width:0;padding:1.1rem 1.25rem;border:1px solid var(--line);border-radius:12px;background:var(--card)}
.card-wide{grid-column:1/-1}
.card-risk{border-top:3px solid var(--danger)}.card-unknown{border-top:3px solid var(--info)}
.card-title{margin:0 0 .75rem;font-size:1rem;letter-spacing:0}
.card h3{margin:1.1rem 0 .5rem;font-size:.7rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.card-lede{margin:-.35rem 0 .9rem;color:var(--fg-2);font-size:.9rem}
.card-link{margin:.85rem 0 0;font-size:.86rem;font-weight:600}
.link-list{list-style:none;display:grid;gap:.6rem;margin:0;padding:0;font-size:.9rem}.link-list a,.where a,.card-link a{text-decoration:none}.link-list a:hover,.where a:hover,.card-link a:hover{text-decoration:underline}
.link-where{display:block;font-size:.74rem;color:var(--muted)}
.where{list-style:none;display:grid;gap:.6rem;margin:0;padding:0;font-size:.9rem}
.where-why{display:block;margin-top:.1rem;color:var(--fg-2);font-size:.86rem}
.where .sources{margin-top:.3rem}
ol.steps{list-style:none;counter-reset:step;display:grid;gap:.7rem;margin:0;padding:0}
ol.steps>li{position:relative;counter-increment:step;min-height:1.65rem;padding:.1rem 0 0 2.4rem}
ol.steps>li::before{content:counter(step);position:absolute;left:0;top:0;display:grid;place-items:center;width:1.65rem;height:1.65rem;border-radius:50%;background:var(--accent-bg);color:var(--accent);font-size:.78rem;font-weight:700}
.step-label{font-weight:600}
.step-where{margin-left:.35rem;font-size:.8rem;color:var(--muted)}
ul.branches{list-style:none;display:grid;gap:.2rem;margin:.3rem 0 0;padding:0;font-size:.86rem;color:var(--fg-2)}
.cond{display:inline-block;margin-right:.3rem;padding:0 .4rem;border-radius:4px;background:var(--panel);font-family:var(--mono);font-size:.76rem}

.scope-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:1.5rem 0}
.scope-col{padding:0 1.1rem .4rem;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.scope-col h3{margin:.9rem 0 .4rem}
.in-scope{border-top:3px solid var(--ok)}.out-scope{border-top:3px dashed var(--line-strong)}
.scope-col ul{margin:0 0 .6rem;padding-left:1.1rem}.scope-col li{margin:.3rem 0}

figure.viz{margin:2rem 0;padding:0;border:1px solid var(--line);border-radius:12px;background:var(--card);overflow:hidden}
figcaption{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.25rem .75rem;padding:.85rem 1.1rem;border-bottom:1px solid var(--line);font-weight:600}
figcaption .kind{padding:.05rem .55rem;border:1px solid var(--line);border-radius:999px;background:var(--bg-subtle)}
figure.viz>.body{margin:0;padding:.8rem 1.1rem 0;color:var(--fg-2);font-size:.92rem}
.diagram-scroll{overflow-x:auto;max-width:100%}
figure.viz .diagram-scroll{margin:.75rem 0 0;padding:.25rem .5rem;background:var(--bg-subtle);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.kind-impact .diagram-scroll{padding:.25rem .5rem;border:1px solid var(--line);border-radius:10px;background:var(--bg-subtle)}
figure.viz>ul.diagram-legend,figure.viz>.diagram-summary,figure.viz>details.text-version{margin:0;padding:.75rem 1.1rem}
figure.viz>.diagram-summary{border-top:1px solid var(--line)}
figure.viz>details.text-version{border-top:1px solid var(--line)}
details.text-version>.diagram-summary{margin-top:.5rem}
figure.viz>p.empty{padding:0 1.1rem 1rem}
svg.diagram{display:block;margin:.6rem auto;height:auto;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}svg.diagram.fit{max-width:100%}svg.diagram.wide{max-width:none}
svg.diagram rect{fill:var(--card);stroke:var(--muted);stroke-width:1.5}svg.diagram .direct rect{stroke:var(--accent);stroke-width:2.5}svg.diagram .derived rect{fill:var(--derived-bg);stroke:var(--derived);stroke-dasharray:6 4}svg.diagram .node.unverified rect{stroke:var(--warn)}
svg.diagram text{fill:var(--fg);font-size:13px}svg.diagram text.status{fill:var(--muted);font-size:11px}
svg.diagram .group rect{fill:none;stroke:var(--line-strong);stroke-width:1}svg.diagram text.group-label{font-size:12px;font-weight:600;paint-order:stroke;stroke:var(--bg-subtle);stroke-width:3px;stroke-linejoin:round}
svg.diagram .line{fill:none;stroke:var(--muted);stroke-width:1.5}svg.diagram .head{fill:var(--muted)}svg.diagram .edge.derived .line{stroke:var(--derived);stroke-dasharray:6 4}svg.diagram .edge.derived .head{fill:var(--derived)}svg.diagram .edge.unverified .line{stroke:var(--warn);stroke-dasharray:2 3}svg.diagram .edge.unverified .head{fill:var(--warn)}
ul.diagram-legend{list-style:none;display:grid;gap:.3rem;padding:0;font-size:.8rem;color:var(--muted)}.swatch{display:inline-block;width:1.6em;height:.9em;vertical-align:middle;margin-right:.3em}
.swatch.node-direct{border:2px solid var(--accent)}.swatch.node-derived{border:2px dashed var(--derived)}.swatch.edge-declared{border-bottom:2px solid var(--muted)}.swatch.edge-derived{border-bottom:2px dashed var(--derived)}.swatch.edge-unverified{border-bottom:2px dotted var(--warn)}.swatch.group-box{border:1px solid var(--muted);border-radius:4px}
.diagram-summary{font-size:.9rem}.diagram-summary h4{margin:.8rem 0 .2rem}.diagram-summary ul{padding-left:1.2rem}.diagram-summary li{margin:.25rem 0}.diagram-summary p.detail{margin:.1rem 0}
svg.diagram path.shape{fill:var(--card);stroke:var(--muted);stroke-width:1.5}svg.diagram .node.start rect,svg.diagram .node.start path.shape,svg.diagram .node.initial rect{stroke-width:3.5}svg.diagram .node.unverified path.shape{stroke:var(--warn)}
svg.diagram rect.inner{fill:none}svg.diagram path.mark{fill:none;stroke:var(--muted);stroke-width:1.5}
svg.diagram text.seq-index{font-size:10px;font-weight:600;fill:var(--muted)}svg.diagram text.edge-label{font-size:11px;paint-order:stroke;stroke:var(--bg-subtle);stroke-width:3px;stroke-linejoin:round}
svg.diagram .participant rect{stroke:var(--fg)}svg.diagram .lifeline{fill:none;stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4}
svg.diagram .message .line{fill:none;stroke:var(--fg);stroke-width:1.5}svg.diagram .message .head{fill:var(--fg)}svg.diagram .head.open{fill:none;stroke:var(--fg);stroke-width:1.5}
svg.diagram .message.return .line{stroke-dasharray:6 4}svg.diagram .message.event .line{stroke-dasharray:2 3}svg.diagram .message.unverified .line{stroke:var(--warn)}svg.diagram .message.unverified .head{fill:var(--warn)}svg.diagram .message.unverified .head.open{fill:none;stroke:var(--warn)}
.swatch.node-start{border:3px solid var(--muted)}.swatch.node-terminal{border:3px double var(--muted)}.swatch.msg-call,.swatch.msg-async{border-bottom:2px solid var(--fg)}.swatch.msg-return{border-bottom:2px dashed var(--fg)}.swatch.msg-event{border-bottom:2px dotted var(--fg)}
.derived-note{font-size:.86rem;color:var(--fg-2)}

.evidence-intro{margin:0 0 1.25rem}
.evidence-file{margin:0 0 1.75rem}
.evidence-path{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.25rem .75rem;margin:0 0 .6rem;padding:.55rem .8rem;border:1px solid var(--line);border-radius:8px;background:var(--bg-subtle);font-size:.9rem}
article.evidence{margin:.6rem 0;padding:.75rem 1rem;border:1px solid var(--line);border-radius:10px;background:var(--card)}
article.evidence h4{margin:0 0 .15rem;font-size:.9rem}
article.evidence .body{font-size:.92rem}
article.is-stale{border-color:var(--warn);border-left-width:4px}
pre.excerpt{background:var(--panel);padding:.7rem .8rem;overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:8px;overflow-wrap:normal;font-size:.8rem;line-height:1.55}.ln{display:inline-block;min-width:3ch;margin-right:1.25ch;color:var(--muted);text-align:right;user-select:none}
table{border-collapse:collapse;width:100%;font-size:.86rem}th,td{border:1px solid var(--line);padding:.4rem .6rem;text-align:left;vertical-align:top}th{background:var(--bg-subtle);font-weight:600}
.table-scroll{overflow-x:auto;max-width:100%}.table-scroll>table{min-width:44rem}

.pager{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:3.5rem 0 .5rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.pager a{display:block;padding:.75rem 1rem;border:1px solid var(--line);border-radius:10px;text-decoration:none}
.pager a:hover{border-color:var(--accent);background:var(--accent-bg)}
.pager-next{grid-column:2;text-align:right}
.pager-dir{display:block;font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.pager-title{font-weight:600}

@media (width < 75rem){.chip-repo{display:none}}
@media (width < 62rem){
.shell{display:block}
.topbar{padding:0 .9rem;gap:.6rem}
.topbar-meta{display:none}
.sidebar{position:static;height:auto;overflow:visible;padding:0;background:none;border:0}
.nav-body{display:none}
.drawer-close:target{position:fixed;top:0;left:0;z-index:51;display:flex;align-items:center;width:min(20rem,86vw);height:var(--topbar);padding:0 1.1rem;background:var(--bg-subtle);border-bottom:1px solid var(--line);color:var(--fg);font-weight:600;text-decoration:none}
.drawer-close:target::before{content:"\\2715";margin-right:.6rem;color:var(--muted)}
.drawer-close:target~.nav-body{position:fixed;top:var(--topbar);left:0;bottom:0;z-index:50;display:block;width:min(20rem,86vw);overflow-y:auto;overscroll-behavior:contain;padding:.25rem .75rem 2rem;background:var(--bg-subtle);border-right:1px solid var(--line);box-shadow:0 0 0 100vmax var(--shade)}
main{padding:1.75rem 1rem 1.5rem}
footer{margin:0;padding:1.25rem 1rem 2rem}
h1{font-size:1.65rem}
h2{font-size:1.3rem}
.home-grid,.scope-cols{grid-template-columns:minmax(0,1fr)}
ul.facts{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media (width < 30rem){.brand-name,.topbar-sep{display:none}.pager{grid-template-columns:minmax(0,1fr)}.pager-next{grid-column:1}ul.facts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:40rem){dl.meta{grid-template-columns:1fr}}
@media print{.topbar,.sidebar,.pager,.skip{display:none!important}.shell{display:block}footer{margin:0}}
`;
