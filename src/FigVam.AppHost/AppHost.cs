var builder = DistributedApplication.CreateBuilder(args);
var storageDirectory = Path.GetFullPath(builder.Configuration["Storage:Directory"] ??
    Path.Combine(builder.AppHostDirectory, "..", "FigVam.Server", "data", "documents"));
builder.AddProject<Projects.FigVam_Server>("server")
    .WithEnvironment("Storage__Directory", storageDirectory);
builder.Build().Run();
