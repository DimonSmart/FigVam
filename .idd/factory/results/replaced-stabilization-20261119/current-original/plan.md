# Task

Implement an accessible node-creation palette in the editor using the existing `add-node` typed command. The palette must obtain its available node kinds from the document’s resolved Portable UI Profile through a single server-owned capability source; do not maintain an independent client list. Extend the profile interface and expose an authenticated, revision-aware query if needed. The current production profile remains empty: show a clear empty state and do not claim support for any node kind.

Allow an Owner or Editor to add a supported kind to the selected screen or an eligible selected container, using fresh UUIDs and the existing command contract. Respect the profile’s containment rules and current revision/context. Handle refusal, concurrent deletion or access loss, uncertain outcomes with an identical-command retry, duplicate submission, and stale responses after selection, screen, document or session changes. Viewer remains read-only. Refresh the layer tree and selection only after confirmed acceptance.

Verify the empty production profile and a limited test profile, authorization, containment, command behavior, keyboard accessibility and relevant failure/context transitions. Preserve all existing changes and test artifacts, including `.idd/execution.yaml`. Do not edit Intent or Engineering, expand the production profile, add compatibility fallback, or change unrelated behavior.

# ExecutionProfile

strong

# TaskRelatedIntent

IDD-0002
IDD-0003
IDD-0004
IDD-0008
IDD-0010
IDD-0012

# TaskRelatedEngineering

ENG-0003
ENG-0004
