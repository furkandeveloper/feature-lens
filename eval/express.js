// The Express evaluation case (docs/EVALUATION.md): a manifest for request
// routing in expressjs/express at tag 4.21.2 (commit 1faf2289, MIT),
// written the way the skill has Claude write one: every location stamped by
// createSourceRef against the checkout, then createManifest. The claims were
// written by reading the code at that tag; nothing here reads it to decide
// what to claim.
//
// Not part of `npm test`: it needs a clone of a public repository. See
// `node eval/run.js --express <checkout>`.

import { SourceTree, createSourceRef } from '../src/evidence/source.js';
import { createManifest } from '../src/manifest/build.js';

export const EXPRESS = {
  remote: 'https://github.com/expressjs/express',
  tag: '4.21.2',
  commit: '1faf228935aa0a13111f92c28ee795be64ce3f0f',
  license: 'MIT',
};

const EVIDENCE = [
  ['ev-create-app', 'lib/express.js', 37, 57, 'createApplication', 'definition', 'The app is a plain function that forwards every (req, res, next) to app.handle, with the application prototype mixed in.'],
  ['ev-lazyrouter', 'lib/application.js', 144, 154, 'lazyrouter', 'definition', 'The base Router is created on first use, with the query parser and expressInit as its first two layers.'],
  ['ev-app-handle', 'lib/application.js', 165, 182, 'app.handle', 'definition', 'app.handle falls back to finalhandler and passes the request to the base router; with no router it finishes at once.'],
  ['ev-app-use', 'lib/application.js', 194, 249, 'app.use', 'definition', 'app.use adds middleware to the base router, wrapping a mounted sub-app so req and res prototypes are restored afterwards.'],
  ['ev-app-verbs', 'lib/application.js', 489, 501, 'app[method]', 'definition', 'app.get/post/... create a Route on the base router and add the handlers to it; app.get with one argument reads a setting instead.'],
  ['ev-app-listen', 'lib/application.js', 633, 636, 'http.createServer(this)', 'definition', 'listen passes the app itself to http.createServer as the request listener.'],
  ['ev-router-setup', 'lib/router/index.js', 136, 175, 'proto.handle', 'definition', 'Router.handle sets up per-request state, wraps done for OPTIONS and starts the layer walk.'],
  ['ev-options', 'lib/router/index.js', 164, 169, "req.method === 'OPTIONS'", 'logic', 'An OPTIONS request nobody answered gets an automatic response listing the methods of the matching routes.'],
  ['ev-router-next', 'lib/router/index.js', 177, 290, 'function next', 'logic', 'next() walks the stack in order, skipping layers whose path or method does not match, and runs params, then the route or the middleware.'],
  ['ev-sync-guard', 'lib/router/index.js', 207, 210, '++sync > 100', 'logic', 'After 100 synchronous next() calls the walk continues on setImmediate, bounding stack depth.'],
  ['ev-trim-prefix', 'lib/router/index.js', 292, 330, 'trim_prefix', 'logic', 'Middleware mounted at a path sees req.url with that prefix removed and req.baseUrl set; errors go to handle_error.'],
  ['ev-router-use', 'lib/router/index.js', 439, 487, 'proto.use', 'definition', 'router.use pushes a non-ending Layer (end: false) without a route for each middleware function.'],
  ['ev-router-route', 'lib/router/index.js', 502, 515, 'proto.route', 'definition', 'router.route pushes an ending Layer whose handler is the new Route\'s dispatch.'],
  ['ev-match-layer', 'lib/router/index.js', 583, 589, 'matchLayer', 'logic', 'A path-matching exception becomes the layer error instead of being thrown.'],
  ['ev-layer-ctor', 'lib/router/layer.js', 33, 50, 'function Layer', 'definition', 'A Layer compiles its path with path-to-regexp and flags the "/" and "*" fast paths.'],
  ['ev-handle-error', 'lib/router/layer.js', 62, 75, 'handle_error', 'logic', 'Only four-argument functions receive errors; others are skipped with next(error).'],
  ['ev-handle-request', 'lib/router/layer.js', 86, 99, 'handle_request', 'logic', 'Four-argument functions are skipped for requests; a thrown exception becomes next(err).'],
  ['ev-layer-match', 'lib/router/layer.js', 110, 156, 'Layer.prototype.match', 'logic', 'match sets params and the matched path, decoding each parameter.'],
  ['ev-route-methods', 'lib/router/route.js', 58, 73, '_handles_method', 'logic', 'A route handles a method it registered, any method after .all, and HEAD when it has GET.'],
  ['ev-route-dispatch', 'lib/router/route.js', 101, 154, 'Route.prototype.dispatch', 'definition', 'dispatch runs the route\'s own layers for the request method; next("route") leaves the route and next("router") leaves the router.'],
  ['ev-route-verbs', 'lib/router/route.js', 206, 228, 'Route.prototype[method]', 'definition', 'route.get/post/... push a method-specific Layer per handler and record the method.'],
  ['ev-query', 'lib/middleware/query.js', 25, 47, 'function query', 'definition', 'The query middleware parses the URL query string into req.query once, with qs by default.'],
  ['ev-init', 'lib/middleware/init.js', 28, 43, 'expressInit', 'definition', 'expressInit links req and res, sets X-Powered-By and swaps in the app\'s request and response prototypes.'],
];

const obs = (...evidence) => ({ certainty: 'observed', evidence });
const inf = (...evidence) => ({ certainty: 'inferred', evidence });

/**
 * @param {string} repoRoot an express checkout at EXPRESS.commit
 * @param {{ revision?: string, now?: Date }} [options]
 */
export function buildExpressManifest(repoRoot, { revision = EXPRESS.commit, now = new Date('2026-09-24T12:00:00.000Z') } = {}) {
  const tree = new SourceTree(repoRoot);
  const evidence = EVIDENCE.map(([id, file, startLine, endLine, symbol, kind, explanation]) => {
    const { ref, warnings } = createSourceRef(tree, { id, file, startLine, endLine, symbol, kind, explanation, confidence: 'high' });
    if (warnings.length) throw new Error(`${id}: ${warnings.join('; ')}`);
    return ref;
  });

  const components = [
    { id: 'create-app', name: 'createApplication', kind: 'function', summary: 'Builds the app function and its request/response prototypes.', ...obs('ev-create-app') },
    { id: 'application', name: 'Application (app)', kind: 'module', summary: 'Settings, app.use, app.VERB and app.handle; proxies routing to the base router.', ...obs('ev-app-handle', 'ev-app-use', 'ev-app-verbs') },
    { id: 'http-server', name: 'Node http.Server', kind: 'external', summary: 'Receives requests and calls the app as its listener.', dependency: { name: 'http', ecosystem: 'node' }, ...obs('ev-app-listen') },
    { id: 'router', name: 'Router', kind: 'class', summary: 'Ordered stack of layers; next() walks it for each request.', ...obs('ev-router-setup', 'ev-router-next') },
    { id: 'layer', name: 'Layer', kind: 'class', summary: 'One path matcher plus one handler, for middleware or a route.', ...obs('ev-layer-ctor', 'ev-layer-match') },
    { id: 'route', name: 'Route', kind: 'class', summary: 'Per-path stack of method-specific handlers.', ...obs('ev-route-dispatch', 'ev-route-verbs') },
    { id: 'query-mw', name: 'query middleware', kind: 'function', summary: 'Parses req.query.', ...obs('ev-query') },
    { id: 'init-mw', name: 'expressInit middleware', kind: 'function', summary: 'Links req/res and applies the app prototypes.', ...obs('ev-init') },
    { id: 'finalhandler', name: 'finalhandler', kind: 'external', summary: 'Default last handler: 404 or error response.', dependency: { name: 'finalhandler', ecosystem: 'npm', version: '1.3.1' }, ...obs('ev-app-handle') },
    { id: 'path-to-regexp', name: 'path-to-regexp', kind: 'external', summary: 'Compiles route paths to regular expressions.', dependency: { name: 'path-to-regexp', ecosystem: 'npm' }, ...obs('ev-layer-ctor') },
    { id: 'user-handlers', name: 'Application handlers', kind: 'other', summary: 'Middleware and route handlers the application registers.', ...obs('ev-handle-request', 'ev-handle-error') },
  ];
  const relationships = [
    { id: 'r-server-app', from: 'http-server', to: 'application', kind: 'calls', label: 'request listener', ...obs('ev-app-listen', 'ev-create-app') },
    { id: 'r-create-app', from: 'create-app', to: 'application', kind: 'contains', ...obs('ev-create-app') },
    { id: 'r-app-router', from: 'application', to: 'router', kind: 'calls', label: 'app.handle → router.handle', ...obs('ev-app-handle', 'ev-lazyrouter') },
    { id: 'r-app-final', from: 'application', to: 'finalhandler', kind: 'calls', label: 'default done', ...obs('ev-app-handle') },
    { id: 'r-router-layer', from: 'router', to: 'layer', kind: 'calls', label: 'match, handle_request, handle_error', ...obs('ev-router-next', 'ev-trim-prefix') },
    { id: 'r-router-query', from: 'router', to: 'query-mw', kind: 'contains', label: 'first layer', ...obs('ev-lazyrouter') },
    { id: 'r-router-init', from: 'router', to: 'init-mw', kind: 'contains', label: 'second layer', ...obs('ev-lazyrouter') },
    { id: 'r-layer-route', from: 'layer', to: 'route', kind: 'calls', label: 'route.dispatch', ...obs('ev-router-route') },
    { id: 'r-route-layer', from: 'route', to: 'layer', kind: 'calls', label: 'per-method layers', ...obs('ev-route-dispatch', 'ev-route-verbs') },
    { id: 'r-layer-handlers', from: 'layer', to: 'user-handlers', kind: 'calls', ...obs('ev-handle-request', 'ev-handle-error') },
    { id: 'r-layer-ptr', from: 'layer', to: 'path-to-regexp', kind: 'depends-on', ...obs('ev-layer-ctor') },
    { id: 'r-route-router', from: 'route', to: 'router', kind: 'calls', label: 'done / next("route")', ...inf('ev-route-dispatch') },
  ];

  const analysis = {
    scope: {
      summary: 'How Express 4.21.2 routes one HTTP request: from the Node server to app.handle, the base Router\'s layer walk, Route dispatch and the application\'s handlers, including errors and OPTIONS.',
      inScope: ['app.handle and lazy router creation', 'Router.handle / next()', 'Layer matching and handler invocation', 'Route dispatch by method', 'Built-in query and expressInit middleware'],
      outOfScope: ['Request and response helpers (req.*, res.*)', 'View rendering', 'Body parsers and serve-static'],
      entryPoints: ['http-server'],
    },
    files: [
      { path: 'lib/application.js', role: 'primary', reason: 'app.handle, app.use, app.VERB, lazyrouter.', evidence: ['ev-app-handle'] },
      { path: 'lib/router/index.js', role: 'primary', reason: 'The layer walk.', evidence: ['ev-router-next'] },
      { path: 'lib/router/layer.js', role: 'primary', reason: 'Matching and invoking handlers.', evidence: ['ev-layer-match'] },
      { path: 'lib/router/route.js', role: 'primary', reason: 'Per-method dispatch.', evidence: ['ev-route-dispatch'] },
      { path: 'lib/express.js', role: 'supporting', reason: 'Creates the app function.', evidence: ['ev-create-app'] },
      { path: 'lib/middleware/query.js', role: 'supporting', reason: 'First built-in layer.', evidence: ['ev-query'] },
      { path: 'lib/middleware/init.js', role: 'supporting', reason: 'Second built-in layer.', evidence: ['ev-init'] },
      { path: 'test/app.router.js', role: 'test', reason: 'Routing behavior tests.' },
    ],
    components,
    relationships,
    findings: [
      { id: 'f-order', section: 'architecture', title: 'Registration order is matching order', body: 'Router.handle walks one array of layers from the start for every request. app.use and app.get both push onto it, so a middleware registered after a route never runs for requests that route answers.', ...obs('ev-router-next', 'ev-router-use', 'ev-router-route') },
      { id: 'f-arity', section: 'implementation', title: 'Handler arity decides error vs request handling', body: 'Layer.handle_request skips functions with more than three parameters and handle_error skips everything except four-parameter functions. An error handler written with default parameters or rest arguments has a different length and is silently skipped.', ...obs('ev-handle-request', 'ev-handle-error') },
      { id: 'f-sync', section: 'implementation', title: 'Synchronous next() chains are bounded', body: 'Both Router and Route switch to setImmediate after 100 synchronous next() calls.', ...obs('ev-sync-guard', 'ev-route-dispatch') },
      { id: 'f-mount', section: 'architecture', title: 'Mounted paths are stripped from req.url', body: 'A middleware mounted at /api sees /users for /api/users, with req.baseUrl = /api; the URL is restored before the next layer.', ...obs('ev-trim-prefix') },
    ],
    impact: {
      summary: 'Change-impact reading for moving routing into a separate package (as Express 5 did with `router`): which parts of this flow a change to Layer matching would touch.',
      items: [
        { id: 'imp-layer', componentId: 'layer', level: 'high', change: 'modify', reason: 'Path matching and handler invocation live here.', ...obs('ev-layer-match', 'ev-handle-request') },
        { id: 'imp-router', componentId: 'router', level: 'high', change: 'modify', reason: 'The walk interprets Layer results and errors from matchLayer.', ...obs('ev-router-next', 'ev-match-layer') },
        { id: 'imp-route', componentId: 'route', level: 'medium', change: 'review', reason: 'Route pushes Layers with path "/" for its handlers.', ...obs('ev-route-verbs') },
        { id: 'imp-ptr', componentId: 'path-to-regexp', level: 'medium', change: 'review', reason: 'Its syntax defines what a route path can be.', ...inf('ev-layer-ctor') },
        { id: 'imp-tests', file: 'test/app.router.js', level: 'low', change: 'review', reason: 'Routing tests encode matching behavior.', certainty: 'proposed', evidence: [] },
      ],
      relationships: [
        { id: 'ir-ptr-layer', from: 'imp-ptr', to: 'imp-layer', reason: 'A new path syntax changes what Layer.match accepts.', ...inf('ev-layer-ctor') },
        { id: 'ir-layer-router', from: 'imp-layer', to: 'imp-router', reason: 'Router relies on match returning true, false or an error.', ...obs('ev-match-layer') },
        { id: 'ir-layer-route', from: 'imp-layer', to: 'imp-route', reason: 'Route creates Layers for each handler.', ...obs('ev-route-verbs') },
        { id: 'ir-router-tests', from: 'imp-router', to: 'imp-tests', reason: 'Order and error semantics are tested there.', certainty: 'proposed', evidence: [] },
      ],
    },
    risks: [
      { id: 'risk-arity', title: 'Error handlers identified by Function.length', body: 'Wrapping or transpiling a handler can change its length and move it between the request and error paths.', severity: 'medium', ...obs('ev-handle-error', 'ev-handle-request') },
    ],
    testing: [
      { id: 'test-router', title: 'Router tests', body: 'test/app.router.js and test/Router.js cover methods, params, case sensitivity and regexp paths.', certainty: 'unknown', evidence: [] },
    ],
    unknowns: [
      { id: 'u-params', kind: 'limitation', statement: 'process_params (app.param callbacks) was not analyzed.', reason: 'Out of the time budget of this evaluation.' },
      { id: 'u-finalhandler', kind: 'question', statement: 'finalhandler\'s exact 404/500 behavior is in a dependency and was not read.', reason: 'Only its call site is in this repository.', evidence: ['ev-app-handle'] },
    ],
  };

  const visualizations = {
    architecture: [{
      id: 'arch-routing', title: 'Routing components',
      groups: [{ id: 'node', label: 'Node.js runtime' }, { id: 'app', label: 'Application' }, { id: 'routing', label: 'lib/router' }, { id: 'builtin', label: 'Built-in middleware' }, { id: 'deps', label: 'npm dependencies' }, { id: 'user', label: 'Application code' }],
      nodes: [
        { componentId: 'http-server', group: 'node' }, { componentId: 'create-app', group: 'app' }, { componentId: 'application', group: 'app' },
        { componentId: 'router', group: 'routing' }, { componentId: 'layer', group: 'routing' }, { componentId: 'route', group: 'routing' },
        { componentId: 'query-mw', group: 'builtin' }, { componentId: 'init-mw', group: 'builtin' },
        { componentId: 'finalhandler', group: 'deps' }, { componentId: 'path-to-regexp', group: 'deps' }, { componentId: 'user-handlers', group: 'user' },
      ],
      edges: relationships.map((r) => r.id),
    }],
    executionFlows: [{
      id: 'flow-request', title: 'One request through the stack', start: 's-listen',
      steps: [
        { id: 's-listen', label: 'http.Server calls app(req, res)', componentId: 'http-server', next: [{ to: 's-handle' }], ...obs('ev-app-listen', 'ev-create-app') },
        { id: 's-handle', label: 'app.handle', componentId: 'application', next: [{ to: 's-final', condition: 'no router yet' }, { to: 's-next' }], ...obs('ev-app-handle') },
        { id: 's-next', label: 'router next(): find matching layer', componentId: 'router', next: [{ to: 's-final', condition: 'stack exhausted' }, { to: 's-mw', condition: 'middleware layer' }, { to: 's-dispatch', condition: 'route layer with method' }], ...obs('ev-router-next') },
        { id: 's-mw', label: 'trim prefix, call middleware', componentId: 'layer', next: [{ to: 's-next', condition: 'next()' }], ...obs('ev-trim-prefix', 'ev-handle-request') },
        { id: 's-dispatch', label: 'Route.dispatch: method handlers', componentId: 'route', next: [{ to: 's-next', condition: 'next("route") / done' }, { to: 's-respond', condition: 'handler responds' }], ...obs('ev-route-dispatch', 'ev-route-methods') },
        { id: 's-respond', label: 'handler sends response', componentId: 'user-handlers', ...inf('ev-handle-request') },
        { id: 's-final', label: 'finalhandler: 404 or error', componentId: 'finalhandler', ...obs('ev-app-handle') },
      ],
    }],
    sequences: [{
      id: 'seq-get', title: 'GET /users/42 with one route',
      participants: [{ id: 'srv', label: 'http.Server', componentId: 'http-server' }, { id: 'app', label: 'app', componentId: 'application' }, { id: 'rt', label: 'Router', componentId: 'router' }, { id: 'ly', label: 'Layer', componentId: 'layer' }, { id: 'ro', label: 'Route', componentId: 'route' }, { id: 'h', label: 'handler', componentId: 'user-handlers' }],
      messages: [
        { from: 'srv', to: 'app', label: 'app(req, res)', kind: 'call', ...obs('ev-create-app') },
        { from: 'app', to: 'rt', label: 'router.handle(req, res, done)', kind: 'call', ...obs('ev-app-handle') },
        { from: 'rt', to: 'ly', label: 'match(path) for query, expressInit, route', kind: 'call', ...obs('ev-router-next', 'ev-match-layer') },
        { from: 'ly', to: 'ro', label: 'handle_request → dispatch', kind: 'call', ...obs('ev-router-route') },
        { from: 'ro', to: 'h', label: 'handler(req, res, next)', kind: 'call', ...obs('ev-route-dispatch') },
        { from: 'h', to: 'srv', label: 'res.end()', kind: 'return', ...inf('ev-handle-request') },
      ],
    }],
    stateMachines: [{
      id: 'sm-walk', title: 'Layer walk per request', subject: 'Router.handle',
      states: [{ id: 'walking', label: 'Walking stack', initial: true }, { id: 'erroring', label: 'Carrying error' }, { id: 'done', label: 'Done (finalhandler)', terminal: true }, { id: 'answered', label: 'Response sent', terminal: true }],
      transitions: [
        { from: 'walking', to: 'erroring', trigger: 'next(err) or match throws', ...obs('ev-router-next', 'ev-match-layer') },
        { from: 'erroring', to: 'walking', trigger: 'error handler calls next()', ...inf('ev-handle-error') },
        { from: 'walking', to: 'done', trigger: 'stack exhausted', ...obs('ev-router-next') },
        { from: 'erroring', to: 'done', trigger: 'stack exhausted', ...obs('ev-router-next') },
        { from: 'walking', to: 'answered', trigger: 'handler responds', ...inf('ev-handle-request') },
      ],
    }],
    dataFlows: [{
      id: 'df-url', title: 'What happens to req.url',
      nodes: [{ id: 'raw', label: 'req.url from http', kind: 'source' }, { id: 'q', label: 'query middleware', kind: 'process', componentId: 'query-mw' }, { id: 'trim', label: 'trim_prefix', kind: 'process', componentId: 'router' }, { id: 'params', label: 'req.params', kind: 'store' }, { id: 'h', label: 'handlers', kind: 'sink', componentId: 'user-handlers' }],
      flows: [
        { from: 'raw', to: 'q', data: 'query string → req.query', ...obs('ev-query') },
        { from: 'raw', to: 'trim', data: 'mount prefix removed, req.baseUrl set', ...obs('ev-trim-prefix') },
        { from: 'trim', to: 'params', data: 'decoded path parameters', ...obs('ev-layer-match') },
        { from: 'params', to: 'h', data: 'req.params', ...inf('ev-router-next') },
      ],
    }],
  };

  const sections = [
    { id: 'overview', title: 'Overview', kind: 'overview', origin: 'generated' },
    { id: 'scope', title: 'Scope', kind: 'scope', origin: 'generated' },
    { id: 'architecture', title: 'Architecture', kind: 'architecture', origin: 'generated', visualizations: ['arch-routing'] },
    { id: 'flows', title: 'Request flow', kind: 'flows', origin: 'generated', visualizations: ['flow-request', 'seq-get', 'sm-walk', 'df-url'] },
    { id: 'implementation', title: 'Implementation', kind: 'implementation', origin: 'generated' },
    { id: 'impact', title: 'Impact of changing matching', kind: 'impact', origin: 'generated' },
    { id: 'risks', title: 'Risks', kind: 'risks', origin: 'generated' },
    { id: 'testing', title: 'Testing', kind: 'testing', origin: 'generated' },
    { id: 'unknowns', title: 'Unknowns', kind: 'unknowns', origin: 'generated' },
    { id: 'notes', title: 'Reviewer notes', kind: 'custom', origin: 'manual', body: 'Checked against the 4.x docs by a person.', sourceRefs: ['ev-options'] },
    { id: 'references', title: 'Evidence', kind: 'references', origin: 'generated' },
    { id: 'history', title: 'History', kind: 'history', origin: 'generated' },
  ];

  return createManifest({
    feature: { id: 'request-routing', name: 'Express request routing', description: 'How Express 4 routes a request through app, Router, Layer and Route.', mode: 'existing-feature', request: 'Document how a request is routed in Express 4.' },
    repository: { name: 'express', remoteUrl: EXPRESS.remote, revision },
    generatedBy: { source: 'unknown' },
    evidence, analysis, visualizations, sections,
    summary: 'Initial analysis of request routing at 4.21.2.',
    now, repoRoot,
  });
}
