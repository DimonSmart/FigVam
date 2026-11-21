# Provenance

Replacement preflight: intent-preserving, implementation-only; user forbids Product Intent and Engineering mutation, new capabilities and public contract changes. Existing product behavior and ENG-0001–0005 apply; no owner mutation required. Profile remains unexpanded and server authoritative. Existing specs cover behavior and user explicitly requires preservation. No unresolved product or engineering policy decision identified.
Original baseline preserved: cd13c97282204844dc3f0d296b8e26eb234dcc63, Git object verified. HEAD at replacement e78f9939d2a71591a93d87d395d9dcf045eee87b. Prior active run provenance records previous Worker interrupted and host confirmed; current native agent inventory contains only root. Prior state preserved under .idd/factory/results/replaced-stabilization-20261119/ including original directories. Untracked result artifacts pre-exist and remain untouched; pending previous-worker changes are of unknown attribution. Product Intent and Engineering currently clean. No normative changes authorized.

Pending Worker 01: CI task in plan.md, HEAD e78f9939d2a71591a93d87d395d9dcf045eee87b; original baseline cd13c97282204844dc3f0d296b8e26eb234dcc63. Preserve existing untracked artifacts. No Intent or Engineering mutations authorized. Standard Codex mapping gpt-6.1-terra/high.

Worker 01 native wait timed out; interrupted via host and confirmed status interrupted. No trusted terminal result. Task remains pending; preserve any partial changes and artifacts; inspect repository reality with a fresh Worker on continuation. No rollback.

Continue: prior native worker idd_factory_worker_01 confirmed interrupted via list_agents; its wait call was collaboration.wait_agent({timeout_ms:60000}), returned timed_out:true; interrupt_agent returned previous_status running and subsequent list_agents confirmed interrupted. No trusted result. Git HEAD e78f9939d2a71591a93d87d395d9dcf045eee87b; no product/CI tracked or untracked changes found after interruption; pre-existing result artifacts and archived state preserved. Pending fresh Worker for unchanged CI task; standard maps gpt-6.1-terra/high; Always ENG-0001/0002; no Intent/Engineering edits authorized.

Continue Worker 02: native call collaboration.wait_agent({timeout_ms:60000}) returned {message:'Wait timed out.',timed_out:true}; configured limit 60000 ms. collaboration.interrupt_agent({target:'idd_factory_worker_02'}) returned previous_status:'running'; subsequent collaboration.list_agents confirmed /root/idd_factory_worker_02 status 'interrupted'. No trusted terminal result. Task remains first in plan.md; preserve any partial changes. Cause beyond expiration of caller-specified 60-second wait is not established. No parallel writer was started.

Continuation Worker 03 pending: CI task remains first in plan.md. HEAD e78f9939d2a71591a93d87d395d9dcf045eee87b; baseline cd13c97282204844dc3f0d296b8e26eb234dcc63. Native agent inventory shows only root; earlier workers are confirmed interrupted in prior checkpoint. Existing untracked .github and test artifacts have unknown attribution and must be preserved. No Intent or Engineering mutation authorized. Standard Codex mapping gpt-6.1-terra/high; Always ENG-0001 and ENG-0002.

Worker 03: native wait timed out after 60000 ms; interrupt_agent returned previous_status running, and list_agents confirmed interrupted. No trusted terminal result. Worker reported locked restore and build passed, server tests and 171 Playwright tests started, but their completion is unverified. Task remains pending; preserve partial changes and artifacts. No replacement writer started.

Continuation pending Worker 04: first CI task unchanged; previous Worker 03 confirmed interrupted and native inventory now shows only root. HEAD e78f9939d2a71591a93d87d395d9dcf045eee87b; original baseline cd13c97282204844dc3f0d296b8e26eb234dcc63 verified as commit. Preserve partial and unknown changes and existing test artifacts. No Intent or Engineering changes authorized. Standard Codex mapping gpt-6.1-terra/high; Always ENG-0001 and ENG-0002.

Worker 04 completed natively: CI workflow .github/workflows/ci.yml changed from pre-existing untracked state, attribution of prior content unknown; current SHA256 recorded in completed.md. Existing artifacts preserved. No normative edits authorized. Locked restore/build passed; server 441/442 with failed test passing isolated; Playwright 163/171, four failures reproduced. Full success and remote CI remain unverified; hand evidence to planner.

Continuation stopped: after Worker 04 completed, fresh Planner 01 returned BLOCKED because installed 2.0.108 Planner SKILL.md disappeared from the exact plugin path. Root independently confirmed Test-Path false. No planning or replacement writer started. Active request, empty remaining plan, completed evidence and provenance preserved; restore the same installed plugin before continuing with a fresh Planner. No normative edits authorized.

Pending Worker b0001_0001: Playwright failure investigation per plan.md. Before: HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; working tree clean; original baseline cd13c97282204844dc3f0d296b8e26eb234dcc63. Previously committed CI and artifacts have unknown attribution. No Intent or Engineering edits authorized. Standard Codex mapping gpt-6.1-terra/high; Always ENG-0001 and ENG-0002.

Worker b0001_0001 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1. Modified only tests/FigVam.Ui.Tests/document-deletion.spec.js, document-rename.spec.js, editor.spec.js, members.spec.js; no Intent/Engineering changes. Full Playwright 171/171 and focused repetitions passed. Pending checkpoint closed.

Pending Worker b0001_0002: API client extraction per plan.md. Before HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, four Playwright specs modified by verified Worker b0001_0001; prior artifacts preserved. No normative edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002.

Worker b0001_0002 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; modified editor.js and added api-client.js. Earlier four test spec changes preserved; no Intent/Engineering edits. Focused Playwright 32/32. Pending checkpoint closed.

Pending Worker b0001_0003: session and asynchronous request lifecycle extraction per plan.md. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior verified Worker changes. No normative edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002.

Worker b0001_0003 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; modified editor.js, added session.js; previous Worker files preserved. No Intent/Engineering edits. Focused Playwright 32/32. Pending checkpoint closed.

Pending Worker b0001_0004: canvas and viewport extraction per plan.md. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve verified Worker changes and unknown artifacts. No normative edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002.

Worker b0001_0004 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js and editor.spec.js, presence.spec.js; added canvas-viewport.js; previous verified Worker changes preserved. No Intent/Engineering edits. Focused Playwright 37/37, updated checks 2/2. Pending checkpoint closed.

Pending Worker b0001_0005: Portable UI Profile source analysis per plan.md. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve previous verified changes and unknown artifacts. No normative edits authorized. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002; Conditional ENG-0003.

Worker b0001_0005 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; no project edits, existing verified changes preserved. No Intent/Engineering edits. Focused server 32 and Playwright 64 passed. Pending checkpoint closed.

Pending Worker b0001_0006: screen diagnostics extraction, first of three tasks in plan.md. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No normative edits. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002; Conditional ENG-0003, ENG-0005.

Worker b0001_0006 trusted normal terminal: completed. HEAD remains f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, diagnostics.spec.js and added screen-diagnostics.js. Prior changes preserved, no Intent/Engineering edits. Focused Playwright 20/20 and 7/7. Pending checkpoint closed.

Pending Worker b0001_0007: read-only backend responsibility assessment per first remaining task. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; prior changes preserved; no normative edits. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0001_0007 trusted normal terminal: completed read-only. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1 unchanged, prior changes preserved. 160 targeted server tests passed existing build. Pending checkpoint closed.

Pending Worker b0001_0008: README technical update per remaining task. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No normative edits. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002.

Worker b0001_0008 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed README.md only, preserved prior work; no Intent/Engineering edits. README diff check passed. Pending checkpoint closed.

Pending Worker b0002_0001: structural transitions task in plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve existing verified changes and unknown artifacts. No Intent or Engineering edits authorized. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0002_0001 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed DocumentCommands.cs, DocumentStructure.cs, SqliteDocumentJournal.cs, DocumentCommandTests.cs. Prior changes preserved; no Intent or Engineering edits. Focused server tests 30/30, full suite 443/443. Pending checkpoint closed.

Pending Worker b0002_0002: SQL event projection task in plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0002_0002 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed SqliteDocumentJournal.cs and DocumentReconnectTests.cs; prior work preserved, no Intent or Engineering edits. Focused server tests 13/13. Pending checkpoint closed.

Pending Worker b0002_0003: scenario editor extraction task in plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior changes. No Intent or Engineering edits authorized. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002; Conditional ENG-0003.

Worker b0002_0003 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs; added scenarios.js. Prior work preserved; no Intent or Engineering edits. Server shell 1/1 and Playwright 76/76 passed. Pending checkpoint closed.

Pending Worker b0002_0004: token management extraction per plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002.

Worker b0002_0004 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs; added tokens.js. Prior work preserved; no Intent or Engineering edits. Server tests 25/25, Playwright 19/19. Pending checkpoint closed.

Pending Worker b0002_0005: layer tree and node operations extraction per plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior changes. No Intent or Engineering edits authorized. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002; Conditional ENG-0003.

Worker b0002_0005 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs; added layers.js. Prior work preserved; no Intent or Engineering edits. Server 44/44, Playwright 93/93 and 22/22. Pending checkpoint closed.

Pending Worker b0002_0006: dataset management extraction per plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0002_0006 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs; added datasets.js. Prior work preserved; no Intent or Engineering edits. Shell 1/1, Playwright 5/5. Pending checkpoint closed.

Pending Worker b0002_0007: component catalog extraction per plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002.

Worker b0002_0007 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs, components.spec.js; added components.js. Prior work preserved; no Intent or Engineering edits. Server 3/3; Playwright 3/3 and 15/15. Pending checkpoint closed.

Pending Worker b0002_0008: versions and history extraction per plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1, preserve prior changes. No Intent or Engineering edits authorized. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002.

Worker b0002_0008 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs, history-actions.spec.js; added document-history.js. Prior work preserved; no Intent or Engineering edits. Server 32/32, Playwright 32/32. Pending checkpoint closed.

Pending Worker b0003_0001: presence extraction per first task in plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0003_0001 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs, presence.spec.js; added presence.js. Prior changes preserved; no Intent or Engineering edits. Server 22/22, Playwright 34/34 and 14/14. Pending checkpoint closed.

Pending Worker b0003_0002: member management extraction per remaining task in plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0003_0002 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs; added members.js. Prior changes preserved; no Intent or Engineering edits. Server 23/23, Playwright 19/19. Pending checkpoint closed. The earlier plan removal left residual TaskRelated sections before the second task due to prefix matching; confirmed these belonged to completed b0003_0001, and removed with completed second task at checkpoint.

Pending Worker b0003_0003: live collaboration lifecycle extraction per plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No Intent or Engineering edits authorized. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0003_0003 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; changed editor.js, EditorEndpoints.cs, EditorUiTests.cs; added document-collaboration.js. Prior changes preserved; no Intent or Engineering edits. Server 11/11 and Playwright 34/34. Pending checkpoint closed.

Pending Worker b0003_0004: screen resize extraction per first task in plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0003_0004 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; screen resize module, shell route and tests updated. Prior changes preserved; no Intent or Engineering edits. Server route and 4 tests, Playwright 9/9 passed. Pending checkpoint closed.

Pending Worker b0003_0005: screen variants extraction per remaining task in plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002; Conditional ENG-0004.

Worker b0003_0005 trusted normal terminal: completed. HEAD unchanged f955d41e3df30d91d56839f03566f96e9290f8c1; screen-variants.js added, editor, server route and tests updated. Prior changes preserved; no Intent or Engineering edits. Server 9/9 and Playwright 58/58 plus new test 1/1 passed. Pending checkpoint closed.

Pending Worker b0003_0006: document export extraction per plan.md; HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve prior changes. No Intent or Engineering edits authorized. Standard gpt-6.1-terra/high; Always ENG-0001, ENG-0002.

Recovery after host usage-limit failure: previous Root b0003 and Worker b0003_0006 both have confirmed native errored termination, as reported by Supervisor; no trusted Worker result. Pending export task remains in plan. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1 and original baseline cd13c97282204844dc3f0d296b8e26eb234dcc63 verified; working changes preserved, no Intent/Engineering diff. Existing partial work is retained without attribution or rollback. Fresh Worker may reconcile and finish the same task. Standard mapping gpt-6.1-terra/high; Always ENG-0001 and ENG-0002; no Intent/Engineering edits authorized.

Worker b0001_9001 trusted normal terminal: completed export task. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1 unchanged; added document-export.js, changed editor.js, EditorEndpoints.cs and EditorUiTests.cs. Existing changes preserved, no Intent or Engineering changes. Server 1/1 and Playwright 20/20 passed. Test output artifact retained. Pending checkpoint closed.

Pending Worker b0001_9002: focused drift audit, read-only task per plan.md. HEAD f955d41e3df30d91d56839f03566f96e9290f8c1; preserve all changes and artifacts. No Intent or Engineering edits authorized. Strong gpt-6.2-sol/medium; Always ENG-0001, ENG-0002; Conditional ENG-0003, ENG-0004, ENG-0005.

Worker b0001_9002 trusted normal terminal: completed read-only focused drift audit; source and normative trees unchanged. Fresh restore/build, 443 server and 177 Playwright tests passed. Pre-existing deep-link and reference layout integration gaps reported, remote Actions unverified. Pending checkpoint closed.
