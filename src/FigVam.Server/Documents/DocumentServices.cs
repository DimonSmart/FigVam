using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Documents;

public static class DocumentServices
{
    public static void AddDocumentServices(this WebApplicationBuilder builder)
    {
        var directory = builder.Configuration["Storage:Directory"];
        if (string.IsNullOrWhiteSpace(directory))
            throw new InvalidOperationException("Storage:Directory is required.");
        var fullPath = Path.GetFullPath(directory, builder.Environment.ContentRootPath);
        var profile = new UnverifiedNodeProfile();
        var journal = new SqliteDocumentJournal(fullPath, profile);
        builder.Services.AddSingleton<INodeProfile>(profile);
        builder.Services.AddSingleton(journal);
        builder.Services.AddSingleton<IDocumentAssetStore>(journal);
        builder.Services.AddSingleton<IDocumentAssets, DocumentAssets>();
        builder.Services.AddSingleton<IDocumentAccessService>(journal);
        builder.Services.AddSingleton<IDocumentListQuery>(journal);
        builder.Services.AddSingleton<IDocumentAuthorization>(journal);
        builder.Services.AddSingleton<IDocumentCommandJournal>(journal);
        builder.Services.AddSingleton<IDocumentStateReader>(journal);
        builder.Services.AddSingleton<IDocumentEventJournal>(journal);
        builder.Services.AddSingleton<IDocumentReconnectReader, DocumentReconnectReader>();
        builder.Services.AddSingleton<IDocumentSubscriptions, DocumentSubscriptions>();
        builder.Services.AddSingleton<DocumentSubscriptionLimits>();
        builder.Services.AddSingleton<IDocumentVersionStore>(journal);
        builder.Services.AddSingleton<IDocumentVersionReader, DocumentVersionReader>();
        builder.Services.AddSingleton<IDocumentPresence>(services => new DocumentPresence(
            services.GetRequiredService<IDocumentAuthorization>(), TimeProvider.System, TimeSpan.FromMinutes(1)));
        builder.Services.AddSingleton<IDocumentStructureQueries, DocumentStructureQueries>();
        builder.Services.AddSingleton<IDocumentRevisionDiff, DocumentRevisionDiff>();
        builder.Services.AddSingleton<IDocumentDiagnostics, DocumentDiagnostics>();
        builder.Services.AddSingleton<IDocumentScenarioQueries, DocumentScenarioQueries>();
        builder.Services.AddSingleton<IScenarioCapabilitiesQuery, ScenarioCapabilitiesQuery>();
        builder.Services.AddSingleton<IDocumentPreviewFactory, DocumentPreviewFactory>();
        builder.Services.AddSingleton<IDocumentScreenVariantQueries, DocumentScreenVariantQueries>();
        builder.Services.AddSingleton<IDocumentScreenVariantDiff, DocumentScreenVariantDiff>();
        builder.Services.AddSingleton<IDocumentRepeaterQueries, DocumentRepeaterQueries>();
        builder.Services.AddSingleton<IDocumentDatasetQueries, DocumentDatasetQueries>();
        builder.Services.AddSingleton<IDocumentTokenQueries, DocumentTokenQueries>();
        builder.Services.AddSingleton<IDocumentTokenExporter, DocumentTokenExporter>();
        builder.Services.AddSingleton<IDocumentJsonExporter, DocumentJsonExporter>();
        builder.Services.AddSingleton<IDocumentContainerExporter, DocumentContainerExporter>();
        builder.Services.AddSingleton<IDocumentFileReader, DocumentFileReader>();
        builder.Services.AddSingleton<IDocumentImportStore>(journal);
        builder.Services.AddSingleton<IDocumentFileImporter, DocumentFileImporter>();
        builder.Services.AddSingleton<IDocumentComponentQueries, DocumentComponentQueries>();
        builder.Services.AddSingleton<IDocumentCommandHandler, DocumentCommandHandler>();
    }
}

// No node or property has yet met the production profile verification contract.
public sealed class UnverifiedNodeProfile : INodeProfile
{
    public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
    public bool IsKnownKind(string kind) => false;
    public bool CanContainChildren(string kind) => false;
    public NodePropertyDefinition? GetProperty(string kind, string property) => null;
}








