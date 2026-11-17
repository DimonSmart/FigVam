using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Server.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

public sealed class CsvDatasetTests
{
    [Fact]
    public async Task CsvUsesDatasetJournalHistoryAndSavedVersions()
    {
        var path = Path.Combine(Path.GetTempPath(), "figvam-csv-" + Guid.NewGuid());
        try
        {
            var journal = new SqliteDocumentJournal(path, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            var doc = Guid.NewGuid(); var id = Guid.NewGuid(); var owner = new DocumentActor("owner");
            await journal.CreateAsync(new(doc), owner);
            var command = new AddCsvDatasetCommand(doc, Guid.NewGuid(), id, "data", "name,note,empty\r\nAlice,\"a,\"\"b\"\"\nline\",\r\n");
            Assert.True((await handler.HandleAsync(command, owner)).Accepted);
            Assert.True((await handler.HandleAsync(command with { Csv = "bad\"" }, owner)).Accepted);
            var fixture = (await journal.ReadAsync(doc))!.Document.Datasets.Single().FixtureJson;
            using var parsed = JsonDocument.Parse(fixture);
            var row = parsed.RootElement[0];
            Assert.Equal("Alice", row.GetProperty("name").GetString());
            Assert.Equal("a,\"b\"\nline", row.GetProperty("note").GetString());
            Assert.Equal("", row.GetProperty("empty").GetString());
            var save = await handler.HandleAsync(new SaveDocumentCommand(doc, Guid.NewGuid(), "saved"), owner);
            Assert.True((await handler.HandleAsync(new ReplaceDatasetFixtureFromCsvCommand(doc, Guid.NewGuid(), id, save.Revision!.Value, "name\nBob"), owner)).Accepted);
            Assert.True((await handler.HandleAsync(new UndoDocumentCommand(doc, Guid.NewGuid()), owner)).Accepted);
            Assert.Equal(fixture, (await journal.ReadAsync(doc))!.Document.Datasets.Single().FixtureJson);
            Assert.True((await handler.HandleAsync(new RestoreDocumentVersionCommand(doc, Guid.NewGuid(), save.VersionId!.Value), owner)).Accepted);
            var recovered = await new SqliteDocumentJournal(path, new UnverifiedNodeProfile()).ReadAsync(doc);
            Assert.Equal(fixture, recovered!.Document.Datasets.Single().FixtureJson);
        }
        finally { Directory.Delete(path, true); }
    }

    [Fact]
    public async Task EnforcesExactConvertedFixtureByteLimit()
    {
        var path = Path.Combine(Path.GetTempPath(), "figvam-csv-" + Guid.NewGuid());
        try
        {
            var journal = new SqliteDocumentJournal(path, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            var doc = Guid.NewGuid(); var id = Guid.NewGuid(); var owner = new DocumentActor("owner");
            await journal.CreateAsync(new(doc), owner);
            var csv = "a\n" + new string('x', 65526);
            Assert.True((await handler.HandleAsync(new AddCsvDatasetCommand(doc, Guid.NewGuid(), id, "data", csv), owner)).Accepted);
            Assert.Equal(65536, System.Text.Encoding.UTF8.GetByteCount((await journal.ReadAsync(doc))!.Document.Datasets.Single().FixtureJson));
            Assert.Equal("INVALID_CSV_FIXTURE", (await handler.HandleAsync(new ReplaceDatasetFixtureFromCsvCommand(doc, Guid.NewGuid(), id, 1, csv + "x"), owner)).Code);
            Assert.Equal(1, (await journal.ReadAsync(doc))!.Revision);
        }
        finally { Directory.Delete(path, true); }
    }

    [Fact]
    public async Task RejectsMalformedAmbiguousAndOversizedCsvWithoutMutation()
    {
        var path = Path.Combine(Path.GetTempPath(), "figvam-csv-" + Guid.NewGuid());
        try
        {
            var journal = new SqliteDocumentJournal(path, new UnverifiedNodeProfile());
            var handler = new DocumentCommandHandler(journal, journal, new UnverifiedNodeProfile());
            var doc = Guid.NewGuid(); var id = Guid.NewGuid(); var owner = new DocumentActor("owner");
            await journal.CreateAsync(new(doc), owner); await journal.SetMemberAsync(doc, "viewer", DocumentRole.Viewer, owner);
            Assert.True((await handler.HandleAsync(new AddCsvDatasetCommand(doc, Guid.NewGuid(), id, "data", "a,b"), owner)).Accepted);
            Assert.Equal("[]", (await journal.ReadAsync(doc))!.Document.Datasets.Single().FixtureJson);
            var before = JsonSerializer.Serialize(await journal.ReadAsync(doc));
            var bad = new[] { "", "a,a\nx,y", ",b\nx,y", "a,b\nx", "a\n\"unclosed", "a\nx\"y", "a\n\"x\"z", "a\rx", "\uFEFFa", "a\n\0", new string('я', 32769), new string('a', 32000) + "\n" + string.Join('\n', Enumerable.Repeat("x", 4)) };
            foreach (var csv in bad)
                Assert.Equal("INVALID_CSV_FIXTURE", (await handler.HandleAsync(new ReplaceDatasetFixtureFromCsvCommand(doc, Guid.NewGuid(), id, 1, csv), owner)).Code);
            Assert.Equal("FORBIDDEN", (await handler.HandleAsync(new ReplaceDatasetFixtureFromCsvCommand(doc, Guid.NewGuid(), id, 1, "a\nx"), new("viewer"))).Code);
            Assert.Equal("FORBIDDEN", (await handler.HandleAsync(new AddCsvDatasetCommand(doc, Guid.NewGuid(), Guid.NewGuid(), "x", "a\nx"), new("viewer"))).Code);
            Assert.Equal(before, JsonSerializer.Serialize(await journal.ReadAsync(doc)));
            Assert.Single((await journal.ReadHistoryAsync(doc, owner.Id)).Entries!);
        }
        finally { Directory.Delete(path, true); }
    }
}


