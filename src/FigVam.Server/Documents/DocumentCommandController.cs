using FigVam.Application.Documents;
using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FigVam.Server.Documents;

[ApiController, Authorize, Route("api/v1/documents/{documentId}/commands")]
[Produces("application/json")]
[ProducesResponseType<CommandResponse>(200)]
[ProducesResponseType<ApiError>(400), ProducesResponseType<ApiError>(401), ProducesResponseType<ApiError>(403)]
[ProducesResponseType<ApiError>(404), ProducesResponseType<ApiError>(409), ProducesResponseType<ApiError>(413)]
[ProducesResponseType<ApiError>(415), ProducesResponseType<ApiError>(429), ProducesResponseType<ApiError>(500)]
public sealed class DocumentCommandController(IDocumentCommandHandler handler) : ControllerBase
{
    [HttpPost("upgrade-portable-ui-profile"), EndpointSummary("Explicitly upgrade Portable UI Profile v1 to v2 or v2 to v3 at the expected revision")]
    public async Task<IActionResult> UpgradePortableUiProfile(Guid documentId, UpgradePortableUiProfileRequest request, CancellationToken ct) =>
        Result(await handler.HandleAsync(new UpgradePortableUiProfileCommand(documentId, request.CommandId, request.ExpectedRevision), User.GetDocumentActor(), ct));

    [HttpPost("create-scenario"), RequestSizeLimit(1024 * 1024), EndpointSummary("Create a saved prototype event and ordered actions")]
    [EndpointDescription("Scenario requires a globally unique ID, screenId, nodeId, numeric event (Click=0, Change=1, Hover=2, Leave=3, Submit=4), and 1-32 typed actions. Profile must explicitly support the event, actions and demo value targets.")]
    public async Task<IActionResult> CreateScenario(Guid documentId, CreateScenarioRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new CreateScenarioCommand(documentId, request.CommandId, request.Scenario), User.GetDocumentActor(), ct));
    [HttpPost("update-scenario"), RequestSizeLimit(1024 * 1024), EndpointSummary("Replace one saved scenario with an exact revision precondition")]
    public async Task<IActionResult> UpdateScenario(Guid documentId, UpdateScenarioRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new UpdateScenarioCommand(documentId, request.CommandId, request.Scenario, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("delete-scenario"), EndpointSummary("Delete one saved scenario with an exact revision precondition")]
    public async Task<IActionResult> DeleteScenario(Guid documentId, DeleteScenarioRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new DeleteScenarioCommand(documentId, request.CommandId, request.ScenarioId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("add-screen-variant"), EndpointSummary("Create an empty screen variant inheriting base node properties")]
    public async Task<IActionResult> AddScreenVariant(Guid documentId, AddScreenVariantRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddScreenVariantCommand(documentId, request.CommandId, request.ScreenId, request.VariantId, request.Name), User.GetDocumentActor(), ct));
    [HttpPost("set-screen-variant-override"), EndpointSummary("Set a typed property difference for a node belonging to the screen")]
    public async Task<IActionResult> SetScreenVariantOverride(Guid documentId, SetScreenVariantOverrideRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetScreenVariantOverrideCommand(documentId, request.CommandId, request.ScreenId, request.VariantId, request.NodeId, request.Property, request.Value), User.GetDocumentActor(), ct));
    [HttpPost("remove-screen-variant-override"), EndpointSummary("Remove one screen property difference to inherit the base value")]
    public async Task<IActionResult> RemoveScreenVariantOverride(Guid documentId, RemoveScreenVariantOverrideRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RemoveScreenVariantOverrideCommand(documentId, request.CommandId, request.ScreenId, request.VariantId, request.NodeId, request.Property, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("set-screen-variant-properties"), EndpointSummary("Atomically set multiple node property overrides for a variant at an expected revision")]
    public async Task<IActionResult> SetScreenVariantProperties(Guid documentId, SetScreenVariantPropertiesRequest request, CancellationToken ct) =>
        Result(await handler.HandleAsync(new SetScreenVariantPropertiesCommand(documentId, request.CommandId, request.ScreenId, request.VariantId,
            request.NodeId, request.Properties, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("set-component-variant-parameter-change"), EndpointSummary("Set one typed parameter difference on an existing component variant")]
    public async Task<IActionResult> SetComponentVariantParameterChange(Guid documentId, SetComponentVariantParameterChangeRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetComponentVariantParameterChangeCommand(documentId, request.CommandId, request.DefinitionId, request.VariantId, request.ParameterId, request.Value), User.GetDocumentActor(), ct));
    [HttpPost("remove-component-variant-parameter-change"), EndpointSummary("Remove one variant parameter difference to inherit its base variant or parameter default")]
    public async Task<IActionResult> RemoveComponentVariantParameterChange(Guid documentId, RemoveComponentVariantParameterChangeRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RemoveComponentVariantParameterChangeCommand(documentId, request.CommandId, request.DefinitionId, request.VariantId, request.ParameterId), User.GetDocumentActor(), ct));
    [HttpPost("set-component-parameter-default"), EndpointSummary("Set the typed default value of a component parameter")]
    public async Task<IActionResult> SetComponentParameterDefault(Guid documentId, SetComponentParameterDefaultRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetComponentParameterDefaultCommand(documentId, request.CommandId, request.DefinitionId, request.ParameterId, request.Value), User.GetDocumentActor(), ct));
    [HttpPost("add-component-slot"), EndpointSummary("Expose a container in the component definition as a slot")]
    public async Task<IActionResult> AddComponentSlot(Guid documentId, AddComponentSlotRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddComponentSlotCommand(documentId, request.CommandId, request.DefinitionId, new(request.SlotId, request.Name, request.ContainerNodeId)), User.GetDocumentActor(), ct));
    [HttpPost("set-component-slot-content"), EndpointSummary("Assign ordered direct children of an instance to its slot; an empty list clears assignment and preserves nodes")]
    public async Task<IActionResult> SetComponentSlotContent(Guid documentId, SetComponentSlotContentRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetComponentSlotContentCommand(documentId, request.CommandId, request.NodeId, request.SlotId, request.ContentNodeIds), User.GetDocumentActor(), ct));
    [HttpPost("add-component-variant"), EndpointSummary("Add parameter differences from a base variant in the same component; built-in kinds are unique")]
    public async Task<IActionResult> AddComponentVariant(Guid documentId, AddComponentVariantRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddComponentVariantCommand(documentId, request.CommandId, request.DefinitionId, new(request.VariantId, request.Name, request.Kind, request.BaseVariantId, request.ParameterChanges)), User.GetDocumentActor(), ct));
    [HttpPost("set-component-instance-variant"), EndpointSummary("Select a variant of the instance definition, or clear selection with null; explicit overrides take priority")]
    public async Task<IActionResult> SetComponentInstanceVariant(Guid documentId, SetComponentInstanceVariantRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetComponentInstanceVariantCommand(documentId, request.CommandId, request.NodeId, request.VariantId), User.GetDocumentActor(), ct));
    [HttpPost("set-component-parameter-override"), EndpointSummary("Set a typed component instance parameter override")]
    public async Task<IActionResult> SetComponentParameterOverride(Guid documentId, SetComponentParameterOverrideRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetComponentParameterOverrideCommand(documentId, request.CommandId, request.NodeId, request.ParameterId, request.Value), User.GetDocumentActor(), ct));
    [HttpPost("remove-component-parameter-override"), EndpointSummary("Remove a component instance parameter override to inherit its variant or default")]
    public async Task<IActionResult> RemoveComponentParameterOverride(Guid documentId, RemoveComponentParameterOverrideRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RemoveComponentParameterOverrideCommand(documentId, request.CommandId, request.NodeId, request.ParameterId), User.GetDocumentActor(), ct));
    [HttpPost("delete-component-definition"), EndpointSummary("Delete a component definition at the expected revision; used definitions require explicit compatible replacement mappings or prior detachment of all instances")]
    public async Task<IActionResult> DeleteComponentDefinition(Guid documentId, DeleteComponentDefinitionRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new DeleteComponentDefinitionCommand(documentId, request.CommandId, request.DefinitionId, request.ExpectedRevision,
        request.Replacement is { } replacement ? new(replacement.DefinitionId, replacement.ParameterIds, replacement.SlotIds, replacement.VariantIds) : null), User.GetDocumentActor(), ct));
    [HttpPost("detach-component-instance"), EndpointSummary("Materialize a component instance at the expected revision and remove its definition link")]
    public async Task<IActionResult> DetachComponentInstance(Guid documentId, DetachComponentInstanceRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new DetachComponentInstanceCommand(documentId, request.CommandId, request.NodeId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("insert-component-instance"), EndpointSummary("Insert a component instance at a parent child position")]
    public async Task<IActionResult> InsertComponentInstance(Guid documentId, InsertComponentInstanceRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new InsertComponentInstanceCommand(documentId, request.CommandId, request.NodeId, request.DefinitionId, request.ParentId, request.Position), User.GetDocumentActor(), ct));
    [HttpPost("add-component-parameter"), EndpointSummary("Add a typed component parameter and bind it to a definition node property")]
    public async Task<IActionResult> AddComponentParameter(Guid documentId, AddComponentParameterRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddComponentParameterCommand(documentId, request.CommandId, request.DefinitionId, new(request.ParameterId, request.Name, request.Type, request.DefaultValue, request.TokenType, request.EnumValues), request.NodeId, request.Property), User.GetDocumentActor(), ct));
    [HttpPost("add-component-definition"), EndpointSummary("Create a component definition from an existing document subtree")]
    public async Task<IActionResult> AddComponentDefinition(Guid documentId, AddComponentDefinitionRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddComponentDefinitionCommand(documentId, request.CommandId, request.ComponentId, request.Name, request.Description, request.RootNodeId), User.GetDocumentActor(), ct));
    [HttpPost("set-token-value"), EndpointSummary("Set a typed token value for a theme")]
    public async Task<IActionResult> SetTokenValue(Guid documentId, SetTokenValueRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetTokenValueCommand(documentId, request.CommandId, request.TokenId, request.Theme, request.Value), User.GetDocumentActor(), ct));
    [HttpPost("rename-token"), EndpointSummary("Rename a token without changing its technical ID")]
    public async Task<IActionResult> RenameToken(Guid documentId, RenameTokenRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RenameTokenCommand(documentId, request.CommandId, request.TokenId, request.Name), User.GetDocumentActor(), ct));
    [HttpPost("add-csv-dataset"), RequestSizeLimit(512 * 1024), EndpointSummary("Create a local dataset from a CSV snapshot")]
    [EndpointDescription("CSV has unique nonblank headers, comma delimiters and LF or CRLF records. Quotes enclose fields and doubled quotes escape a quote. Every row has the header column count; values become JSON strings. CSV and resulting JSON are each limited to 65536 UTF-8 bytes. See README for the complete format.")]
    public async Task<IActionResult> AddCsvDataset(Guid documentId, AddCsvDatasetRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddCsvDatasetCommand(documentId, request.CommandId, request.DatasetId, request.Name, request.Csv), User.GetDocumentActor(), ct));
    [HttpPost("replace-dataset-fixture-from-csv"), RequestSizeLimit(512 * 1024), EndpointSummary("Replace a dataset fixture from a CSV snapshot at the expected revision")]
    [EndpointDescription("Uses the CSV format and limits of add-csv-dataset and the revision precondition of replace-dataset-fixture.")]
    public async Task<IActionResult> ReplaceDatasetFixtureFromCsv(Guid documentId, ReplaceDatasetFixtureFromCsvRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new ReplaceDatasetFixtureFromCsvCommand(documentId, request.CommandId, request.DatasetId, request.ExpectedRevision, request.Csv), User.GetDocumentActor(), ct));
    [HttpPost("set-node-repeater"), EndpointSummary("Set a local dataset repeater at the expected revision, or clear it with null")]
    [EndpointDescription("Template and empty view are distinct direct children. Relative bindings target scalar properties in the concrete template. Nested repeaters are rejected. Expanded nodes and paths share a 10000 work budget, with at most 1000 items and 100 bindings.")]
    public async Task<IActionResult> SetNodeRepeater(Guid documentId, SetNodeRepeaterRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetNodeRepeaterCommand(documentId, request.CommandId, request.NodeId, request.ExpectedRevision, request.Repeater), User.GetDocumentActor(), ct));
    [HttpPost("bind-node-data"), EndpointSummary("Bind a scalar node property to a saved local dataset fixture")]
    [EndpointDescription("Requires an existing dataset and node, a path of at most 32 typed property/index segments, and a string, number or boolean target supported by the current profile. Value requires an explicit matching expectedType. Count returns a number; isEmpty, isPresent and isNull return booleans. The current fixture must evaluate successfully and satisfy profile value constraints. Binding preserves the stored literal; unbinding exposes it again. Fixture replacements may produce data diagnostics without changing the binding. No scripts or remote sources are supported.")]
    public async Task<IActionResult> BindNodeData(Guid documentId, BindNodeDataRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new BindNodeDataCommand(documentId, request.CommandId, request.NodeId, request.Property, request.Binding), User.GetDocumentActor(), ct));
    [HttpPost("unbind-node-data"), EndpointSummary("Remove a node property data binding while preserving its stored literal")]
    public async Task<IActionResult> UnbindNodeData(Guid documentId, UnbindNodeDataRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new UnbindNodeDataCommand(documentId, request.CommandId, request.NodeId, request.Property), User.GetDocumentActor(), ct));
    [HttpPost("delete-dataset"), EndpointSummary("Delete an unreferenced local dataset at the expected revision")]
    public async Task<IActionResult> DeleteDataset(Guid documentId, DeleteDatasetRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new DeleteDatasetCommand(documentId, request.CommandId, request.DatasetId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("set-dataset-connector"), RequestSizeLimit(4096), EndpointSummary("Assign an administrator-configured JSON connector ID without fetching data")]
    [EndpointDescription("Requires the current revision and an allowed server connector ID. Preserves the offline fixture. URLs, secrets and unknown request members are rejected.")]
    public async Task<IActionResult> SetDatasetConnector(Guid documentId, SetDatasetConnectorRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetDatasetConnectorCommand(documentId, request.CommandId, request.DatasetId, request.ExpectedRevision, request.ConnectorId), User.GetDocumentActor(), ct));
    [HttpPost("remove-dataset-connector"), RequestSizeLimit(4096), EndpointSummary("Remove a dataset connector link while preserving its offline fixture")]
    public async Task<IActionResult> RemoveDatasetConnector(Guid documentId, RemoveDatasetConnectorRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RemoveDatasetConnectorCommand(documentId, request.CommandId, request.DatasetId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("add-dataset"), RequestSizeLimit(512 * 1024), EndpointSummary("Create a local dataset and its saved JSON fixture")]
    [EndpointDescription("Name is nonblank, at most 256 characters without control characters. FixtureJson is a JSON string containing one valid JSON value, at most 65536 UTF-8 bytes and depth 32, with unique object keys. At most 1000 datasets and 8 MiB of fixtures per document. Request body limit is 512 KiB. Duplicate names are allowed; IDs are unique. Fixture contents are persisted with the document.")]
    public async Task<IActionResult> AddDataset(Guid documentId, AddDatasetRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddDatasetCommand(documentId, request.CommandId, request.DatasetId, request.Name, request.FixtureJson), User.GetDocumentActor(), ct));
    [HttpPost("replace-dataset-fixture"), RequestSizeLimit(512 * 1024), EndpointSummary("Replace a dataset fixture with a revision precondition")]
    [EndpointDescription("Preserves dataset ID and name. ExpectedRevision must match the current document revision. Fixture and document limits are the same as add-dataset. Request body limit is 512 KiB. Retries of an accepted commandId return its original result.")]
    public async Task<IActionResult> ReplaceDatasetFixture(Guid documentId, ReplaceDatasetFixtureRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new ReplaceDatasetFixtureCommand(documentId, request.CommandId, request.DatasetId, request.ExpectedRevision, request.FixtureJson), User.GetDocumentActor(), ct));
    [HttpPost("add-token"), EndpointSummary("Add a typed design token with Light and Dark values")]
    public async Task<IActionResult> AddToken(Guid documentId, AddTokenRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddTokenCommand(documentId, request.CommandId, new(request.TokenId, request.Name, request.Type, request.Values)), User.GetDocumentActor(), ct));
    [HttpPost("delete-document"), RequestSizeLimit(4096), EndpointSummary("Delete a document at the expected revision (Owner only)")]
    [EndpointDescription("Requires commandId and nonnegative expectedRevision matching the current draft. Atomically commits a durable tombstone, journal event and next revision before ACK; retains snapshots, assets and saved versions without physical cleanup. The document becomes inaccessible to reads (including historical revisions and versions), writes, exports, presence and subscriptions. Existing subscriptions terminate without further document events. Owners retain only deletion retry authorization: the original commandId returns its original result even after restart; a new deletion command returns DOCUMENT_NOT_FOUND (404). Editor/Viewer/outsider receive FORBIDDEN (403), stale revision REVISION_CONFLICT (409), invalid IDs/revision INVALID_ID/INVALID_REVISION (400). Refusal changes neither model nor revision. Deletion cannot be undone or restored through normal document operations.")]
    public async Task<IActionResult> DeleteDocument(Guid documentId, DeleteDocumentRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new DeleteDocumentCommand(documentId, request.CommandId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("delete-page"), EndpointSummary("Delete a page and its screens and node subtrees at an expected revision")]
    [EndpointDescription("Requires edit permission and expectedRevision matching the current draft. Deletes contained component instances and screen variants. Retained references from pages, scenarios or component definitions cause PAGE_IN_USE (409); remove those references explicitly first. Missing page returns PAGE_NOT_FOUND (404), stale revision REVISION_CONFLICT (409). Refusal preserves the document and revision. Reusing commandId returns its original result. Undo/Redo use the shared safe compensation history.")]
    public async Task<IActionResult> DeletePage(Guid documentId, DeletePageRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new DeletePageCommand(documentId, request.CommandId, request.PageId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("rename-document"), EndpointSummary("Rename a document without changing its technical ID")]
    [EndpointDescription("Names must be nonblank, at most 256 characters and contain no control characters.")]
    public async Task<IActionResult> RenameDocument(Guid documentId, RenameDocumentRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RenameDocumentCommand(documentId, request.CommandId, request.Name), User.GetDocumentActor(), ct));
    [HttpPost("rename-page"), EndpointSummary("Rename a page without changing its technical ID")]
    [EndpointDescription("Names must be nonblank, at most 256 characters and contain no control characters. Duplicate names are allowed.")]
    public async Task<IActionResult> RenamePage(Guid documentId, RenamePageRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RenamePageCommand(documentId, request.CommandId, request.PageId, request.Name), User.GetDocumentActor(), ct));
    [HttpPost("rename-screen"), EndpointSummary("Rename a screen without changing its technical ID")]
    [EndpointDescription("Names must be nonblank, at most 256 characters and contain no control characters. Duplicate names are allowed.")]
    public async Task<IActionResult> RenameScreen(Guid documentId, RenameScreenRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RenameScreenCommand(documentId, request.CommandId, request.ScreenId, request.Name), User.GetDocumentActor(), ct));
    [HttpPost("add-page"), EndpointSummary("Add a page")]
    public async Task<IActionResult> AddPage(Guid documentId, AddPageRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddPageCommand(documentId, request.CommandId, request.PageId), User.GetDocumentActor(), ct));
    [HttpPost("resize-screen"), EndpointSummary("Set finite, non-negative screen dimensions in logical uiUnits")]
    [EndpointDescription("dimensions requires width and height in logical uiUnits. Both must be finite and non-negative; zero is valid. Children retain their properties.")]
    public async Task<IActionResult> ResizeScreen(Guid documentId, ResizeScreenRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new ResizeScreenCommand(documentId, request.CommandId, request.ScreenId, request.Dimensions), User.GetDocumentActor(), ct));
    [HttpPost("add-screen"), EndpointSummary("Add a screen to a page")]
    [EndpointDescription("dimensions requires width and height in logical uiUnits. Both must be finite and non-negative; zero is valid.")]
    public async Task<IActionResult> AddScreen(Guid documentId, AddScreenRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new AddScreenCommand(documentId, request.CommandId, request.PageId, request.ScreenId, request.Dimensions), User.GetDocumentActor(), ct));
    [HttpPost("duplicate-screen"), EndpointSummary("Atomically duplicate a screen, its nodes and variants with new unique IDs")]
    public async Task<IActionResult> DuplicateScreen(Guid documentId, DuplicateScreenRequest request, CancellationToken ct) =>
        Result(await handler.HandleAsync(new DuplicateScreenCommand(documentId, request.CommandId, request.ScreenId,
            request.NewScreenId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("add-node"), EndpointSummary("Atomically add a node with its initial typed properties")]
    [EndpointDescription("Add a node to a screen or container. The properties map accepts names and typed values from the document profile. Image requires an asset property referencing an existing document asset.")]
    public async Task<IActionResult> AddNode(Guid documentId, AddNodeRequest request, CancellationToken ct) =>
        Result(await handler.HandleAsync(new AddNodeCommand(documentId, request.CommandId, request.ParentId, request.NodeId,
            request.Kind, request.Properties), User.GetDocumentActor(), ct));
    [HttpPost("delete-node"), EndpointSummary("Delete a node")]
    public async Task<IActionResult> DeleteNode(Guid documentId, DeleteNodeRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new DeleteNodeCommand(documentId, request.CommandId, request.NodeId), User.GetDocumentActor(), ct));
    [HttpPost("move-node"), EndpointSummary("Move or reorder a node")]
    public async Task<IActionResult> MoveNode(Guid documentId, MoveNodeRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new MoveNodeCommand(documentId, request.CommandId, request.NodeId, request.ExpectedParentId, request.TargetParentId, request.Position), User.GetDocumentActor(), ct));
    [HttpPost("set-node-name"), EndpointSummary("Set a node name without changing its technical ID")]
    public async Task<IActionResult> SetNodeName(Guid documentId, SetNodeNameRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetNodeNameCommand(documentId, request.CommandId, request.NodeId, request.Name), User.GetDocumentActor(), ct));
    [HttpPost("set-node-semantic-key"), EndpointSummary("Set or clear a node semantic key")]
    public async Task<IActionResult> SetNodeSemanticKey(Guid documentId, SetNodeSemanticKeyRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetNodeSemanticKeyCommand(documentId, request.CommandId, request.NodeId, request.SemanticKey), User.GetDocumentActor(), ct));
    [HttpPost("set-node-property"), EndpointSummary("Set a typed node property")]
    public async Task<IActionResult> SetNodeProperty(Guid documentId, SetNodePropertyRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SetNodePropertyCommand(documentId, request.CommandId, request.NodeId, request.Property, request.Value), User.GetDocumentActor(), ct));
    [HttpPost("set-node-properties"), EndpointSummary("Atomically set one or more typed properties on one node")]
    [EndpointDescription("Supply a nonempty map of property names and typed values from the document profile. Pass expectedParentId for edits based on parent-relative coordinates and expectedRevision for edits based on a document revision.")]
    public async Task<IActionResult> SetNodeProperties(Guid documentId, SetNodePropertiesRequest request, CancellationToken ct) =>
        Result(await handler.HandleAsync(new SetNodePropertiesCommand(documentId, request.CommandId, request.NodeId,
            request.Properties, request.ExpectedParentId, request.ExpectedRevision), User.GetDocumentActor(), ct));
    [HttpPost("save"), EndpointSummary("Save an immutable document version")]
    public async Task<IActionResult> Save(Guid documentId, SaveDocumentRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new SaveDocumentCommand(documentId, request.CommandId, request.Name), User.GetDocumentActor(), ct));
    [HttpPost("restore"), EndpointSummary("Restore a saved version as a new revision")]
    public async Task<IActionResult> Restore(Guid documentId, RestoreDocumentRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RestoreDocumentVersionCommand(documentId, request.CommandId, request.VersionId), User.GetDocumentActor(), ct));
    [HttpPost("import-design-tokens"), RequestSizeLimit(4 * 1024 * 1024), EndpointSummary("Atomically import flat DTCG 2025.10 color and dimension tokens with explicit Light/Dark and dimension type mappings")]
    public async Task<IActionResult> ImportDesignTokens(Guid documentId, ImportDesignTokensRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new ImportDesignTokensCommand(documentId, request.CommandId, request.ExpectedRevision, request.LightJson, request.DarkJson, request.DimensionTypes), User.GetDocumentActor(), ct));
    [HttpPost("undo"), EndpointSummary("Compensate the actor's last applicable command")]
    public async Task<IActionResult> Undo(Guid documentId, HistoryCommandRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new UndoDocumentCommand(documentId, request.CommandId), User.GetDocumentActor(), ct));
    [HttpPost("redo"), EndpointSummary("Redo the actor's last applicable undone command")]
    public async Task<IActionResult> Redo(Guid documentId, HistoryCommandRequest request, CancellationToken ct) => Result(await handler.HandleAsync(new RedoDocumentCommand(documentId, request.CommandId), User.GetDocumentActor(), ct));

    private IActionResult Result(CommandResult result)
    {
        if (result.Accepted) return Ok(new CommandResponse(result.Code, result.DocumentId, result.CommandId, result.Revision!.Value, result.PageId, result.ScreenId, result.NodeId, result.VersionId, result.AffectedIds ?? new Guid?[] { result.PageId, result.ScreenId, result.NodeId, result.VersionId }.OfType<Guid>().Distinct().ToArray()));
        var status = result.Code switch
        {
            "REQUIRED_PROPERTY" or "INVALID_PROFILE_UPGRADE" or "INVALID_PROFILE" or "PROFILE_UNAVAILABLE" or "UNSUPPORTED_PROFILE_VERSION" => 400,
            "FORBIDDEN" => 403,
            "ASSET_NOT_FOUND" or "DATASET_CONNECTOR_NOT_FOUND" or "SCREEN_NOT_FOUND" or "SCENARIO_NOT_FOUND" or "SCREEN_VARIANT_NOT_FOUND" or "VARIANT_OVERRIDE_NOT_FOUND" or "DATA_BINDING_NOT_FOUND" or "DATASET_NOT_FOUND" or "COMPONENT_NOT_FOUND" or "DOCUMENT_NOT_FOUND" or "TOKEN_NOT_FOUND" or "PAGE_NOT_FOUND" or "NODE_NOT_FOUND" or "PARENT_NOT_FOUND" or "VERSION_NOT_FOUND" => 404,
            "INVALID_SCREEN_STRUCTURE" or "INVALID_DOCUMENT_NAME" or "INVALID_SCREEN_NAME" or "INVALID_SCREEN_DIMENSIONS" or "INVALID_PAGE" or "CONNECTOR_NOT_ALLOWED" or "INVALID_SCENARIO" or "INVALID_SCREEN_VARIANT" or "INVALID_VARIANT_NODE" or "INVALID_TOKEN_IMPORT" or "INVALID_REPEATER" or "DATA_REPEATER_LIMIT" or "INVALID_DATA_BINDING" or "DATA_MISSING_VALUE" or "DATA_INCOMPATIBLE_TYPE" or "DATA_INVALID_FIXTURE" or "DATA_INVALID_PATH" or "INVALID_CSV_FIXTURE" or "INVALID_DATASET" or "INVALID_DATASET_FIXTURE" or "DATASET_LIMIT_EXCEEDED" or "INVALID_COMPONENT_REPLACEMENT" or "INVALID_REVISION" or "INVALID_COMPONENT" or "INVALID_TOKEN" or "INVALID_NODE_METADATA" or "INVALID_ID" or "INVALID_VERSION_NAME" or "INVALID_POSITION" or "INVALID_PROPERTY_TYPE" or "INVALID_PROPERTY_VALUE" or "UNSUPPORTED_PROPERTY" or "UNSUPPORTED_NODE_KIND" => 400,
            _ => 409
        };
        return StatusCode(status, ApiErrors.Create(status, result.Code) with { Diagnostics = result.Diagnostics, NodeId = result.NodeId, Property = result.Property, Detail = result.Explanation ?? ApiErrors.Create(status, result.Code).Detail });
    }
}

