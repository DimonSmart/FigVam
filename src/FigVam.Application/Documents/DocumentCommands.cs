using System.Collections.Immutable;
using System.Text.Json.Serialization;
using FigVam.Domain.Documents;
using FigVam.Domain.Tokens;
using FigVam.Domain.Components;

namespace FigVam.Application.Documents;

// Constructed by the server's authenticated transport, never deserialized from a command payload.
public sealed record DocumentActor(string Id);
public sealed record RestoreDocumentVersionCommand(Guid DocumentId, Guid CommandId, Guid VersionId);
public sealed record UpgradePortableUiProfileCommand(Guid DocumentId, Guid CommandId, long ExpectedRevision);
public sealed record SetNodeRepeaterCommand(Guid DocumentId, Guid CommandId, Guid NodeId, long ExpectedRevision, NodeRepeater? Repeater);
public sealed record BindNodeDataCommand(Guid DocumentId, Guid CommandId, Guid NodeId, string Property, NodeDataBinding Binding);
public sealed record UnbindNodeDataCommand(Guid DocumentId, Guid CommandId, Guid NodeId, string Property);
public sealed record SetDatasetConnectorCommand(Guid DocumentId, Guid CommandId, Guid DatasetId, long ExpectedRevision, string ConnectorId);
public sealed record RemoveDatasetConnectorCommand(Guid DocumentId, Guid CommandId, Guid DatasetId, long ExpectedRevision);
public sealed record DeleteDatasetCommand(Guid DocumentId, Guid CommandId, Guid DatasetId, long ExpectedRevision);
public sealed record AddCsvDatasetCommand(Guid DocumentId, Guid CommandId, Guid DatasetId, string Name, string Csv);
public sealed record ReplaceDatasetFixtureFromCsvCommand(Guid DocumentId, Guid CommandId, Guid DatasetId, long ExpectedRevision, string Csv);
public sealed record AddDatasetCommand(Guid DocumentId, Guid CommandId, Guid DatasetId, string Name, string FixtureJson);
public sealed record ReplaceDatasetFixtureCommand(Guid DocumentId, Guid CommandId, Guid DatasetId, long ExpectedRevision, string FixtureJson);
public sealed record SaveDocumentCommand(Guid DocumentId, Guid CommandId, string? Name = null);
public sealed record SetTokenValueCommand(Guid DocumentId, Guid CommandId, Guid TokenId, TokenTheme Theme, TokenExpression Value);
public sealed record RenameTokenCommand(Guid DocumentId, Guid CommandId, Guid TokenId, string Name);
public sealed record AddTokenCommand(Guid DocumentId, Guid CommandId, DesignToken Token);
public sealed record AddComponentSlotCommand(Guid DocumentId, Guid CommandId, Guid DefinitionId, ComponentSlot Slot);
public sealed record SetComponentSlotContentCommand(Guid DocumentId, Guid CommandId, Guid NodeId, Guid SlotId, IReadOnlyList<Guid> ContentNodeIds);
public sealed record AddComponentVariantCommand(Guid DocumentId, Guid CommandId, Guid DefinitionId, ComponentVariant Variant);
public sealed record SetComponentInstanceVariantCommand(Guid DocumentId, Guid CommandId, Guid NodeId, Guid? VariantId);
public sealed record DeleteComponentDefinitionCommand(Guid DocumentId, Guid CommandId, Guid DefinitionId, long ExpectedRevision, ComponentReplacement? Replacement = null);
public sealed record DetachComponentInstanceCommand(Guid DocumentId, Guid CommandId, Guid NodeId, long ExpectedRevision);
public sealed record InsertComponentInstanceCommand(Guid DocumentId, Guid CommandId, Guid NodeId, Guid DefinitionId, Guid ParentId, int Position);
public sealed record SetComponentParameterOverrideCommand(Guid DocumentId, Guid CommandId, Guid NodeId, Guid ParameterId, ComponentValue Value);
public sealed record RemoveComponentParameterOverrideCommand(Guid DocumentId, Guid CommandId, Guid NodeId, Guid ParameterId);
public sealed record SetComponentVariantParameterChangeCommand(Guid DocumentId, Guid CommandId, Guid DefinitionId, Guid VariantId, Guid ParameterId, ComponentValue Value);
public sealed record RemoveComponentVariantParameterChangeCommand(Guid DocumentId, Guid CommandId, Guid DefinitionId, Guid VariantId, Guid ParameterId);
public sealed record SetComponentParameterDefaultCommand(Guid DocumentId, Guid CommandId, Guid DefinitionId, Guid ParameterId, ComponentValue Value);
public sealed record AddComponentParameterCommand(Guid DocumentId, Guid CommandId, Guid DefinitionId, ComponentParameter Parameter, Guid NodeId, string Property);
public sealed record AddComponentDefinitionCommand(Guid DocumentId, Guid CommandId, Guid ComponentId, string Name, string Description, Guid RootNodeId);
public sealed record AddPageCommand(Guid DocumentId, Guid CommandId, Guid PageId);
public sealed record DeletePageCommand(Guid DocumentId, Guid CommandId, Guid PageId, long ExpectedRevision);
public sealed record DeleteDocumentCommand(Guid DocumentId, Guid CommandId, long ExpectedRevision);
public sealed record RenameDocumentCommand(Guid DocumentId, Guid CommandId, string Name);
public sealed record RenamePageCommand(Guid DocumentId, Guid CommandId, Guid PageId, string Name);
public sealed record AddScreenCommand(Guid DocumentId, Guid CommandId, Guid PageId, Guid ScreenId, ScreenDimensions Dimensions);
public sealed record ResizeScreenCommand(Guid DocumentId, Guid CommandId, Guid ScreenId, ScreenDimensions Dimensions);
public sealed record MoveNodeCommand(Guid DocumentId, Guid CommandId, Guid NodeId, Guid ExpectedParentId, Guid TargetParentId, int Position);
public sealed record DeleteNodeCommand(Guid DocumentId, Guid CommandId, Guid NodeId);
public sealed record SetNodeNameCommand(Guid DocumentId, Guid CommandId, Guid NodeId, string Name);
public sealed record SetNodeSemanticKeyCommand(Guid DocumentId, Guid CommandId, Guid NodeId, string? SemanticKey);
public sealed record SetNodePropertyCommand(Guid DocumentId, Guid CommandId, Guid NodeId, string Property, NodePropertyValue Value);
public sealed record SetNodePropertiesCommand(Guid DocumentId, Guid CommandId, Guid NodeId,
    IReadOnlyDictionary<string, NodePropertyValue> Properties, Guid? ExpectedParentId = null, long? ExpectedRevision = null);
public sealed record AddNodeCommand(Guid DocumentId, Guid CommandId, Guid ParentId, Guid NodeId, string Kind,
    IReadOnlyDictionary<string, NodePropertyValue>? Properties = null);
public sealed record DocumentState(DocumentStructure Document, long Revision);
public sealed record CommandResult(Guid DocumentId, Guid CommandId, string Code, long? Revision,
    string ActorId, Guid? PageId, DateTimeOffset Timestamp, Guid? ScreenId = null, Guid? NodeId = null, Guid? VersionId = null, string? Explanation = null, string? Property = null, IReadOnlyList<Guid>? AffectedIds = null, IReadOnlyList<TokenImportDiagnostic>? Diagnostics = null)
{
    public bool Accepted => Code == "ACCEPTED";
    public bool Equals(CommandResult? other) => other is not null &&
        DocumentId == other.DocumentId && CommandId == other.CommandId && Code == other.Code && Revision == other.Revision &&
        ActorId == other.ActorId && PageId == other.PageId && Timestamp == other.Timestamp && ScreenId == other.ScreenId &&
        NodeId == other.NodeId && VersionId == other.VersionId && Explanation == other.Explanation && Property == other.Property &&
        (AffectedIds is null ? other.AffectedIds is null : other.AffectedIds is not null && AffectedIds.SequenceEqual(other.AffectedIds)) &&
        (Diagnostics is null ? other.Diagnostics is null : other.Diagnostics is not null && Diagnostics.SequenceEqual(other.Diagnostics));
    public override int GetHashCode() => HashCode.Combine(DocumentId, CommandId, Code, Revision, ActorId, Timestamp);

}

public interface IDocumentAuthorization
{
    // Retained Owner membership permits retrying deletion after the document becomes inaccessible.
    ValueTask<bool> CanDeleteAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken);
    ValueTask<bool> CanReadAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken);
    ValueTask<bool> CanEditAsync(DocumentActor actor, Guid documentId, CancellationToken cancellationToken);
}

[System.Text.Json.Serialization.JsonPolymorphic(TypeDiscriminatorPropertyName = "payloadType")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ScenarioChanged), "SCENARIO_CHANGED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ScreenVariantChanged), "SCREEN_VARIANT_CHANGED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentSlotAdded), "COMPONENT_SLOT_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentSlotContentSet), "COMPONENT_SLOT_CONTENT_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentVariantAdded), "COMPONENT_VARIANT_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentInstanceVariantSet), "COMPONENT_INSTANCE_VARIANT_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentDefinitionDeleted), "COMPONENT_DEFINITION_DELETED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentInstanceDetached), "COMPONENT_INSTANCE_DETACHED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentInstanceInserted), "COMPONENT_INSTANCE_INSERTED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentVariantParameterChangeSet), "COMPONENT_VARIANT_PARAMETER_CHANGE_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentParameterDefaultSet), "COMPONENT_PARAMETER_DEFAULT_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentParameterOverrideSet), "COMPONENT_PARAMETER_OVERRIDE_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentParameterAdded), "COMPONENT_PARAMETER_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ComponentDefinitionAdded), "COMPONENT_DEFINITION_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodeRepeaterSet), "NODE_REPEATER_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodeDataBindingSet), "NODE_DATA_BINDING_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DatasetConnectorSet), "DATASET_CONNECTOR_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DatasetDeleted), "DATASET_DELETED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DatasetAdded), "DATASET_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DatasetFixtureReplaced), "DATASET_FIXTURE_REPLACED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(TokensImported), "TOKENS_IMPORTED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(TokenAdded), "TOKEN_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(TokenValueSet), "TOKEN_VALUE_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(TokenRenamed), "TOKEN_RENAMED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(AssetAdded), "ASSET_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(PageDeleted), "PAGE_DELETED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(PageAdded), "PAGE_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DocumentDeleted), "DOCUMENT_DELETED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(DocumentRenamed), "DOCUMENT_RENAMED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(PageRenamed), "PAGE_RENAMED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ScreenResized), "SCREEN_RESIZED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(ScreenAdded), "SCREEN_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodeAdded), "NODE_ADDED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodeMoved), "NODE_MOVED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodeDeleted), "NODE_DELETED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodeNameSet), "NODE_NAME_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodeSemanticKeySet), "NODE_SEMANTIC_KEY_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodePropertySet), "NODE_PROPERTY_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(NodePropertiesSet), "NODE_PROPERTIES_SET")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(VersionSaved), "VERSION_SAVED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(VersionRestored), "VERSION_RESTORED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(PortableUiProfileUpgraded), "PORTABLE_UI_PROFILE_UPGRADED")]
[System.Text.Json.Serialization.JsonDerivedType(typeof(HistoryCompensated), "HISTORY_COMPENSATED")]
public abstract record DocumentEvent;
public sealed record ComponentSlotAdded(Guid DefinitionId, ComponentSlot Slot) : DocumentEvent;
public sealed record ComponentSlotContentSet(Guid NodeId, Guid SlotId, IReadOnlyList<Guid> ContentNodeIds) : DocumentEvent;
public sealed record ComponentVariantAdded(Guid DefinitionId, ComponentVariant Variant) : DocumentEvent;
public sealed record ComponentInstanceVariantSet(Guid NodeId, Guid? VariantId) : DocumentEvent;
public sealed record ComponentDefinitionDeleted(Guid DefinitionId, DocumentPatch Patch) : DocumentEvent;
public sealed record ComponentInstanceDetached(Guid NodeId, DocumentPatch Patch) : DocumentEvent;
public sealed record ComponentInstanceInserted(Guid ParentId, int Position, NodeStructure Anchor, ComponentInstance Instance) : DocumentEvent;
public sealed record ComponentVariantParameterChangeSet(Guid DefinitionId, Guid VariantId, Guid ParameterId, ComponentValue? Value) : DocumentEvent;
public sealed record ComponentParameterDefaultSet(Guid DefinitionId, Guid ParameterId, ComponentValue Value) : DocumentEvent;
public sealed record ComponentParameterOverrideSet(Guid NodeId, Guid ParameterId, ComponentValue? Value) : DocumentEvent;
public sealed record ComponentParameterAdded(Guid DefinitionId, ComponentParameter Parameter, ComponentParameterBinding Binding) : DocumentEvent;
public sealed record ComponentDefinitionAdded(ComponentDefinition Definition) : DocumentEvent;
public sealed record VersionRestored(Guid VersionId, DocumentStructure Document) : DocumentEvent;
public sealed record PortableUiProfileUpgraded(PortableUiProfileReference Profile) : DocumentEvent;
public sealed record VersionSaved(Guid VersionId) : DocumentEvent;
public sealed record TokenValueSet(Guid TokenId, TokenTheme Theme, TokenExpression Value) : DocumentEvent;
public sealed record TokenRenamed(Guid TokenId, string Name) : DocumentEvent;
public sealed record NodeRepeaterSet(Guid NodeId, NodeRepeater? Repeater) : DocumentEvent;
public sealed record NodeDataBindingSet(Guid NodeId, string Property, NodeDataBinding? Binding) : DocumentEvent;
public sealed record DatasetConnectorSet(Guid DatasetId, string? ConnectorId) : DocumentEvent;
public sealed record DatasetDeleted(Guid DatasetId) : DocumentEvent;
public sealed record DatasetAdded(DocumentDataset Dataset) : DocumentEvent;
public sealed record DatasetFixtureReplaced(Guid DatasetId, string FixtureJson) : DocumentEvent;
public sealed record TokensImported(IReadOnlyList<DesignToken> Tokens) : DocumentEvent;
public sealed record TokenAdded(DesignToken Token) : DocumentEvent;
public sealed record PageDeleted(Guid PageId) : DocumentEvent;
public sealed record PageAdded(Guid PageId) : DocumentEvent;
public sealed record DocumentDeleted : DocumentEvent;
public sealed record DocumentRenamed(string Name) : DocumentEvent;
public sealed record PageRenamed(Guid PageId, string Name) : DocumentEvent;
public sealed record ScreenAdded(Guid PageId, Guid ScreenId, ScreenDimensions Dimensions) : DocumentEvent;
public sealed record ScreenResized(Guid ScreenId, ScreenDimensions Dimensions) : DocumentEvent;
public sealed record NodeMoved(Guid NodeId, Guid TargetParentId, int Position) : DocumentEvent;
public sealed record NodeDeleted(Guid NodeId) : DocumentEvent;
public sealed record NodeNameSet(Guid NodeId, string Name) : DocumentEvent;
public sealed record NodeSemanticKeySet(Guid NodeId, string? SemanticKey) : DocumentEvent;
public sealed record NodePropertySet(Guid NodeId, string Property, NodePropertyValue Value) : DocumentEvent;
public sealed record NodePropertiesSet(Guid NodeId, ImmutableSortedDictionary<string, NodePropertyValue> Properties) : DocumentEvent;
public sealed record NodeAdded(Guid ParentId, Guid NodeId, string Kind,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ImmutableSortedDictionary<string, NodePropertyValue>? Properties = null) : DocumentEvent;
public sealed record DocumentChange(CommandResult Result, DocumentState? State, DocumentEvent? Event = null, SavedDocumentVersion? Version = null, DocumentAssetContent? AssetContent = null);

public interface IDocumentCommandJournal
{
    // The callback, version lookup and result commit share one cross-process document transaction.
    // Version and actor-history lookups are valid only during the callback and read this document exclusively.
    // Handlers supply authorize; it runs under the writer lock before deduplication or document access.
    Task<CommandResult> ExecuteAsync(Guid documentId, Guid commandId,
        Func<DocumentState?, Func<Guid, DocumentVersionResult>, Func<string, IReadOnlyList<DocumentCommandHistoryEntry>>, DocumentChange> apply, CancellationToken cancellationToken = default,
        Func<ValueTask<CommandResult?>>? authorize = null);
}

public interface IDocumentCommandHandler
{
    Task<CommandResult> HandleAsync(DeleteDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(UploadDocumentAssetCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(CreateScenarioCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(UpdateScenarioCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(DeleteScenarioCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddScreenVariantCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetScreenVariantOverrideCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RemoveScreenVariantOverrideCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(ImportDesignTokensCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetNodeRepeaterCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(BindNodeDataCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(UnbindNodeDataCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetDatasetConnectorCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RemoveDatasetConnectorCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(DeleteDatasetCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddCsvDatasetCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(ReplaceDatasetFixtureFromCsvCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddDatasetCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(ReplaceDatasetFixtureCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddComponentSlotCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetComponentSlotContentCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddComponentVariantCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetComponentInstanceVariantCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(DeleteComponentDefinitionCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(DetachComponentInstanceCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(InsertComponentInstanceCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetComponentParameterOverrideCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RemoveComponentParameterOverrideCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetComponentVariantParameterChangeCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RemoveComponentVariantParameterChangeCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetComponentParameterDefaultCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddComponentParameterCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddComponentDefinitionCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetTokenValueCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RenameTokenCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddTokenCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetNodeNameCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetNodeSemanticKeyCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetNodePropertyCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SetNodePropertiesCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(UpgradePortableUiProfileCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(UndoDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RedoDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RestoreDocumentVersionCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(SaveDocumentCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(MoveNodeCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(DeleteNodeCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddNodeCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(DeletePageCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RenameDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(RenamePageCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddPageCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(ResizeScreenCommand command, DocumentActor actor, CancellationToken cancellationToken = default);
    Task<CommandResult> HandleAsync(AddScreenCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default);
}

public sealed partial class DocumentCommandHandler(IDocumentAuthorization authorization,
    IDocumentCommandJournal journal, INodeProfile profile,
    FigVam.Application.Connectors.IRemoteJsonConnectorCatalog? connectors = null) : IDocumentCommandHandler
{
    public Task<CommandResult> HandleAsync(SetComponentVariantParameterChangeCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeVariantParameter(command.DocumentId, command.CommandId, command.DefinitionId, command.VariantId, command.ParameterId, command.Value, false, actor, cancellationToken);
    }

    public Task<CommandResult> HandleAsync(RemoveComponentVariantParameterChangeCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeVariantParameter(command.DocumentId, command.CommandId, command.DefinitionId, command.VariantId, command.ParameterId, null, true, actor, cancellationToken);
    }

    private async Task<CommandResult> ChangeVariantParameter(Guid documentId, Guid commandId, Guid definitionId, Guid variantId,
        Guid parameterId, ComponentValue? value, bool remove, DocumentActor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(documentId, commandId, code,
            revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [definitionId, variantId, parameterId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (definitionId == Guid.Empty || variantId == Guid.Empty || parameterId == Guid.Empty) return new(Result("INVALID_ID"), null);
            if (!remove && value is null) return new(Result("INVALID_COMPONENT", explanation: "A value is required."), null);
            var definition = state.Document.ComponentDefinitions.FirstOrDefault(d => d.Id == definitionId);
            if (definition is null) return new(Result("COMPONENT_NOT_FOUND"), null);
            if (!definition.Parameters.Any(p => p.Id == parameterId) || !definition.Variants.Any(v => v.Id == variantId))
                return new(Result("INVALID_COMPONENT", explanation: "Variant and parameter must belong to the component definition."), null);
            var document = DocumentStructureEditor.SetComponentVariantParameterChange(state.Document, definitionId, variantId, parameterId, value);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result("INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentVariantParameterChangeSet(definitionId, variantId, parameterId, value));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, documentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(SetComponentParameterDefaultCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.DefinitionId, command.ParameterId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (command.DefinitionId == Guid.Empty || command.ParameterId == Guid.Empty) return new(Result("INVALID_ID"), null);
            if (command.Value is null) return new(Result("INVALID_COMPONENT", explanation: "A value is required."), null);
            var definition = state.Document.ComponentDefinitions.FirstOrDefault(d => d.Id == command.DefinitionId);
            if (definition is null) return new(Result("COMPONENT_NOT_FOUND"), null);
            if (!definition.Parameters.Any(p => p.Id == command.ParameterId)) return new(Result("INVALID_COMPONENT", explanation: "Parameter must belong to the component definition."), null);
            var document = DocumentStructureEditor.SetComponentParameterDefault(state.Document, command.DefinitionId, command.ParameterId, command.Value);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result("INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentParameterDefaultSet(command.DefinitionId, command.ParameterId, command.Value));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddComponentSlotCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.DefinitionId, command.Slot!.Id] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.DefinitionId == Guid.Empty || command.Slot is null || command.Slot.Id == Guid.Empty) return Result("INVALID_ID");
        if (command.Slot.Name is null) return Result("INVALID_COMPONENT", explanation: "Slot name is required.");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.ComponentDefinitions.Any(d => d.Id == command.DefinitionId)) return new(Result("COMPONENT_NOT_FOUND"), null);
            var document = DocumentStructureEditor.AddComponentSlot(state.Document, command.DefinitionId, command.Slot);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result(errors.Any(e => e.Code == "duplicate-id") ? "DUPLICATE_ID" : "INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentSlotAdded(command.DefinitionId, command.Slot));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddComponentVariantCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.DefinitionId, command.Variant!.Id] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.DefinitionId == Guid.Empty || command.Variant is null || command.Variant.Id == Guid.Empty) return Result("INVALID_ID");
        if (command.Variant.ParameterChanges is null) return Result("INVALID_COMPONENT", explanation: "Parameter changes are required.");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.ComponentDefinitions.Any(d => d.Id == command.DefinitionId)) return new(Result("COMPONENT_NOT_FOUND"), null);
            var document = DocumentStructureEditor.AddComponentVariant(state.Document, command.DefinitionId, command.Variant);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result(errors.Any(e => e.Code == "duplicate-id") ? "DUPLICATE_ID" : "INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentVariantAdded(command.DefinitionId, command.Variant));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(SetComponentSlotContentCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: command.NodeId, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.NodeId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty || command.SlotId == Guid.Empty) return Result("INVALID_ID");
        if (command.ContentNodeIds is null) return Result("INVALID_COMPONENT", explanation: "Content node IDs are required; use an empty list to clear the slot.");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Nodes.Any(n => n.Id == command.NodeId)) return new(Result("NODE_NOT_FOUND"), null);
            var instance = state.Document.ComponentInstances.FirstOrDefault(i => i.NodeId == command.NodeId);
            if (instance is null) return new(Result("NOT_COMPONENT_INSTANCE"), null);
            var definition = state.Document.ComponentDefinitions.FirstOrDefault(d => d.Id == instance.DefinitionId);
            if (definition is null || !definition.Slots.Any(s => s.Id == command.SlotId))
                return new(Result("INVALID_COMPONENT", explanation: "Slot must belong to the instance definition."), null);
            if (command.ContentNodeIds.Any(id => !state.Document.Nodes.Any(n => n.Id == id)))
                return new(Result("NODE_NOT_FOUND"), null);
            var document = DocumentStructureEditor.SetComponentSlotContent(state.Document, command.NodeId, command.SlotId, command.ContentNodeIds);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result("INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentSlotContentSet(command.NodeId, command.SlotId, command.ContentNodeIds.ToArray()));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(SetComponentInstanceVariantCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: command.NodeId, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.NodeId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty || command.VariantId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Nodes.Any(n => n.Id == command.NodeId)) return new(Result("NODE_NOT_FOUND"), null);
            var instance = state.Document.ComponentInstances.FirstOrDefault(i => i.NodeId == command.NodeId);
            if (instance is null) return new(Result("NOT_COMPONENT_INSTANCE"), null);
            var definition = state.Document.ComponentDefinitions.FirstOrDefault(d => d.Id == instance.DefinitionId);
            if (command.VariantId is Guid id && (definition is null || !definition.Variants.Any(v => v.Id == id)))
                return new(Result("INVALID_COMPONENT", explanation: "Variant must belong to the instance definition."), null);
            var document = DocumentStructureEditor.SetComponentInstanceVariant(state.Document, command.NodeId, command.VariantId);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result("INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentInstanceVariantSet(command.NodeId, command.VariantId));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public Task<CommandResult> HandleAsync(SetComponentParameterOverrideCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeComponentOverride(command.DocumentId, command.CommandId, command.NodeId, command.ParameterId, command.Value, false, actor, cancellationToken);
    }

    public Task<CommandResult> HandleAsync(RemoveComponentParameterOverrideCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return ChangeComponentOverride(command.DocumentId, command.CommandId, command.NodeId, command.ParameterId, null, true, actor, cancellationToken);
    }

    private async Task<CommandResult> ChangeComponentOverride(Guid documentId, Guid commandId, Guid nodeId, Guid parameterId,
        ComponentValue? value, bool remove, DocumentActor actor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(documentId, commandId, code,
            revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: nodeId, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [nodeId, parameterId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, cancellationToken)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty || nodeId == Guid.Empty || parameterId == Guid.Empty) return Result("INVALID_ID");
        if (!remove && value is null) return Result("INVALID_COMPONENT", explanation: "Override value is required.");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Nodes.Any(n => n.Id == nodeId)) return new(Result("NODE_NOT_FOUND"), null);
            var instance = state.Document.ComponentInstances.FirstOrDefault(i => i.NodeId == nodeId);
            if (instance is null) return new(Result("NOT_COMPONENT_INSTANCE"), null);
            var definition = state.Document.ComponentDefinitions.FirstOrDefault(d => d.Id == instance.DefinitionId);
            if (definition is null || !definition.Parameters.Any(p => p.Id == parameterId))
                return new(Result("INVALID_COMPONENT", explanation: "Parameter must belong to the instance definition."), null);
            var document = DocumentStructureEditor.SetComponentParameterOverride(state.Document, nodeId, parameterId, value);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result("INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentParameterOverrideSet(nodeId, parameterId, value));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, documentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(DeleteComponentDefinitionCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (command.DefinitionId == Guid.Empty) return new(Result("INVALID_ID"), null);
            if (command.ExpectedRevision < 0) return new(Result("INVALID_REVISION"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            if (!state.Document.ComponentDefinitions.Any(d => d.Id == command.DefinitionId)) return new(Result("COMPONENT_NOT_FOUND"), null);
            if (command.Replacement is null && state.Document.ComponentInstances.Any(i => i.DefinitionId == command.DefinitionId))
                return new(Result("COMPONENT_IN_USE", explanation: "Provide an explicit compatible replacement or detach every instance before deleting its definition."), null);
            var model = new ComponentModel(state.Document, state.Document.ComponentDefinitions, state.Document.ComponentInstances, state.Document.Tokens, state.Document.Assets.Select(a => a.Id).ToArray());
            ComponentModel changed;
            try { changed = ComponentOperations.DeleteDefinition(model, command.DefinitionId, ProfileFor(state.Document), command.Replacement); }
            catch (InvalidOperationException error) { return new(Result("INVALID_COMPONENT_REPLACEMENT", explanation: error.Message), null); }
            var document = state.Document with { ComponentDefinitions = changed.Definitions, ComponentInstances = changed.Instances };
            var patch = DocumentPatch.Between(state.Document, document);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision) with { AffectedIds = ChangedIds(patch) }, next,
                new ComponentDefinitionDeleted(command.DefinitionId, patch));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(DetachComponentInstanceCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: command.NodeId, Explanation: explanation);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty) return Result("INVALID_ID");
        if (command.ExpectedRevision < 0) return Result("INVALID_REVISION");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Nodes.Any(n => n.Id == command.NodeId)) return new(Result("NODE_NOT_FOUND"), null);
            if (!state.Document.ComponentInstances.Any(i => i.NodeId == command.NodeId)) return new(Result("NOT_COMPONENT_INSTANCE"), null);
            if (state.Revision != command.ExpectedRevision) return new(Result("REVISION_CONFLICT"), null);
            var model = new ComponentModel(state.Document, state.Document.ComponentDefinitions, state.Document.ComponentInstances, state.Document.Tokens, state.Document.Assets.Select(a => a.Id).ToArray());
            var nodeProfile = ProfileFor(state.Document);
            var errors = ComponentValidator.Validate(model, nodeProfile);
            if (errors.Count != 0) return new(Result("INVALID_COMPONENT", explanation: errors[0].Message), null);
            ComponentModel materialized;
            try { materialized = ComponentOperations.Detach(model, command.NodeId, nodeProfile); }
            catch (InvalidOperationException error) { return new(Result("INVALID_COMPONENT", explanation: error.Message), null); }
            var document = materialized.Structure with { ComponentInstances = materialized.Instances };
            var validation = DocumentStructureValidator.Validate(document, profile);
            if (validation.Count != 0) return new(Result("INVALID_COMPONENT", explanation: validation[0].Message), null);
            var patch = DocumentPatch.Between(state.Document, document);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision) with { AffectedIds = ChangedIds(patch) }, next,
                new ComponentInstanceDetached(command.NodeId, patch));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(InsertComponentInstanceCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: command.NodeId,
            Explanation: explanation, AffectedIds: code == "ACCEPTED" ? [command.NodeId, command.ParentId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty || command.DefinitionId == Guid.Empty || command.ParentId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var document = state.Document;
            var definition = document.ComponentDefinitions.FirstOrDefault(d => d.Id == command.DefinitionId);
            if (definition is null) return new(Result("COMPONENT_NOT_FOUND"), null);
            var screen = document.Screens.FirstOrDefault(s => s.Id == command.ParentId);
            var parent = document.Nodes.FirstOrDefault(n => n.Id == command.ParentId);
            if (screen is null && parent is null) return new(Result(document.Assets.Any(a => a.Id == command.ParentId) || document.Datasets.Any(d => d.Id == command.ParentId) || document.Id == command.ParentId || document.Pages.Any(p => p.Id == command.ParentId) || document.ComponentDefinitions.Any(d => d.Id == command.ParentId) || document.Tokens.Any(t => t.Id == command.ParentId) ? "INVALID_PARENT_TYPE" : "PARENT_NOT_FOUND"), null);
            if (parent is not null && !ProfileFor(state.Document).CanContainChildren(parent.Kind)) return new(Result("CHILDREN_NOT_ALLOWED"), null);
            if (command.Position < 0 || command.Position > (screen?.ChildIds ?? parent!.ChildIds).Count) return new(Result("INVALID_POSITION"), null);
            var root = document.Nodes.Single(n => n.Id == definition.RootNodeId);
            var anchor = new NodeStructure(command.NodeId, root.Kind, []);
            var instance = new ComponentInstance(command.NodeId, definition.Id, null, new Dictionary<Guid, ComponentValue>(), new Dictionary<Guid, IReadOnlyList<Guid>>());
            var changed = DocumentStructureEditor.InsertComponentInstance(document, command.ParentId, command.Position, anchor, instance);
            var errors = DocumentStructureValidator.Validate(changed, profile);
            if (errors.Count != 0) return new(Result(errors.Any(e => e.Code == "duplicate-id") ? "DUPLICATE_ID" : errors.Any(e => e.Code == "component-cycle") ? "CYCLE_NOT_ALLOWED" : "INVALID_COMPONENT", explanation: errors[0].Message), null);
            var next = new DocumentState(changed, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentInstanceInserted(command.ParentId, command.Position, anchor, instance));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddComponentParameterCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: command.NodeId,
            Explanation: explanation, Property: command.Property,
            AffectedIds: code == "ACCEPTED" ? [command.DefinitionId, command.Parameter!.Id, command.NodeId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.DefinitionId == Guid.Empty ||
            command.NodeId == Guid.Empty || command.Parameter is null || command.Parameter.Id == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.ComponentDefinitions.Any(d => d.Id == command.DefinitionId)) return new(Result("COMPONENT_NOT_FOUND"), null);
            if (!state.Document.Nodes.Any(n => n.Id == command.NodeId)) return new(Result("NODE_NOT_FOUND"), null);
            var binding = new ComponentParameterBinding(command.Parameter.Id, command.NodeId, command.Property);
            var document = DocumentStructureEditor.AddComponentParameter(state.Document, command.DefinitionId, command.Parameter, binding);
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0)
            {
                var error = errors.FirstOrDefault(e => e.Code == "duplicate-id") ?? errors[0];
                var code = error.Code switch
                {
                    "duplicate-id" => "DUPLICATE_ID",
                    "UNSUPPORTED_PROPERTY" or "INVALID_PROPERTY_TYPE" or "INVALID_PROPERTY_VALUE" => error.Code,
                    _ => "INVALID_COMPONENT"
                };
                return new(Result(code, explanation: error.Message), null);
            }
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentParameterAdded(command.DefinitionId, command.Parameter, binding));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddComponentDefinitionCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.ComponentId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.ComponentId == Guid.Empty || command.RootNodeId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Nodes.Any(n => n.Id == command.RootNodeId)) return new(Result("NODE_NOT_FOUND"), null);
            var definition = new ComponentDefinition(command.ComponentId, command.Name, command.Description, command.RootNodeId, [], [], []);
            var model = new ComponentModel(state.Document, state.Document.ComponentDefinitions, state.Document.ComponentInstances, state.Document.Tokens, state.Document.Assets.Select(a => a.Id).ToArray());
            var nodeProfile = ProfileFor(state.Document);
            var errors = ComponentValidator.Validate(model with { Definitions = [.. model.Definitions, definition] }, nodeProfile);
            if (errors.Count != 0) return new(Result(errors.Any(e => e.Code == "duplicate-id") ? "DUPLICATE_ID" : "INVALID_COMPONENT", explanation: errors[0].Message), null);
            var document = state.Document with { ComponentDefinitions = ComponentOperations.AddDefinition(model, definition, nodeProfile).Definitions };
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ComponentDefinitionAdded(definition));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
    public async Task<CommandResult> HandleAsync(SetTokenValueCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId, command.CommandId, code,
            revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation, AffectedIds: code == "ACCEPTED" ? [command.TokenId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.TokenId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var token = state.Document.Tokens.FirstOrDefault(t => t.Id == command.TokenId);
            if (token is null) return new(Result("TOKEN_NOT_FOUND"), null);
            if (!Enum.IsDefined(command.Theme) || command.Value is null) return new(Result("INVALID_TOKEN"), null);
            var values = token.Values.ToDictionary(v => v.Key, v => v.Value);
            values[command.Theme] = command.Value;
            var document = state.Document with { Tokens = state.Document.Tokens.Select(t => t.Id == token.Id ? t with { Values = values } : t).ToArray() };
            if (DocumentStructureValidator.Validate(document, profile).FirstOrDefault() is { } error)
                return new(Result("INVALID_TOKEN", explanation: error.Property is { } property
                    ? $"{error.ObjectId} · {property}: {error.Message}" : error.Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new TokenValueSet(command.TokenId, command.Theme, command.Value));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(RenameTokenCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId, command.CommandId, code,
            revision, actor.Id, null, DateTimeOffset.UtcNow, AffectedIds: code == "ACCEPTED" ? [command.TokenId] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.TokenId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Tokens.Any(t => t.Id == command.TokenId)) return new(Result("TOKEN_NOT_FOUND"), null);
            if (!DesignTokenValidator.IsValidName(command.Name)) return new(Result("INVALID_TOKEN"), null);
            var document = state.Document with { Tokens = state.Document.Tokens.Select(t => t.Id == command.TokenId ? t with { Name = command.Name } : t).ToArray() };
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new TokenRenamed(command.TokenId, command.Name));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddTokenCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation,
            AffectedIds: code == "ACCEPTED" ? [command.Token!.Id] : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.Token is null || command.Token.Id == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var token = command.Token with { Values = command.Token.Values?.OrderBy(v => v.Key).ToDictionary(v => v.Key, v => v.Value)! };
            var document = state.Document with { Tokens = state.Document.Tokens.Append(token).ToArray() };
            var errors = DocumentStructureValidator.Validate(document, profile);
            if (errors.Count != 0) return new(Result(errors.Any(e => e.Code == "duplicate-id") ? "DUPLICATE_ID" : "INVALID_TOKEN", explanation: errors[0].Message), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new TokenAdded(token));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public Task<CommandResult> HandleAsync(SetNodeNameCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
        => SetMetadataAsync(command.DocumentId, command.CommandId, command.NodeId, command.Name, false, actor, cancellationToken);
    public Task<CommandResult> HandleAsync(SetNodeSemanticKeyCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
        => SetMetadataAsync(command.DocumentId, command.CommandId, command.NodeId, command.SemanticKey, true, actor, cancellationToken);

    private async Task<CommandResult> SetMetadataAsync(Guid documentId, Guid commandId, Guid nodeId, string? value, bool semanticKey, DocumentActor actor, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(documentId, commandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, NodeId: nodeId);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, ct)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty || nodeId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var node = state.Document.Nodes.FirstOrDefault(n => n.Id == nodeId);
            if (node is null) return new(Result("NODE_NOT_FOUND"), null);
            if (!(semanticKey ? NodeMetadataValidator.IsValidSemanticKey(value) : NodeMetadataValidator.IsValidName(value)))
                return new(Result("INVALID_NODE_METADATA"), null);
            var updated = semanticKey ? node with { SemanticKey = value } : node with { Name = value! };
            var next = new DocumentState(state.Document with { Nodes = state.Document.Nodes.Select(n => n.Id == nodeId ? updated : n).ToArray() }, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, semanticKey ? new NodeSemanticKeySet(nodeId, value) : new NodeNameSet(nodeId, value!));
        }, ct, authorize: async () => await authorization.CanEditAsync(actor, documentId, ct) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(SetNodePropertyCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(
            command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
            NodeId: command.NodeId, Explanation: explanation, Property: command.Property);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty)
            return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var node = state.Document.Nodes.FirstOrDefault(n => n.Id == command.NodeId);
            if (node is null) return new(Result("NODE_NOT_FOUND", explanation: "The target node does not exist."), null);
            if (NodePropertyValidator.Validate(ProfileFor(state.Document), node.Kind, command.Property, command.Value) is { } error)
                return new(Result(error.Code, explanation: error.Reason), null);
            var next = new DocumentState(DocumentStructureEditor.SetNodeProperty(state.Document, node.Id, command.Property, command.Value),
                checked(state.Revision + 1));
            if (DocumentStructureValidator.Validate(next.Document, profile).FirstOrDefault() is { } validation)
                return new(Result("INVALID_PROPERTY_VALUE", explanation: validation.Message), null);
            return new(Result("ACCEPTED", next.Revision), next, new NodePropertySet(node.Id, command.Property, command.Value));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(SetNodePropertiesCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null, string? property = null) => new(
            command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
            NodeId: command.NodeId, Explanation: explanation, Property: property);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty ||
            command.ExpectedParentId == Guid.Empty)
            return Result("INVALID_ID");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var document = state.Document;
            if (!document.Nodes.Any(n => n.Id == command.NodeId))
                return new(Result("NODE_NOT_FOUND"), null);
            if (command.ExpectedParentId is { } parentId &&
                !document.Screens.Any(s => s.Id == parentId && s.ChildIds.Contains(command.NodeId)) &&
                !document.Nodes.Any(n => n.Id == parentId && n.ChildIds.Contains(command.NodeId)))
                return new(Result("INVALID_LAYOUT_CONTEXT"), null);
            if (command.ExpectedRevision < 0)
                return new(Result("INVALID_REVISION"), null);
            if (command.ExpectedRevision is { } revision && state.Revision != revision)
                return new(Result("REVISION_CONFLICT"), null);
            if (command.Properties is not { Count: > 0 })
                return new(Result("INVALID_PROPERTY_VALUE", explanation: "At least one property is required."), null);

            var properties = command.Properties.ToImmutableSortedDictionary(StringComparer.Ordinal);
            var updated = DocumentStructureEditor.SetNodeProperties(document, command.NodeId, properties);
            if (DocumentStructureValidator.Validate(updated, profile).FirstOrDefault() is { } invalid)
                return new(Result(NodePropertyDiagnosticCode(invalid, properties), explanation: invalid.Message,
                    property: invalid.Property), null);
            var next = new DocumentState(updated, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new NodePropertiesSet(command.NodeId, properties));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    private static string NodePropertyDiagnosticCode(StructureError error,
        IReadOnlyDictionary<string, NodePropertyValue>? properties)
        => error.Code switch
        {
            "missing-reference" when error.Property is { } property => properties?.GetValueOrDefault(property) switch
            {
                NodeAssetValue => "ASSET_NOT_FOUND",
                NodeTokenValue => "TOKEN_NOT_FOUND",
                _ => "INVALID_PROPERTY_VALUE"
            },
            "type-mismatch" => "INVALID_PROPERTY_VALUE",
            _ => error.Code
        };

    public Task<CommandResult> HandleAsync(UndoDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return CompensateAsync(command.DocumentId, command.CommandId, actor, false, cancellationToken);
    }
    public Task<CommandResult> HandleAsync(RedoDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        return CompensateAsync(command.DocumentId, command.CommandId, actor, true, cancellationToken);
    }

    private async Task<CommandResult> CompensateAsync(Guid documentId, Guid commandId, DocumentActor actor, bool redo, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, string? explanation = null) => new(
            documentId, commandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, Explanation: explanation);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, documentId, cancellationToken)) return Result("FORBIDDEN");
        if (documentId == Guid.Empty || commandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(documentId, commandId, (state, _, history) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var entry = history(actor.Id).Where(e => e.Patch is not null && e.Status == (redo ? "UNDONE" : "ACTIVE"))
                .OrderByDescending(e => e.HistoryOrder).FirstOrDefault();
            var code = redo ? "REDO_NOT_APPLICABLE" : "UNDO_NOT_APPLICABLE";
            if (entry is null) return new(Result(code, explanation: "There is no applicable command in your history."), null);
            var patch = redo ? entry.Patch! : entry.Patch!.Reverse();
            var document = patch.Apply(state.Document);
            if (document is null || DocumentStructureValidator.Validate(document, profile).Count != 0)
                return new(Result(code, explanation: "Affected objects or their structural context have changed; compensation would overwrite current work."), null);
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision) with { AffectedIds = ChangedIds(patch) }, next, new HistoryCompensated(entry.Result.CommandId, redo, patch));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, documentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(RestoreDocumentVersionCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(
            command.DocumentId, command.CommandId, code, revision, actor.Id, null,
            DateTimeOffset.UtcNow, VersionId: code == "ACCEPTED" ? command.VersionId : null);
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.VersionId == Guid.Empty)
            return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, readVersion, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (DocumentStructureValidator.Validate(state.Document, profile).Count != 0)
                return new(Result("INVALID_DOCUMENT"), null);
            var read = readVersion(command.VersionId);
            if (read.Code != "VERSION") return new(Result(read.Code), null);
            var version = read.Version!;
            if (version.Snapshot.Document.Id != command.DocumentId || version.Snapshot.Revision > state.Revision ||
                DocumentStructureValidator.Validate(version.Snapshot.Document, profile).Count != 0)
                return new(Result("INVALID_VERSION"), null);
            var next = new DocumentState(version.Snapshot.Document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision) with { AffectedIds = ChangedIds(DocumentPatch.Between(state.Document, next.Document)) }, next,
                new VersionRestored(command.VersionId, next.Document));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(SaveDocumentCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, Guid? versionId = null) => new(
            command.DocumentId, command.CommandId, code, revision, actor.Id, null,
            DateTimeOffset.UtcNow, VersionId: versionId);
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty)
            return Result("INVALID_ID");
        if (command.Name is not null && (string.IsNullOrWhiteSpace(command.Name) || command.Name.Length > 256))
            return Result("INVALID_VERSION_NAME");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var next = state with { Revision = checked(state.Revision + 1) };
            var result = Result("ACCEPTED", next.Revision, Guid.NewGuid());
            var version = new SavedDocumentVersion(result.VersionId!.Value, command.Name,
                result.Timestamp, actor.Id, next);
            return new(result, next, new VersionSaved(version.Id), version);
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(RenameDocumentCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!DocumentNameValidator.IsValid(command.Name)) return new(Result("INVALID_DOCUMENT_NAME"), null);
            var next = new DocumentState(state.Document with { Name = command.Name }, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new DocumentRenamed(command.Name));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(RenamePageCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId, command.CommandId, code, revision, actor.Id, code == "ACCEPTED" ? command.PageId : null, DateTimeOffset.UtcNow);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.PageId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Pages.Any(p => p.Id == command.PageId)) return new(Result("PAGE_NOT_FOUND"), null);
            if (!PageNameValidator.IsValid(command.Name)) return new(Result("INVALID_PAGE"), null);
            var document = state.Document with { Pages = state.Document.Pages.Select(p => p.Id == command.PageId ? p with { Name = command.Name } : p).ToArray() };
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new PageRenamed(command.PageId, command.Name));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddPageCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, code == "ACCEPTED" ? command.PageId : null,
            DateTimeOffset.UtcNow);

        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.PageId == Guid.Empty)
            return Result("INVALID_ID");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var document = state.Document;
            if (document.Assets.Any(a => a.Id == command.PageId) || document.Datasets.Any(d => d.Id == command.PageId) || document.Id == command.PageId || document.Pages.Any(p => p.Id == command.PageId) ||
                document.Scenarios.Any(s => s.Id == command.PageId) || document.Screens.Any(s => s.Id == command.PageId || s.Variants.Any(v => v.Id == command.PageId)) || document.Nodes.Any(n => n.Id == command.PageId) || document.Tokens.Any(t => t.Id == command.PageId) || document.ComponentDefinitions.Any(d => d.Id == command.PageId || d.Parameters.Any(p => p.Id == command.PageId) || d.Slots.Any(s => s.Id == command.PageId) || d.Variants.Any(v => v.Id == command.PageId)))
                return new(Result("DUPLICATE_ID"), null);
            var revision = checked(state.Revision + 1);
            return new(Result("ACCEPTED", revision), new(document with
            {
                Pages = document.Pages.Append(new PageStructure(command.PageId, [])).ToArray()
            }, revision), new PageAdded(command.PageId));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }
    public async Task<CommandResult> HandleAsync(ResizeScreenCommand command, DocumentActor actor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId, command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow, code == "ACCEPTED" ? command.ScreenId : null);
        if (string.IsNullOrWhiteSpace(actor.Id) || !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken)) return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.ScreenId == Guid.Empty) return Result("INVALID_ID");
        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Screens.Any(s => s.Id == command.ScreenId)) return new(Result("SCREEN_NOT_FOUND"), null);
            if (!ScreenDimensions.IsValid(command.Dimensions)) return new(Result("INVALID_SCREEN_DIMENSIONS"), null);
            var document = state.Document with { Screens = state.Document.Screens.Select(s => s.Id == command.ScreenId ? s with { Dimensions = command.Dimensions } : s).ToArray() };
            var next = new DocumentState(document, checked(state.Revision + 1));
            return new(Result("ACCEPTED", next.Revision), next, new ScreenResized(command.ScreenId, command.Dimensions));
        }, cancellationToken, authorize: async () => await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddScreenCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, code == "ACCEPTED" ? command.PageId : null,
            DateTimeOffset.UtcNow, code == "ACCEPTED" ? command.ScreenId : null);

        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty ||
            command.PageId == Guid.Empty || command.ScreenId == Guid.Empty)
            return Result("INVALID_ID");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var document = state.Document;
            var page = document.Pages.FirstOrDefault(p => p.Id == command.PageId);
            if (page is null) return new(Result("PAGE_NOT_FOUND"), null);
            if (document.Assets.Any(a => a.Id == command.ScreenId) || document.Datasets.Any(d => d.Id == command.ScreenId) || document.Id == command.ScreenId || document.Pages.Any(p => p.Id == command.ScreenId) ||
                document.Scenarios.Any(s => s.Id == command.ScreenId) || document.Screens.Any(s => s.Id == command.ScreenId || s.Variants.Any(v => v.Id == command.ScreenId)) || document.Nodes.Any(n => n.Id == command.ScreenId) || document.Tokens.Any(t => t.Id == command.ScreenId) || document.ComponentDefinitions.Any(d => d.Id == command.ScreenId || d.Parameters.Any(p => p.Id == command.ScreenId) || d.Slots.Any(s => s.Id == command.ScreenId) || d.Variants.Any(v => v.Id == command.ScreenId)))
                return new(Result("DUPLICATE_ID"), null);
            if (!ScreenDimensions.IsValid(command.Dimensions)) return new(Result("INVALID_SCREEN_DIMENSIONS"), null);
            var revision = checked(state.Revision + 1);
            return new(Result("ACCEPTED", revision), new(
                DocumentStructureEditor.AddScreen(document, page.Id, command.ScreenId, command.Dimensions), revision),
                new ScreenAdded(command.PageId, command.ScreenId, command.Dimensions));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(AddNodeCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null, StructureError? diagnostic = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
            NodeId: code == "ACCEPTED" || diagnostic is not null ? command.NodeId : null,
            Explanation: diagnostic?.Message, Property: diagnostic?.Property);

        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty ||
            command.ParentId == Guid.Empty || command.NodeId == Guid.Empty)
            return Result("INVALID_ID");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var document = state.Document;
            if (document.Assets.Any(a => a.Id == command.NodeId) || document.Datasets.Any(d => d.Id == command.NodeId) || document.Id == command.NodeId || document.Pages.Any(p => p.Id == command.NodeId) ||
                document.Scenarios.Any(s => s.Id == command.NodeId) || document.Screens.Any(s => s.Id == command.NodeId || s.Variants.Any(v => v.Id == command.NodeId)) || document.Nodes.Any(n => n.Id == command.NodeId) || document.Tokens.Any(t => t.Id == command.NodeId) || document.ComponentDefinitions.Any(d => d.Id == command.NodeId || d.Parameters.Any(p => p.Id == command.NodeId) || d.Slots.Any(s => s.Id == command.NodeId) || d.Variants.Any(v => v.Id == command.NodeId)))
                return new(Result("DUPLICATE_ID"), null);
            var screen = document.Screens.FirstOrDefault(s => s.Id == command.ParentId);
            var parent = document.Nodes.FirstOrDefault(n => n.Id == command.ParentId);
            if (screen is null && parent is null)
                return new(Result(document.Assets.Any(a => a.Id == command.ParentId) || document.Datasets.Any(d => d.Id == command.ParentId) || document.Id == command.ParentId || document.Pages.Any(p => p.Id == command.ParentId)
                    ? "INVALID_PARENT_TYPE" : "PARENT_NOT_FOUND"), null);
            var nodeProfile = ProfileFor(document);
            if (parent is not null && !nodeProfile.CanContainChildren(parent.Kind))
                return new(Result("CHILDREN_NOT_ALLOWED"), null);
            if (string.IsNullOrWhiteSpace(command.Kind) || !nodeProfile.IsKnownKind(command.Kind))
                return new(Result("UNSUPPORTED_NODE_KIND"), null);
            var properties = command.Properties is { Count: > 0 }
                ? command.Properties.ToImmutableSortedDictionary(StringComparer.Ordinal) : null;
            var updated = DocumentStructureEditor.AddNode(document, command.ParentId, command.NodeId, command.Kind, properties);
            if (DocumentStructureValidator.Validate(updated, profile).FirstOrDefault() is { } invalid)
                return new(Result(NodePropertyDiagnosticCode(invalid, properties), diagnostic: invalid), null);
            var revision = checked(state.Revision + 1);
            return new(Result("ACCEPTED", revision), new(updated, revision),
                new NodeAdded(command.ParentId, command.NodeId, command.Kind, properties));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(MoveNodeCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
            NodeId: code == "ACCEPTED" ? command.NodeId : null);
        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty ||
            command.ExpectedParentId == Guid.Empty || command.TargetParentId == Guid.Empty)
            return Result("INVALID_ID");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            var document = state.Document;
            var node = document.Nodes.FirstOrDefault(n => n.Id == command.NodeId);
            if (node is null)
                return new(Result(document.Assets.Any(a => a.Id == command.NodeId) || document.Datasets.Any(d => d.Id == command.NodeId) || document.Id == command.NodeId || document.Pages.Any(p => p.Id == command.NodeId) ||
                    document.Screens.Any(s => s.Id == command.NodeId) ? "INVALID_NODE_TYPE" : "NODE_NOT_FOUND"), null);
            var parents = document.Screens.Where(s => s.ChildIds.Contains(node.Id)).Select(s => s.Id)
                .Concat(document.Nodes.Where(n => n.ChildIds.Contains(node.Id)).Select(n => n.Id)).ToArray();
            if (parents.Length != 1 || parents[0] != command.ExpectedParentId)
                return new(Result("INVALID_LAYOUT_CONTEXT"), null);
            var screen = document.Screens.FirstOrDefault(s => s.Id == command.TargetParentId);
            var parent = document.Nodes.FirstOrDefault(n => n.Id == command.TargetParentId);
            if (screen is null && parent is null)
                return new(Result(document.Assets.Any(a => a.Id == command.TargetParentId) || document.Datasets.Any(d => d.Id == command.TargetParentId) || document.Id == command.TargetParentId || document.Pages.Any(p => p.Id == command.TargetParentId)
                    ? "INVALID_PARENT_TYPE" : "PARENT_NOT_FOUND"), null);
            if (parent is not null && !ProfileFor(document).CanContainChildren(parent.Kind))
                return new(Result("CHILDREN_NOT_ALLOWED"), null);
            var pending = new Stack<Guid>();
            pending.Push(node.Id);
            while (pending.TryPop(out var id))
            {
                if (id == command.TargetParentId) return new(Result("CYCLE_NOT_ALLOWED"), null);
                foreach (var child in document.Nodes.First(n => n.Id == id).ChildIds) pending.Push(child);
            }
            var children = screen?.ChildIds ?? parent!.ChildIds;
            var count = children.Count - (command.ExpectedParentId == command.TargetParentId ? 1 : 0);
            if (command.Position < 0 || command.Position > count) return new(Result("INVALID_POSITION"), null);
            var changed = DocumentStructureEditor.MoveNode(document, node.Id, command.TargetParentId, command.Position);
            if (DocumentStructureValidator.Validate(changed, profile) is { Count: > 0 } moveErrors) return new(Result(moveErrors.Any(e => e.Code == "INVALID_SCENARIO") ? "SCENARIO_IN_USE" : moveErrors.Any(e => e.Code == "INVALID_VARIANT_NODE") ? "SCREEN_VARIANT_IN_USE" : moveErrors.Any(e => e.Code == "INVALID_REPEATER") ? "INVALID_REPEATER" : "INVALID_COMPONENT"), null);
            var revision = checked(state.Revision + 1);
            return new(Result("ACCEPTED", revision),
                new(changed, revision),
                new NodeMoved(node.Id, command.TargetParentId, command.Position));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    public async Task<CommandResult> HandleAsync(DeleteNodeCommand command, DocumentActor actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(actor);
        CommandResult Result(string code, long? revision = null) => new(command.DocumentId,
            command.CommandId, code, revision, actor.Id, null, DateTimeOffset.UtcNow,
            NodeId: code == "ACCEPTED" ? command.NodeId : null);

        if (string.IsNullOrWhiteSpace(actor.Id) ||
            !await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken))
            return Result("FORBIDDEN");
        if (command.DocumentId == Guid.Empty || command.CommandId == Guid.Empty || command.NodeId == Guid.Empty)
            return Result("INVALID_ID");

        return await journal.ExecuteAsync(command.DocumentId, command.CommandId, (state, _, _) =>
        {
            if (state is null) return new(Result("DOCUMENT_NOT_FOUND"), null);
            if (!state.Document.Nodes.Any(n => n.Id == command.NodeId))
                return new(Result("NODE_NOT_FOUND"), null);
            var revision = checked(state.Revision + 1);
            var document = DocumentStructureEditor.DeleteNode(state.Document, command.NodeId);
            if (DocumentStructureValidator.Validate(document, profile) is { Count: > 0 } deleteErrors)
                return new(Result(deleteErrors.Any(e => e.Code == "INVALID_SCENARIO") ? "SCENARIO_IN_USE" : deleteErrors.Any(e => e.Code == "INVALID_VARIANT_NODE") ? "SCREEN_VARIANT_IN_USE" : deleteErrors.Any(e => e.Code == "INVALID_REPEATER") ? "INVALID_REPEATER" : "INVALID_COMPONENT"), null);
            return new(Result("ACCEPTED", revision) with { AffectedIds = ChangedIds(DocumentPatch.Between(state.Document, document)) },
                new(document, revision), new NodeDeleted(command.NodeId));
        }, cancellationToken, authorize: async () =>
            await authorization.CanEditAsync(actor, command.DocumentId, cancellationToken) ? null : Result("FORBIDDEN"));
    }

    private INodeProfile ProfileFor(DocumentStructure document) => PortableUiProfileResolver.Require(document.Profile, profile);

    private static Guid[] ChangedIds(DocumentPatch patch) => patch.Pages.Select(x => x.Id).Concat(patch.Assets.Select(x => x.Id))
        .Concat(patch.Scenarios.Select(x => x.Id)).Concat(patch.ComponentDefinitions.Select(x => x.Id)).Concat(patch.ComponentInstances.Select(x => x.Id))
        .Concat(patch.Datasets.Select(x => x.Id)).Concat(patch.Tokens.Select(x => x.Id)).Concat(patch.Screens.Select(x => x.Id)).Concat(patch.Nodes.Select(x => x.Id)).Distinct().ToArray();

}
