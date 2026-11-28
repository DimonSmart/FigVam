using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Schema;

namespace FigVam.Server.Documents;

public static class DocumentSchemas
{
    private static readonly IReadOnlyDictionary<string, Type> Types = new Dictionary<string, Type>
    {
        [nameof(FigVam.Domain.Documents.PortableUiProfileReference)] = typeof(FigVam.Domain.Documents.PortableUiProfileReference),
        [nameof(FigVam.Domain.Documents.DocumentAsset)] = typeof(FigVam.Domain.Documents.DocumentAsset),
        [nameof(FigVam.Application.Documents.DocumentAssetsResponse)] = typeof(FigVam.Application.Documents.DocumentAssetsResponse),
        [nameof(CreateDocumentRequest)] = typeof(CreateDocumentRequest),
        [nameof(FigVam.Application.Documents.DocumentImportResponse)] = typeof(FigVam.Application.Documents.DocumentImportResponse),
        [nameof(FigVam.Application.Documents.DocumentImportFailure)] = typeof(FigVam.Application.Documents.DocumentImportFailure),
        [nameof(FigVam.Application.Documents.DocumentReadDiagnostic)] = typeof(FigVam.Application.Documents.DocumentReadDiagnostic),
        [nameof(FigVam.Application.Documents.ScenarioCapabilitiesResponse)] = typeof(FigVam.Application.Documents.ScenarioCapabilitiesResponse),
        [nameof(CreateScenarioRequest)] = typeof(CreateScenarioRequest),
        [nameof(UpdateScenarioRequest)] = typeof(UpdateScenarioRequest),
        [nameof(DeleteScenarioRequest)] = typeof(DeleteScenarioRequest),
        [nameof(FigVam.Domain.Preview.PreviewScenario)] = typeof(FigVam.Domain.Preview.PreviewScenario),
        [nameof(FigVam.Application.Documents.ScenariosResponse)] = typeof(FigVam.Application.Documents.ScenariosResponse),
        [nameof(AddScreenVariantRequest)] = typeof(AddScreenVariantRequest),
        [nameof(SetScreenVariantOverrideRequest)] = typeof(SetScreenVariantOverrideRequest),
        [nameof(RemoveScreenVariantOverrideRequest)] = typeof(RemoveScreenVariantOverrideRequest),
        [nameof(FigVam.Domain.Documents.ScreenVariant)] = typeof(FigVam.Domain.Documents.ScreenVariant),
        [nameof(FigVam.Application.Documents.ScreenVariantsResponse)] = typeof(FigVam.Application.Documents.ScreenVariantsResponse),
        [nameof(FigVam.Application.Documents.ScreenVariantDiffResponse)] = typeof(FigVam.Application.Documents.ScreenVariantDiffResponse),
        [nameof(SetDocumentMemberRequest)] = typeof(SetDocumentMemberRequest),
        [nameof(FigVam.Application.Documents.DocumentListItem)] = typeof(FigVam.Application.Documents.DocumentListItem),
        [nameof(FigVam.Application.Documents.DocumentListResponse)] = typeof(FigVam.Application.Documents.DocumentListResponse),
        [nameof(DocumentAccessResponse)] = typeof(DocumentAccessResponse),
        [nameof(ApiError)] = typeof(ApiError),
        [nameof(AddComponentSlotRequest)] = typeof(AddComponentSlotRequest),
        [nameof(SetComponentSlotContentRequest)] = typeof(SetComponentSlotContentRequest),
        [nameof(AddComponentVariantRequest)] = typeof(AddComponentVariantRequest),
        [nameof(SetComponentInstanceVariantRequest)] = typeof(SetComponentInstanceVariantRequest),
        [nameof(FigVam.Domain.Components.ComponentVariant)] = typeof(FigVam.Domain.Components.ComponentVariant),
        [nameof(SetComponentVariantParameterChangeRequest)] = typeof(SetComponentVariantParameterChangeRequest),
        [nameof(RemoveComponentVariantParameterChangeRequest)] = typeof(RemoveComponentVariantParameterChangeRequest),
        [nameof(SetComponentParameterDefaultRequest)] = typeof(SetComponentParameterDefaultRequest),
        [nameof(SetComponentParameterOverrideRequest)] = typeof(SetComponentParameterOverrideRequest),
        [nameof(RemoveComponentParameterOverrideRequest)] = typeof(RemoveComponentParameterOverrideRequest),
        [nameof(SetTokenValueRequest)] = typeof(SetTokenValueRequest),
        [nameof(RenameTokenRequest)] = typeof(RenameTokenRequest),
        [nameof(DeleteComponentDefinitionRequest)] = typeof(DeleteComponentDefinitionRequest),
        [nameof(ComponentReplacementRequest)] = typeof(ComponentReplacementRequest),
        [nameof(DetachComponentInstanceRequest)] = typeof(DetachComponentInstanceRequest),
        [nameof(InsertComponentInstanceRequest)] = typeof(InsertComponentInstanceRequest),
        [nameof(FigVam.Domain.Components.ComponentInstance)] = typeof(FigVam.Domain.Components.ComponentInstance),
        [nameof(AddComponentParameterRequest)] = typeof(AddComponentParameterRequest),
        [nameof(AddComponentDefinitionRequest)] = typeof(AddComponentDefinitionRequest),
        [nameof(FigVam.Domain.Components.ComponentDefinition)] = typeof(FigVam.Domain.Components.ComponentDefinition),
        [nameof(AddCsvDatasetRequest)] = typeof(AddCsvDatasetRequest),
        [nameof(ReplaceDatasetFixtureFromCsvRequest)] = typeof(ReplaceDatasetFixtureFromCsvRequest),
        [nameof(FigVam.Application.Documents.RepeaterEvaluationResponse)] = typeof(FigVam.Application.Documents.RepeaterEvaluationResponse),
        [nameof(SetNodeRepeaterRequest)] = typeof(SetNodeRepeaterRequest),
        [nameof(FigVam.Domain.Documents.NodeRepeater)] = typeof(FigVam.Domain.Documents.NodeRepeater),
        [nameof(FigVam.Domain.Documents.NodeRepeaterResult)] = typeof(FigVam.Domain.Documents.NodeRepeaterResult),
        [nameof(FigVam.Domain.Documents.ExpandedRepeaterNode)] = typeof(FigVam.Domain.Documents.ExpandedRepeaterNode),
        [nameof(BindNodeDataRequest)] = typeof(BindNodeDataRequest),
        [nameof(UnbindNodeDataRequest)] = typeof(UnbindNodeDataRequest),
        [nameof(DeleteDatasetRequest)] = typeof(DeleteDatasetRequest),
        [nameof(FigVam.Domain.Documents.NodeDataBinding)] = typeof(FigVam.Domain.Documents.NodeDataBinding),
        [nameof(SetDatasetConnectorRequest)] = typeof(SetDatasetConnectorRequest),
        [nameof(RemoveDatasetConnectorRequest)] = typeof(RemoveDatasetConnectorRequest),
        [nameof(AddDatasetRequest)] = typeof(AddDatasetRequest),
        [nameof(ReplaceDatasetFixtureRequest)] = typeof(ReplaceDatasetFixtureRequest),
        [nameof(FigVam.Domain.Documents.DocumentDataset)] = typeof(FigVam.Domain.Documents.DocumentDataset),
        [nameof(FigVam.Application.Documents.DatasetSummary)] = typeof(FigVam.Application.Documents.DatasetSummary),
        [nameof(FigVam.Application.Documents.DatasetListResponse)] = typeof(FigVam.Application.Documents.DatasetListResponse),
        [nameof(FigVam.Application.Documents.DatasetResponse)] = typeof(FigVam.Application.Documents.DatasetResponse),
        [nameof(FigVam.Application.Documents.DatasetFixtureResponse)] = typeof(FigVam.Application.Documents.DatasetFixtureResponse),
        [nameof(ImportDesignTokensRequest)] = typeof(ImportDesignTokensRequest),
        [nameof(FigVam.Application.Documents.TokenImportDiagnostic)] = typeof(FigVam.Application.Documents.TokenImportDiagnostic),
        [nameof(AddTokenRequest)] = typeof(AddTokenRequest),
        [nameof(FigVam.Domain.Documents.DocumentStructure)] = typeof(FigVam.Domain.Documents.DocumentStructure),
        [nameof(DeleteDocumentRequest)] = typeof(DeleteDocumentRequest),
        [nameof(DeletePageRequest)] = typeof(DeletePageRequest),
        [nameof(DeleteScreenRequest)] = typeof(DeleteScreenRequest),
        [nameof(RenameDocumentRequest)] = typeof(RenameDocumentRequest),
        [nameof(RenamePageRequest)] = typeof(RenamePageRequest),
        [nameof(RenameScreenRequest)] = typeof(RenameScreenRequest),
        [nameof(AddPageRequest)] = typeof(AddPageRequest),
        [nameof(ResizeScreenRequest)] = typeof(ResizeScreenRequest),
        [nameof(FigVam.Domain.Documents.ScreenDimensions)] = typeof(FigVam.Domain.Documents.ScreenDimensions),
        [nameof(AddScreenRequest)] = typeof(AddScreenRequest),
        [nameof(AddNodeRequest)] = typeof(AddNodeRequest),
        [nameof(DeleteNodeRequest)] = typeof(DeleteNodeRequest),
        [nameof(MoveNodeRequest)] = typeof(MoveNodeRequest),
        [nameof(SetNodeNameRequest)] = typeof(SetNodeNameRequest),
        [nameof(SetNodeSemanticKeyRequest)] = typeof(SetNodeSemanticKeyRequest),
        [nameof(FigVam.Application.Documents.TokenExportResponse)] = typeof(FigVam.Application.Documents.TokenExportResponse),
        [nameof(FigVam.Application.Documents.TokenListResponse)] = typeof(FigVam.Application.Documents.TokenListResponse),
        [nameof(FigVam.Application.Documents.TokenResponse)] = typeof(FigVam.Application.Documents.TokenResponse),
        [nameof(FigVam.Application.Documents.TokenUsage)] = typeof(FigVam.Application.Documents.TokenUsage),
        [nameof(FigVam.Application.Documents.TokenUsagesResponse)] = typeof(FigVam.Application.Documents.TokenUsagesResponse),
        [nameof(FigVam.Application.Documents.ComponentListResponse)] = typeof(FigVam.Application.Documents.ComponentListResponse),
        [nameof(FigVam.Application.Documents.ComponentResponse)] = typeof(FigVam.Application.Documents.ComponentResponse),
        [nameof(FigVam.Application.Documents.ComponentUsagesResponse)] = typeof(FigVam.Application.Documents.ComponentUsagesResponse),
        [nameof(QueryOptions)] = typeof(QueryOptions),
        [nameof(SetNodePropertyRequest)] = typeof(SetNodePropertyRequest),
        [nameof(SetNodePropertiesRequest)] = typeof(SetNodePropertiesRequest),
        [nameof(EditNodesRequest)] = typeof(EditNodesRequest),
        [nameof(SaveDocumentRequest)] = typeof(SaveDocumentRequest),
        [nameof(RestoreDocumentRequest)] = typeof(RestoreDocumentRequest),
        [nameof(HistoryCommandRequest)] = typeof(HistoryCommandRequest),
        [nameof(PresenceUpdateRequest)] = typeof(PresenceUpdateRequest),
        [nameof(PresenceCursorRequest)] = typeof(PresenceCursorRequest),
        [nameof(PresenceUpdateResponse)] = typeof(PresenceUpdateResponse),
        [nameof(PresenceParticipantsResponse)] = typeof(PresenceParticipantsResponse),
        [nameof(FigVam.Application.Documents.PresenceParticipant)] = typeof(FigVam.Application.Documents.PresenceParticipant),
        [nameof(ReconnectResponse)] = typeof(ReconnectResponse),
        [nameof(FigVam.Application.Documents.DocumentSubscriptionMessage)] = typeof(FigVam.Application.Documents.DocumentSubscriptionMessage),
        [nameof(FigVam.Application.Documents.CommittedDocumentEvent)] = typeof(FigVam.Application.Documents.CommittedDocumentEvent),
        [nameof(CommandResponse)] = typeof(CommandResponse),
        [nameof(VersionMetadataResponse)] = typeof(VersionMetadataResponse),
        [nameof(VersionHistoryResponse)] = typeof(VersionHistoryResponse),
        [nameof(FigVam.Application.Documents.RevisionDiffItem)] = typeof(FigVam.Application.Documents.RevisionDiffItem),
        [nameof(FigVam.Application.Documents.RevisionDiffResponse)] = typeof(FigVam.Application.Documents.RevisionDiffResponse),
        [nameof(FigVam.Application.Documents.StructureDiagnostic)] = typeof(FigVam.Application.Documents.StructureDiagnostic),
        [nameof(FigVam.Application.Documents.StructureDiagnosticsResponse)] = typeof(FigVam.Application.Documents.StructureDiagnosticsResponse),
        [nameof(FigVam.Application.Documents.StructureItem)] = typeof(FigVam.Application.Documents.StructureItem),
        [nameof(FigVam.Application.Documents.DocumentProfileResponse)] = typeof(FigVam.Application.Documents.DocumentProfileResponse),
        [nameof(FigVam.Application.Documents.StructureResponse)] = typeof(FigVam.Application.Documents.StructureResponse),
        [nameof(FigVam.Application.Documents.ScreenLayoutResponse)] = typeof(FigVam.Application.Documents.ScreenLayoutResponse)
    };

    public static JsonNode CreateDocumentFormat() => FigVam.Application.Documents.DocumentFormatSchemas.CreateDocumentFormat();
    public static JsonNode CreateManifestFormat() => FigVam.Application.Documents.DocumentFormatSchemas.CreateManifestFormat();

    public static JsonNode Create(Type type)
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.MakeReadOnly(populateMissingResolver: true);
        var schema = options.GetJsonSchemaAsNode(type, new JsonSchemaExporterOptions
        {
            TreatNullObliviousAsNonNullable = true,
            TransformSchemaNode = (context, node) =>
            {
                if (context.PropertyInfo?.AttributeProvider is System.Reflection.PropertyInfo property &&
                    property.DeclaringType == typeof(FigVam.Domain.Documents.ScreenDimensions) && node is JsonObject)
                {
                    node["minimum"] = 0;
                    node["maximum"] = double.MaxValue;
                }
                if (context.PropertyInfo?.AttributeProvider is { } attributes && node is JsonObject)
                    foreach (var attribute in attributes.GetCustomAttributes(true))
                    {
                        if (attribute is StringLengthAttribute length)
                        {
                            node["minLength"] = length.MinimumLength;
                            node["maxLength"] = length.MaximumLength;
                        }
                        if (attribute is RangeAttribute range)
                        {
                            node["minimum"] = Convert.ToDouble(range.Minimum, System.Globalization.CultureInfo.InvariantCulture);
                            node["maximum"] = Convert.ToDouble(range.Maximum, System.Globalization.CultureInfo.InvariantCulture);
                        }
                        if (attribute is MaxLengthAttribute maxLength) node["maxItems"] = maxLength.Length;
                        if (attribute is RegularExpressionAttribute pattern) node["pattern"] = pattern.Pattern;
                    }
                return node;
            }
        });
        schema["$schema"] = "https://json-schema.org/draft/2020-12/schema";
        schema["$id"] = "urn:figvam:api:v1:" + type.Name;
        return schema;
    }

    public static void MapDocumentSchemas(this WebApplication app)
    {
        app.MapGet("/api/v1/schemas/{name}.json", (string name) => name == "document-v1" ? Results.Json(CreateDocumentFormat()) : name == "manifest-v1" ? Results.Json(CreateManifestFormat()) : Types.TryGetValue(name, out var type)
            ? Results.Json(Create(type)) : Results.NotFound(ApiErrors.Create(404)))
            .ExcludeFromDescription();
    }
}








