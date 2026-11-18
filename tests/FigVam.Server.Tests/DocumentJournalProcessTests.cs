using System.Diagnostics;
using System.Text.Json;
using FigVam.Application.Documents;
using FigVam.Domain.Documents;
using FigVam.Infrastructure.Documents;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class DocumentJournalProcessTests
{
    private sealed class Profile : INodeProfile
    {
        public PortableUiProfileReference Identity => PortableUiProfileReference.Production;
        public bool SupportsPreviewEvent(string kind, FigVam.Domain.Preview.PreviewEvent @event) => false;
        public bool SupportsPreviewAction(FigVam.Domain.Preview.PreviewAction action) => false;
        public bool SupportsDemoValue(string kind) => false;
        public NodePropertyDefinition? GetProperty(string kind, string property) => null;
        public bool IsKnownKind(string kind) => false;
        public bool CanContainChildren(string kind) => false;
    }
    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public async Task ConfirmedResultSurvivesAbruptServerProcessExit(bool restoreVersion, bool compensate)
    {
        var directory = Path.Combine(Path.GetTempPath(), "figvam-process-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        try
        {
            var command = new AddPageCommand(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
            var start = new ProcessStartInfo("dotnet")
            {
                UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true,
                CreateNoWindow = true
            };
            start.ArgumentList.Add("vstest");
            start.ArgumentList.Add(typeof(DocumentJournalProcessTests).Assembly.Location);
            start.ArgumentList.Add("--TestCaseFilter:FullyQualifiedName=FigVam.Server.Tests.DocumentJournalProcessTests.CrashWriter");
            start.Environment["FIGVAM_CRASH_TEST_DIRECTORY"] = directory;
            start.Environment["FIGVAM_CRASH_TEST_COMMAND"] = JsonSerializer.Serialize(command);
            start.Environment["FIGVAM_CRASH_TEST_RESTORE"] = restoreVersion.ToString();
            start.Environment["FIGVAM_CRASH_TEST_UNDO"] = compensate.ToString();
            using var process = Process.Start(start)!;
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            try { await process.WaitForExitAsync(timeout.Token); }
            catch
            {
                if (!process.HasExited) process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync();
                await Task.WhenAll(output, error);
                throw;
            }
            Assert.NotEqual(0, process.ExitCode);
            Assert.True(File.Exists(Path.Combine(directory, "committed.json")), await output + await error);
            var expected = JsonSerializer.Deserialize<CommandResult>(
                await File.ReadAllTextAsync(Path.Combine(directory, "committed.json")));
            var restarted = new SqliteDocumentJournal(directory, new Profile());
            Assert.True(await restarted.CanEditAsync(new("server-actor"), command.DocumentId, default));
            Assert.True(await restarted.CanReadAsync(new("persisted-viewer"), command.DocumentId, default));
            Assert.False(await restarted.CanEditAsync(new("persisted-viewer"), command.DocumentId, default));
            var recovered = await restarted.ReadAsync(command.DocumentId);
            Assert.Equal((restoreVersion ? 4 : 1) + (compensate ? 1 : 0), recovered!.Revision);
            Assert.Equal(compensate ? (restoreVersion ? 2 : 0) : 1, recovered.Document.Pages.Count);
            if (!compensate) Assert.Equal(command.PageId, Assert.Single(recovered.Document.Pages).Id);
            var handler = new DocumentCommandHandler(restarted, restarted, new Profile());
            var retry = compensate
                ? await handler.HandleAsync(JsonSerializer.Deserialize<UndoDocumentCommand>(
                    await File.ReadAllTextAsync(Path.Combine(directory, "undo-command.json")))!, new("server-actor"))
                : restoreVersion
                ? await handler.HandleAsync(JsonSerializer.Deserialize<RestoreDocumentVersionCommand>(
                    await File.ReadAllTextAsync(Path.Combine(directory, "restore-command.json")))!, new("server-actor"))
                : await handler.HandleAsync(command, new("server-actor"));
            Assert.Equal(expected, retry);
            if (compensate)
            {
                Assert.Contains((await restarted.ReadHistoryAsync(command.DocumentId, "server-actor")).Entries!, e => e.Status == "UNDONE");
                Assert.True((await handler.HandleAsync(new RedoDocumentCommand(command.DocumentId, Guid.NewGuid()), new("server-actor"))).Accepted);
                Assert.Equal(command.PageId, Assert.Single((await restarted.ReadAsync(command.DocumentId))!.Document.Pages).Id);
            }
        }
        finally { Directory.Delete(directory, recursive: true); }
    }

    [Fact]
    public async Task CrashWriter()
    {
        var directory = Environment.GetEnvironmentVariable("FIGVAM_CRASH_TEST_DIRECTORY");
        if (directory is null) return;
        var command = JsonSerializer.Deserialize<AddPageCommand>(
            Environment.GetEnvironmentVariable("FIGVAM_CRASH_TEST_COMMAND")!)!;
        var journal = new SqliteDocumentJournal(directory, new Profile());
        Assert.True((await journal.CreateAsync(new(command.DocumentId), new("server-actor"))).Accepted);
        await journal.SetMemberAsync(command.DocumentId, "persisted-viewer", DocumentRole.Viewer, new("server-actor"));
        var result = await new DocumentCommandHandler(journal, journal, new Profile())
            .HandleAsync(command, new("server-actor"));
        if (Environment.GetEnvironmentVariable("FIGVAM_CRASH_TEST_RESTORE") == bool.TrueString)
        {
            var handler = new DocumentCommandHandler(journal, journal, new Profile());
            var saved = await handler.HandleAsync(new SaveDocumentCommand(command.DocumentId, Guid.NewGuid()), new("server-actor"));
            await handler.HandleAsync(new AddPageCommand(command.DocumentId, Guid.NewGuid(), Guid.NewGuid()), new("server-actor"));
            var restore = new RestoreDocumentVersionCommand(command.DocumentId, Guid.NewGuid(), saved.VersionId!.Value);
            result = await handler.HandleAsync(restore, new("server-actor"));
            await File.WriteAllTextAsync(Path.Combine(directory, "restore-command.json"), JsonSerializer.Serialize(restore));
        }
        if (Environment.GetEnvironmentVariable("FIGVAM_CRASH_TEST_UNDO") == bool.TrueString)
        {
            var undo = new UndoDocumentCommand(command.DocumentId, Guid.NewGuid());
            result = await new DocumentCommandHandler(journal, journal, new Profile()).HandleAsync(undo, new("server-actor"));
            await File.WriteAllTextAsync(Path.Combine(directory, "undo-command.json"), JsonSerializer.Serialize(undo));
        }
        await File.WriteAllTextAsync(Path.Combine(directory, "committed.json"), JsonSerializer.Serialize(result));
        // Terminate without disposal or test completion; the parent retries with no process state.
        Environment.Exit(23);
    }
}
