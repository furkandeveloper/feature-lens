// JSDoc types for the manifest, mirroring schema/featurelens-manifest.schema.json.
// The JSON Schema is the source of truth; these types exist for editor
// support and documentation. This module has no runtime exports.

/** @typedef {'observed' | 'inferred' | 'proposed' | 'unknown'} Certainty */
/** @typedef {'high' | 'medium' | 'low'} Level */

/**
 * @typedef {object} Person
 * @property {string} [name]
 * @property {string} [email] only when attribution.includeEmail is enabled
 * @property {string} [githubLogin] only from an authenticated GitHub source or explicit user input
 * @property {'git-config' | 'git-log' | 'github-api' | 'user-provided' | 'unknown'} source
 */

/** @typedef {Person & { commits?: number }} Contributor */

/**
 * @typedef {object} Claim
 * @property {Certainty} certainty
 * @property {string[]} evidence SourceRef ids; required non-empty for observed and inferred
 */

/**
 * @typedef {object} SourceRef
 * @property {string} id
 * @property {string} file POSIX path relative to the repository root
 * @property {number} startLine 1-based, inclusive
 * @property {number} endLine 1-based, inclusive
 * @property {string} [symbol]
 * @property {'definition' | 'call-site' | 'logic' | 'usage' | 'configuration' | 'data-schema' | 'test' | 'documentation' | 'comment' | 'other'} kind
 * @property {string} explanation
 * @property {Level} confidence
 * @property {string} [revision]
 * @property {string} snippetHash `sha256:<hex>` of the cited lines, stamped by createSourceRef
 */

/**
 * @typedef {object} Metadata
 * @property {{ id: string, name: string, description: string, mode: 'existing-feature' | 'change-impact', request: string, proposedChange?: string }} feature
 * @property {{ name: string, remoteUrl?: string, branch?: string, revision?: string, dirty?: boolean }} repository
 * @property {{ name: 'featurelens', version: string }} tool
 * @property {string} generatedAt
 * @property {string} updatedAt
 * @property {Person} generatedBy
 * @property {Contributor[]} contributors
 */

/**
 * @typedef {object} RelevantFile
 * @property {string} path
 * @property {'primary' | 'supporting' | 'test' | 'config' | 'schema' | 'documentation'} role
 * @property {string} reason
 * @property {string[]} [evidence]
 */

/**
 * @typedef {Claim & {
 *   id: string, name: string, summary: string, parent?: string,
 *   kind: 'module' | 'service' | 'function' | 'class' | 'endpoint' | 'model' | 'datastore' | 'external' | 'ui' | 'job' | 'config' | 'test' | 'other',
 *   endpoint?: { protocol: 'http' | 'grpc' | 'graphql' | 'websocket' | 'message' | 'cli' | 'other', method?: string, path: string },
 *   dependency?: { name: string, ecosystem?: string, version?: string },
 * }} Component
 */

/**
 * @typedef {Claim & {
 *   id: string, from: string, to: string, label?: string,
 *   kind: 'calls' | 'imports' | 'reads' | 'writes' | 'emits' | 'subscribes' | 'renders' | 'configures' | 'depends-on' | 'contains',
 * }} Relationship
 */

/** @typedef {Claim & { id: string, section: string, title: string, body: string }} Finding */

/**
 * @typedef {Claim & {
 *   id: string, componentId?: string, file?: string, level: Level, reason: string,
 *   change: 'add' | 'modify' | 'remove' | 'review' | 'none',
 * }} ImpactItem
 */

/** @typedef {Claim & { id: string, from: string, to: string, reason: string }} ImpactRelationship */

/** @typedef {Claim & { id: string, title: string, body: string, severity?: Level }} Note */

/**
 * @typedef {object} Unknown
 * @property {string} id
 * @property {'question' | 'limitation'} kind
 * @property {string} statement
 * @property {string} reason
 * @property {string[]} [evidence]
 */

/**
 * @typedef {object} Analysis
 * @property {{ summary: string, inScope: string[], outOfScope: string[], entryPoints?: string[] }} scope
 * @property {RelevantFile[]} files
 * @property {Component[]} components
 * @property {Relationship[]} relationships
 * @property {Finding[]} findings
 * @property {{ summary: string, items: ImpactItem[], relationships: ImpactRelationship[] }} impact
 * @property {Note[]} risks
 * @property {Note[]} testing
 * @property {Unknown[]} unknowns
 */

/**
 * @typedef {object} ArchitectureView
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {{ id: string, label: string }[]} [groups]
 * @property {{ componentId: string, group?: string }[]} nodes
 * @property {string[]} edges relationship ids
 */

/**
 * @typedef {object} ExecutionFlow
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} start
 * @property {(Claim & { id: string, label: string, componentId?: string, next?: { to: string, condition?: string }[] })[]} steps
 */

/**
 * @typedef {object} Sequence
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {{ id: string, label: string, componentId?: string }[]} participants
 * @property {(Claim & { from: string, to: string, label: string, kind: 'call' | 'return' | 'async' | 'event' })[]} messages
 */

/**
 * @typedef {object} StateMachine
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [subject]
 * @property {{ id: string, label: string, initial?: boolean, terminal?: boolean }[]} states
 * @property {(Claim & { from: string, to: string, trigger: string, guard?: string })[]} transitions
 */

/**
 * @typedef {object} DataFlow
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {{ id: string, label: string, kind: 'source' | 'process' | 'store' | 'sink' | 'external', componentId?: string }[]} nodes
 * @property {(Claim & { from: string, to: string, data: string })[]} flows
 */

/**
 * Every visualization type is optional.
 * @typedef {object} Visualizations
 * @property {ArchitectureView[]} [architecture]
 * @property {ExecutionFlow[]} [executionFlows]
 * @property {Sequence[]} [sequences]
 * @property {StateMachine[]} [stateMachines]
 * @property {DataFlow[]} [dataFlows]
 */

/**
 * @typedef {object} Section
 * @property {string} id
 * @property {string} title
 * @property {'overview' | 'scope' | 'architecture' | 'implementation' | 'flows' | 'impact' | 'risks' | 'testing' | 'unknowns' | 'references' | 'history' | 'custom'} kind
 * @property {'generated' | 'manual'} origin
 * @property {string} [body]
 * @property {string[]} [sourceRefs]
 * @property {string[]} [visualizations]
 * @property {{ historyId: string }} provenance
 */

/**
 * @typedef {object} ValidationSummary
 * @property {boolean} valid
 * @property {number} errorCount
 * @property {number} warningCount
 * @property {boolean} evidenceChecked
 */

/**
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {string} at
 * @property {'created' | 'updated'} action
 * @property {Person} by
 * @property {string} toolVersion
 * @property {string} summary
 * @property {string} [previousRevision]
 * @property {string} [revision]
 * @property {string[]} changedFiles
 * @property {string[]} changedSections
 * @property {ValidationSummary} validation
 */

/**
 * @typedef {object} Manifest
 * @property {string} schemaVersion
 * @property {Metadata} metadata
 * @property {SourceRef[]} evidence
 * @property {Analysis} analysis
 * @property {Visualizations} visualizations
 * @property {{ sections: Section[] }} documentation
 * @property {HistoryEntry[]} history
 */

export {};
