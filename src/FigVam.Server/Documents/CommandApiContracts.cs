using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using FigVam.Domain.Documents;

namespace FigVam.Server.Documents;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DeleteDocumentRequest { public required Guid CommandId { get; init; } [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DeletePageRequest { public required Guid CommandId { get; init; } public required Guid PageId { get; init; } [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; } }
public sealed class RenameDocumentRequest { public required Guid CommandId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RenamePageRequest { public required Guid CommandId { get; init; } public required Guid PageId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RenameScreenRequest { public required Guid CommandId { get; init; } public required Guid ScreenId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddPageRequest { public required Guid CommandId { get; init; } public required Guid PageId { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddScreenRequest { public required Guid CommandId { get; init; } public required Guid PageId { get; init; } public required Guid ScreenId { get; init; } [Required] public required ScreenDimensions Dimensions { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DuplicateScreenRequest
{
    public required Guid CommandId { get; init; }
    public required Guid ScreenId { get; init; }
    public required Guid NewScreenId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ResizeScreenRequest { public required Guid CommandId { get; init; } public required Guid ScreenId { get; init; } [Required] public required ScreenDimensions Dimensions { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddNodeRequest
{
    public required Guid CommandId { get; init; }
    public required Guid ParentId { get; init; }
    public required Guid NodeId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Kind { get; init; }
    public IReadOnlyDictionary<string, NodePropertyValue>? Properties { get; init; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DeleteNodeRequest { public required Guid CommandId { get; init; } public required Guid NodeId { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class MoveNodeRequest { public required Guid CommandId { get; init; } public required Guid NodeId { get; init; } public required Guid ExpectedParentId { get; init; } public required Guid TargetParentId { get; init; } public required int Position { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetNodePropertyRequest { public required Guid CommandId { get; init; } public required Guid NodeId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Property { get; init; } [Required] public required NodePropertyValue Value { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetNodePropertiesRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    [Required] public required IReadOnlyDictionary<string, NodePropertyValue> Properties { get; init; }
    public Guid? ExpectedParentId { get; init; }
    public long? ExpectedRevision { get; init; }
}
public sealed class UpgradePortableUiProfileRequest { public required Guid CommandId { get; init; } public required long ExpectedRevision { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SaveDocumentRequest { public required Guid CommandId { get; init; } [StringLength(256)] public string? Name { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RestoreDocumentRequest { public required Guid CommandId { get; init; } public required Guid VersionId { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class HistoryCommandRequest { public required Guid CommandId { get; init; } }
public sealed record CommandResponse(string Status, Guid DocumentId, Guid CommandId, long Revision, Guid? PageId, Guid? ScreenId, Guid? NodeId, Guid? VersionId, IReadOnlyList<Guid> AffectedIds);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetNodeNameRequest { public required Guid CommandId { get; init; } public required Guid NodeId { get; init; } [StringLength(256)] public required string Name { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetNodeSemanticKeyRequest { public required Guid CommandId { get; init; } public required Guid NodeId { get; init; } [StringLength(256, MinimumLength = 1)] public required string? SemanticKey { get; init; } }

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddComponentDefinitionRequest
{
    public required Guid CommandId { get; init; }
    public required Guid ComponentId { get; init; }
    public required Guid RootNodeId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; }
    [StringLength(4096)] public required string Description { get; init; }
}

public sealed class AddTokenRequest
{
    public required Guid CommandId { get; init; }
    public required Guid TokenId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; }
    public required FigVam.Domain.Tokens.TokenType Type { get; init; }
    [Required] public required IReadOnlyDictionary<FigVam.Domain.Tokens.TokenTheme, FigVam.Domain.Tokens.TokenExpression> Values { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RenameTokenRequest { public required Guid CommandId { get; init; } public required Guid TokenId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; } }

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetTokenValueRequest
{
    public required Guid CommandId { get; init; }
    public required Guid TokenId { get; init; }
    public required FigVam.Domain.Tokens.TokenTheme Theme { get; init; }
    [Required] public required FigVam.Domain.Tokens.TokenExpression Value { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class InsertComponentInstanceRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    public required Guid DefinitionId { get; init; }
    public required Guid ParentId { get; init; }
    [Range(0, int.MaxValue)] public required int Position { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DetachComponentInstanceRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddComponentParameterRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DefinitionId { get; init; }
    public required Guid ParameterId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; }
    public required FigVam.Domain.Components.ComponentParameterType Type { get; init; }
    [Required] public required FigVam.Domain.Components.ComponentValue DefaultValue { get; init; }
    public FigVam.Domain.Tokens.TokenType? TokenType { get; init; }
    public IReadOnlyList<string>? EnumValues { get; init; }
    public required Guid NodeId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Property { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetComponentParameterOverrideRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    public required Guid ParameterId { get; init; }
    [Required] public required FigVam.Domain.Components.ComponentValue Value { get; init; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RemoveComponentParameterOverrideRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    public required Guid ParameterId { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddComponentVariantRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DefinitionId { get; init; }
    public required Guid VariantId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; }
    public required FigVam.Domain.Components.ComponentVariantKind Kind { get; init; }
    public Guid? BaseVariantId { get; init; }
    [Required] public required IReadOnlyDictionary<Guid, FigVam.Domain.Components.ComponentValue> ParameterChanges { get; init; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetComponentInstanceVariantRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    public required Guid? VariantId { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddComponentSlotRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DefinitionId { get; init; }
    public required Guid SlotId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; }
    public required Guid ContainerNodeId { get; init; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetComponentSlotContentRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    public required Guid SlotId { get; init; }
    [Required] public required IReadOnlyList<Guid> ContentNodeIds { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetComponentParameterDefaultRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DefinitionId { get; init; }
    public required Guid ParameterId { get; init; }
    [Required] public required FigVam.Domain.Components.ComponentValue Value { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetComponentVariantParameterChangeRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DefinitionId { get; init; }
    public required Guid VariantId { get; init; }
    public required Guid ParameterId { get; init; }
    [Required] public required FigVam.Domain.Components.ComponentValue Value { get; init; }
}
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RemoveComponentVariantParameterChangeRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DefinitionId { get; init; }
    public required Guid VariantId { get; init; }
    public required Guid ParameterId { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DeleteComponentDefinitionRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DefinitionId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
    public ComponentReplacementRequest? Replacement { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ComponentReplacementRequest
{
    public required Guid DefinitionId { get; init; }
    [Required] public required IReadOnlyDictionary<Guid, Guid> ParameterIds { get; init; }
    [Required] public required IReadOnlyDictionary<Guid, Guid> SlotIds { get; init; }
    [Required] public required IReadOnlyDictionary<Guid, Guid> VariantIds { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddDatasetRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DatasetId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; }
    [Required, StringLength(DatasetValidator.MaxFixtureBytes, MinimumLength = 1)] public required string FixtureJson { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ReplaceDatasetFixtureRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DatasetId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
    [Required, StringLength(DatasetValidator.MaxFixtureBytes, MinimumLength = 1)] public required string FixtureJson { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddCsvDatasetRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DatasetId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; }
    [Required, StringLength(DatasetValidator.MaxFixtureBytes, MinimumLength = 1)] public required string Csv { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ReplaceDatasetFixtureFromCsvRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DatasetId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
    [Required, StringLength(DatasetValidator.MaxFixtureBytes, MinimumLength = 1)] public required string Csv { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class BindNodeDataRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Property { get; init; }
    [Required] public required FigVam.Domain.Documents.NodeDataBinding Binding { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class UnbindNodeDataRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    [Required, StringLength(256, MinimumLength = 1)] public required string Property { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class DeleteDatasetRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DatasetId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetNodeRepeaterRequest
{
    public required Guid CommandId { get; init; }
    public required Guid NodeId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
    public required NodeRepeater? Repeater { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ImportDesignTokensRequest
{
    public required Guid CommandId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
    [Required, StringLength(1048576)] public required string LightJson { get; init; }
    [Required, StringLength(1048576)] public required string DarkJson { get; init; }
    [Required] public required IReadOnlyDictionary<string, FigVam.Domain.Tokens.TokenType> DimensionTypes { get; init; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class AddScreenVariantRequest { public required Guid CommandId { get; init; } public required Guid ScreenId { get; init; } public required Guid VariantId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Name { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetScreenVariantOverrideRequest { public required Guid CommandId { get; init; } public required Guid ScreenId { get; init; } public required Guid VariantId { get; init; } public required Guid NodeId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Property { get; init; } [Required] public required NodePropertyValue Value { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class RemoveScreenVariantOverrideRequest { public required Guid CommandId { get; init; } public required Guid ScreenId { get; init; } public required Guid VariantId { get; init; } public required Guid NodeId { get; init; } [Required, StringLength(256, MinimumLength = 1)] public required string Property { get; init; } public long? ExpectedRevision { get; init; } }
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class SetScreenVariantPropertiesRequest
{
    public required Guid CommandId { get; init; }
    public required Guid ScreenId { get; init; }
    public required Guid VariantId { get; init; }
    public required Guid NodeId { get; init; }
    [Required] public required IReadOnlyDictionary<string, NodePropertyValue> Properties { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
}

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed class CreateScenarioRequest { public required Guid CommandId { get; init; } [Required] public required FigVam.Domain.Preview.PreviewScenario Scenario { get; init; } }
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed class UpdateScenarioRequest { public required Guid CommandId { get; init; } [Required] public required FigVam.Domain.Preview.PreviewScenario Scenario { get; init; } [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; } }
[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed class DeleteScenarioRequest { public required Guid CommandId { get; init; } public required Guid ScenarioId { get; init; } [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; } }

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed class SetDatasetConnectorRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DatasetId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
    [Required, StringLength(128, MinimumLength = 1), RegularExpression(@"^[A-Za-z0-9_.-]+$")]
    public required string ConnectorId { get; init; }
}

[System.Text.Json.Serialization.JsonUnmappedMemberHandling(System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow)]
public sealed class RemoveDatasetConnectorRequest
{
    public required Guid CommandId { get; init; }
    public required Guid DatasetId { get; init; }
    [Range(0, long.MaxValue)] public required long ExpectedRevision { get; init; }
}
