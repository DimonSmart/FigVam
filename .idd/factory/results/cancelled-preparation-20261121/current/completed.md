# CI task

Worker 04 completed CI setup in .github/workflows/ci.yml (SHA256 86034930E0CA00EEC55E9631D7C5E4A91A9965F33FC32C40C4C09E4DA2379A25; previous untracked content attribution unknown). Locked restore, build, npm ci, Chromium install passed; server 441/442, failed RawUploadReadsPermissionsContractsAndRestart passed alone. Playwright 163/171; 4 representative failures reproduced: document-deletion.spec.js:31 route already handled; editor.spec.js:15 ambiguous status; editor.spec.js:227 expected 20 screens got 0; editor.spec.js:304 expected Нет доступа got Выберите экран. Reproduce from tests/FigVam.Ui.Tests: npx playwright test document-deletion.spec.js editor.spec.js --grep 'Editor and Viewer cannot delete|creates a named document|creates and selects screens|reads paginated nested layers' --trace retain-on-failure. Diagnostics in $env:TEMP/figvam-ci-worker04-ui, figvam-ci-worker04-focused, figvam-ci-worker04-server. Remote Actions not run. Planner must evaluate failures and remaining request.

# Playwright failure investigation (Worker b0001_0001)
Corrected four Playwright spec files: document-deletion, document-rename, editor and members. Causes were route-handler completion races, ambiguous status selector, obsolete expectation for access loss and rate limiting during setup. Full Playwright passed 171/171; focused tests 12/12; screens 5/5, rename 5/5, members 10/10. Diagnostics: $env:TEMP/figvam-worker-final2. Application and normative files unchanged.

# API client extraction (Worker b0001_0002)
Extracted common JSON API client into src/FigVam.Server/wwwroot/api-client.js, with token and unauthorized dependencies supplied by editor.js. Specialized requests retained. Playwright editor.spec.js node-reparent.spec.js document-deletion.spec.js passed 32/32, including authentication, errors and stale responses.

# Session and requests (Worker b0001_0003)
Extracted token, generation, navigation and main request cancellation lifecycle into session.js; editor.js uses module bindings. Playwright editor.spec.js collaboration.spec.js document-deletion.spec.js passed 32/32, including auth, cancellation, retry, stale response and subscriptions.

# Canvas and viewport (Worker b0001_0004)
Extracted canvas and viewport management to canvas-viewport.js with explicit dependencies. Added behavioral coverage for grid, navigation reset and presence coordinates. Playwright editor, screen-resize, presence, collaboration 37/37, and updated targeted checks 2/2.

# Portable UI Profile authority (Worker b0001_0005)
Traced ScenarioCapabilitiesQuery through INodeProfile and client choices and submission; local tables encode labels and known protocol values, not independent eligibility. Reparent uses server canContainChildren projected from same profile as command validation. No duplicate source found and no code edits. Empty production profile and restricted/stale/error cases checked: 32 server tests and 64 Playwright tests passed.

# Screen diagnostics (Worker b0001_0006)
Extracted selected screen diagnostics into screen-diagnostics.js, preserving request lifecycle. Playwright diagnostics and editor 20/20; diagnostics 7/7 including invalid and stale revision responses.

# Backend assessment (Worker b0001_0007)
Read-only audit, 160 focused server tests passed on existing build. Evidence: AddScreen/AddNode structural transitions duplicated between DocumentCommands.cs:893-950 and SqliteDocumentJournal.cs:690-710; shared pure DocumentStructureEditor transitions could avoid replay divergence, preserve separate validation. Three identical used-ID predicates in DocumentCommands.cs:843,894,929 could be consolidated without changing failure ordering. SqliteDocumentJournal.cs:127 and :560 duplicate the same positional 15-column event projection; shared query could avoid drift, preserving bounds, transactions and fallback. Component creation validates the same candidate twice (DocumentCommands.cs:574, ComponentModel.cs:250) and DocumentStructure.cs:251 duplicates ValidateStructure through ComponentValidator; any changes must preserve standalone validation, guards and diagnostic order. No confirmed responsibility issues in transport, layout and JSON/ZIP reader; double authorization protects revocation, transaction binds journal/history/result/snapshot.

# README update (Worker b0001_0008)
Updated Initial browser workspace to describe implemented operations, export and canvas/profile limits. Adjacent run and test instructions checked against configuration and tests. git diff --check -- README.md passed; no test rerun for documentation-only edit.

# Shared structural transitions (Worker b0002_0001)
Shared pure AddScreen/AddNode transitions in DocumentStructureEditor for commands and SQLite replay; separate validation preserved. Added replay equivalence test across three revisions including nested node. Focused server tests 30/30 and full suite 443/443 passed.

# Shared event projection (Worker b0002_0002)
Unified SQLite event projection and joins for replay and reconnect; added comparison between restored state and event application at each revision. Focused reconnect, replay and revision tests passed 13/13.

# Scenario editor and module routes (Worker b0002_0003)
Extracted scenario catalog and editor into scenarios.js; mapped earlier JS modules and new module through server shell routes after confirming imports returned 401. Server shell test 1/1 and fresh-build Playwright 76/76 passed.

# Token management (Worker b0002_0004)
Extracted token management to tokens.js, registered shell route and extended server route test. Server Token/EditorUi 25/25 and Playwright tokens/editor 19/19 passed.

# Layers and node operations (Worker b0002_0005)
Extracted layer tree and node operations into layers.js and registered route. Build passed with existing ASPIRE010 warning; 44 server tests, broad Playwright 93/93 and final focused 22/22 passed.

# Dataset management (Worker b0002_0006)
Extracted datasets.js, registered shell route and extended delivery test. Server shell 1/1 and dataset Playwright 5/5 passed including retry, validation and conflict.

# Component catalog (Worker b0002_0007)
Extracted components.js and registered route; added stale search response behavior test. Build passed with existing Aspire warning; server 3/3, Playwright components 3/3 and editor 15/15.

# Document history (Worker b0002_0008)
Extracted versions, restore, undo and redo into document-history.js, registered route, added history-request cancellation test on document change. Server 32/32 and Playwright 32/32 passed.

# Presence extraction (Worker b0003_0001)
Extracted presence.js with explicit context and viewport conversion; registered server route and added test for stopping polling and clearing participants on 403. Server tests 22/22; Playwright 34/34 and 14/14 passed.

# Members extraction (Worker b0003_0002)
Extracted members.js with explicit dependencies, registered and verified server route. Server tests 23/23 and Playwright 19/19 passed, covering permissions and navigation.

# Collaboration lifecycle extraction (Worker b0003_0003)
Extracted document-collaboration.js for stream, ordering, reconnect and cancellation; registered server route. Server 11/11 and Playwright 34/34 passed covering reconnect, navigation and access loss.

# Screen resize extraction (Worker b0003_0004)
Extracted screen resize to a module with explicit dependencies, registered delivery. Server route and 4 resize/command tests, Playwright 9/9 passed including same command ID retry and navigation.

# Screen variants extraction (Worker b0003_0005)
Extracted screen-variants.js with explicit context, registered server route; added uncertain command retry after screen navigation. Server 9/9, Playwright 58/58 and new test 1/1 passed.

# Document export extraction (Worker b0001_9001)
Extracted document-export.js with explicit dependencies and 401 handling, registered shell delivery. Server delivery test 1/1 and Playwright export and editor 20/20 passed. Intent and Engineering unchanged; test-results-export-focused artifact retained.

# Focused intent drift audit (Worker b0001_9002)
Audited editor/session, profile authority, commands/replay, API, formats, revisions, authorization and collaboration. No stabilization regressions identified; ENG-0001–0004 conform in scope. Pre-existing IDD-0004 direct links select document only (editor.js:580), and ENG-0005 reference layout engine lacks production integration in Preview/export geometry. Scoped Intent and Engineering unchanged; IDD-0014 differs from original baseline due to pre-stabilization commit 6305306. Fresh locked restore/build passed (existing ASPIRE010); server 443/443 and Playwright 177/177. Remote GitHub Actions unverified. Server TRX: C:/Users/Dorog/AppData/Local/Temp/figvam-drift-fresh-server-42d9b4820fe04fd591be98867bc0df8a/audit.trx. UI results: C:/Users/Dorog/AppData/Local/Temp/figvam-drift-fresh-ui-e1f6f0eb974d47f2bda2fb9a1472ac68.
