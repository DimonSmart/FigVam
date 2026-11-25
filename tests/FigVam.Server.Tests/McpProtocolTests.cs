using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace FigVam.Server.Tests;

[Collection(ProcessTestCollection.Name)]
public sealed class McpProtocolTests
{
    [Fact]
    public async Task OfficialClientEditsOnlyGrantedDocumentAndRevocationSurvivesReconnect()
    {
        using var key = RSA.Create(2048);
        var config = ServerTestIdentity.Production(key);
        var directory = Path.Combine(Path.GetTempPath(), "figvam-mcp-" + Guid.NewGuid().ToString("N"));
        config["Storage__Directory"] = directory;
        await using var server = new ServerProcess(config);
        await server.WaitUntilReadyAsync();
        using var user = server.CreateClient();
        user.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "owner"));
        var documentId = Guid.NewGuid();
        var foreignId = Guid.NewGuid();
        (await user.PostAsJsonAsync("/api/v1/documents", new { documentId, name = "MCP test" })).EnsureSuccessStatusCode();
        using var foreignOwner = server.CreateClient();
        foreignOwner.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "other-owner"));
        (await foreignOwner.PostAsJsonAsync("/api/v1/documents", new { documentId = foreignId, name = "Foreign document" })).EnsureSuccessStatusCode();
        var grantPath = $"/api/v1/documents/{documentId}/mcp-access";
        using var grant = await user.PostAsync(grantPath, null);
        grant.EnsureSuccessStatusCode();
        Assert.True(grant.Headers.CacheControl?.NoStore == true);
        var access = await grant.Content.ReadFromJsonAsync<JsonElement>();
        var token = access.GetProperty("token").GetString()!;
        var endpoint = new Uri(access.GetProperty("endpoint").GetString()!);
        await using var mcp = await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = endpoint,
            TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = "Bearer " + token }
        }));
        var tools = await mcp.ListToolsAsync();
        Assert.Equal(31, tools.Count);
        async Task<JsonElement> Call(string name, object? args = null, bool error = false)
        {
            var values = JsonSerializer.SerializeToElement(args ?? new { }).EnumerateObject()
                .ToDictionary(p => p.Name, p => (object?)p.Value);
            var result = await mcp.CallToolAsync(name, values);
            Assert.Equal(error, result.IsError == true);
            if (error)
            {
                using var errorText = JsonDocument.Parse(Assert.Single(result.Content.OfType<TextContentBlock>()).Text);
                Assert.Equal(result.StructuredContent!.Value.GetRawText(), errorText.RootElement.GetRawText());
            }
            return result.StructuredContent!.Value;
        }
        var doc = await Call("get_document");
        Assert.Equal(documentId, doc.GetProperty("documentId").GetGuid());
        var commandId = Guid.NewGuid();
        var page = await Call("create_page", new { commandId, name = "Login Prototype" });
        Assert.Equal(doc.GetProperty("revision").GetInt64() + 1, page.GetProperty("revision").GetInt64());
        Assert.Equal(page.GetRawText(), (await Call("create_page", new { commandId })).GetRawText());
        var pageId = page.GetProperty("pageId").GetGuid();
        Assert.Equal("Login Prototype", (await Call("list_pages")).GetProperty("items").EnumerateArray().Single(p => p.GetProperty("id").GetGuid() == pageId).GetProperty("name").GetString());
        await Call("rename_page", new { pageId, name = "Login" });
        var screenRevision = (await Call("get_document")).GetProperty("revision").GetInt64();
        var screenResult = await Call("create_screen", new { pageId, width = 800, height = 600, name = "Sign in" });
        Assert.Equal(screenRevision + 1, screenResult.GetProperty("revision").GetInt64());
        var screenId = screenResult.GetProperty("screenId").GetGuid();
        Assert.Equal("Sign in", (await Call("get_screen", new { screenId })).GetProperty("items")[0].GetProperty("name").GetString());
        await Call("rename_screen", new { screenId, name = "Login" });
        await Call("resize_screen", new { screenId, width = 810, height = 610 });
        // Discover the exact MCP input shape, then use it to create and edit a real shadow.
        var buttonSchema = (await Call("get_node_schema", new { kind = "Button" })).GetProperty("properties");
        var shadowSchema = buttonSchema.GetProperty("shadow").GetProperty("inputSchema");
        Assert.Equal("object", shadowSchema.GetProperty("type").GetString());
        Assert.False(shadowSchema.GetProperty("additionalProperties").GetBoolean());
        Assert.Equal(new[] { "blurRadius", "color", "offsetX", "offsetY", "spreadRadius" },
            shadowSchema.GetProperty("required").EnumerateArray().Select(p => p.GetString()!).Order(StringComparer.Ordinal).ToArray());
        var shadowProperties = shadowSchema.GetProperty("properties");
        Assert.Equal(5, shadowProperties.EnumerateObject().Count());
        Assert.Equal("number", shadowProperties.GetProperty("blurRadius").GetProperty("type").GetString());
        Assert.Equal(0, shadowProperties.GetProperty("blurRadius").GetProperty("minimum").GetDouble());
        Assert.Equal(256, shadowProperties.GetProperty("blurRadius").GetProperty("maximum").GetDouble());
        Assert.Equal("string", shadowProperties.GetProperty("color").GetProperty("type").GetString());
        Assert.Matches(shadowProperties.GetProperty("color").GetProperty("pattern").GetString()!, "#0F172A1C");
        Assert.DoesNotMatch(shadowProperties.GetProperty("color").GetProperty("pattern").GetString()!, "#xyz");
        var colorAlternatives = buttonSchema.GetProperty("backgroundColor").GetProperty("inputSchema").GetProperty("anyOf");
        Assert.Equal("string", colorAlternatives[0].GetProperty("type").GetString());
        Assert.True(colorAlternatives[1].GetProperty("properties").TryGetProperty("tokenId", out _));
        Assert.True(buttonSchema.GetProperty("textStyle").GetProperty("inputSchema").GetProperty("properties").TryGetProperty("styleId", out _));
        Assert.True(buttonSchema.GetProperty("typography").GetProperty("inputSchema").GetProperty("properties").TryGetProperty("tokenId", out _));
        var imageSchema = (await Call("get_node_schema", new { kind = "Image" })).GetProperty("properties");
        Assert.True(imageSchema.GetProperty("asset").GetProperty("inputSchema").GetProperty("properties").TryGetProperty("assetId", out _));
        foreach (var kind in new[] { "Frame", "Text", "TextInput" })
            Assert.All((await Call("get_node_schema", new { kind })).GetProperty("properties").EnumerateObject(),
                p => Assert.True(p.Value.TryGetProperty("inputSchema", out _), p.Name));

        var initialShadow = new { offsetX = 0, offsetY = 8, blurRadius = 24, spreadRadius = 0, color = "#0F172A1C" };
        var nodeId = (await Call("create_node", new { parentId = screenId, kind = "Button", name = "Primary action", properties = new
            { text = "Login", width = 120, height = 40, backgroundColor = "#2563EB", shadow = initialShadow } })).GetProperty("nodeId").GetGuid();
        var createdNode = (await Call("get_node", new { nodeId })).GetProperty("items")[0];
        Assert.Equal("Primary action", createdNode.GetProperty("name").GetString());
        var storedShadow = createdNode.GetProperty("properties").GetProperty("shadow");
        Assert.Equal(28, storedShadow.GetProperty("color").GetProperty("alpha").GetInt32());
        Assert.Equal(15, storedShadow.GetProperty("color").GetProperty("red").GetInt32());
        await Call("set_node_properties", new { nodeId, properties = new
            { shadow = new { offsetX = 0, offsetY = 3, blurRadius = 8, spreadRadius = 0, color = "#2563EB" } } });
        var colorTokenId = (await Call("create_token", new { name = "login.primary", type = "Color", light = "#2563EB", dark = "#60A5FA" })).GetProperty("tokenId").GetGuid();
        await Call("set_node_properties", new { nodeId, properties = new { backgroundColor = new { tokenId = colorTokenId } } });
        var storedProperties = (await Call("get_node", new { nodeId })).GetProperty("items")[0].GetProperty("properties");
        Assert.Equal(255, storedProperties.GetProperty("shadow").GetProperty("color").GetProperty("alpha").GetInt32());
        Assert.Equal(colorTokenId, storedProperties.GetProperty("backgroundColor").GetProperty("tokenId").GetGuid());
        await Call("rename_node", new { nodeId, name = "Login button" });
        var updateCommandId = Guid.NewGuid();
        var updated = await Call("set_node_properties", new { nodeId, commandId = updateCommandId, properties = new { text = "Sign in" } });
        var revision = updated.GetProperty("revision").GetInt64();
        await Call("set_node_properties", new { nodeId, expectedRevision = revision - 1, properties = new { text = "stale" } }, true);
        await Call("set_node_properties", new { nodeId, properties = new { text = "invalid", width = "bad" } }, true);
        foreach (var invalidShadow in new[]
        {
            """{"offsetX":0,"offsetY":8,"blur":24,"spreadRadius":0,"color":"#0F172A1C"}""",
            """{"offsetX":0,"offsetY":8,"blurRadius":24,"spreadRadius":0,"color":"#0F172A1C","type":"shadow"}""",
            """{"offsetX":0,"offsetY":8,"blurRadius":24,"spreadRadius":0,"color":{"red":15,"green":23,"blue":42,"alpha":28}}""",
            """{"offsetX":0,"offsetY":8,"blurRadius":24,"spreadRadius":0,"color":null}""",
            """{"offsetX":0,"offsetY":8,"blurRadius":"24","spreadRadius":0,"color":"#0F172A1C"}""",
            """{"offsetX":0,"offsetY":8,"blurRadius":24,"spreadRadius":0,"color":"#xyz"}""",
            """{"offsetX":0,"offsetY":8,"blurRadius":24,"spreadRadius":0,"color":"#0F172A1C","offsetX":0}"""
        })
        {
            var rejected = await Call("set_node_properties", new { nodeId, properties = new
                { text = "must not be written", shadow = JsonSerializer.Deserialize<JsonElement>(invalidShadow) } }, true);
            Assert.Equal("INVALID_PROPERTY_TYPE", rejected.GetProperty("code").GetString());
        }
        var outOfRange = await Call("set_node_properties", new { nodeId, properties = new
            { shadow = new { offsetX = 0, offsetY = 8, blurRadius = 257, spreadRadius = 0, color = "#0F172A1C" } } }, true);
        Assert.Equal("INVALID_PROPERTY_VALUE", outOfRange.GetProperty("code").GetString());
        var invalidReference = await Call("set_node_properties", new { nodeId, properties = new
            { backgroundColor = new { tokenId = colorTokenId, extra = true } } }, true);
        Assert.Equal("INVALID_PROPERTY_TYPE", invalidReference.GetProperty("code").GetString());
        Assert.Equal(revision, (await Call("get_document")).GetProperty("revision").GetInt64());
        void CheckDiagnostic(JsonElement error, string code, string path, string? actual, string? expectedPart = null)
        {
            Assert.Equal("REJECTED", error.GetProperty("status").GetString());
            Assert.Equal(code, error.GetProperty("code").GetString());
            Assert.Equal(path, error.GetProperty("property").GetString());
            Assert.Contains(path, error.GetProperty("message").GetString()!);
            Assert.False(string.IsNullOrWhiteSpace(error.GetProperty("expected").GetString()));
            if (expectedPart is not null) Assert.Contains(expectedPart, error.GetProperty("expected").GetString()!);
            if (actual is not null) Assert.Equal(actual, error.GetProperty("actual").GetString());
            else Assert.False(error.TryGetProperty("actual", out _));
            Assert.True(error.TryGetProperty("commandId", out _));
        }

        // All failures are checked through the official MCP client, not only the adapter.
        foreach (var (kind, json, code, path, actual, expected) in new (string, string, string, string, string?, string?)[]
        {
            ("Button", """{"fontSize":"large"}""", "INVALID_PROPERTY_TYPE", "fontSize", "String", "Number"),
            ("Button", """{"text":123}""", "INVALID_PROPERTY_TYPE", "text", "Number", "String"),
            ("Button", """{"visible":"true"}""", "INVALID_PROPERTY_TYPE", "visible", "String", "Boolean"),
            ("Button", """{"backgroundColor":"blue"}""", "INVALID_PROPERTY_TYPE", "backgroundColor", "Invalid color format", "#RRGGBB"),
            ("TextInput", """{"inputType":"Email"}""", "INVALID_PROPERTY_VALUE", "inputType", "Unsupported enum value", "Text, Password"),
            ("Button", """{"opacity":1.5}""", "INVALID_PROPERTY_VALUE", "opacity", "1.5", "0 and 1"),
            ("Text", """{"inputType":"Password"}""", "UNSUPPORTED_PROPERTY", "inputType", null, "Text"),
            ("Button", """{"shadow":{"offsetX":0,"offsetY":8,"spreadRadius":0,"color":"#0F172A20"}}""", "INVALID_PROPERTY_TYPE", "shadow.blurRadius", "Missing", "Number"),
            ("Button", """{"shadow":{"offsetX":0,"offsetY":8,"blur":24,"spreadRadius":0,"color":"#0F172A20"}}""", "INVALID_PROPERTY_TYPE", "shadow.blur", "Unknown property", null),
            ("Button", """{"shadow":{"offsetX":"bad","offsetY":8,"blurRadius":24,"spreadRadius":0,"color":"#0F172A20"}}""", "INVALID_PROPERTY_TYPE", "shadow.offsetX", "String", "Number"),
            ("Button", """{"shadow":{"offsetX":0,"offsetY":8,"blurRadius":24,"spreadRadius":0,"color":"bad"}}""", "INVALID_PROPERTY_TYPE", "shadow.color", "Invalid color format", "#RRGGBB"),
            ("Button", """{"shadow":{"offsetX":0,"offsetY":8,"blurRadius":-1,"spreadRadius":0,"color":"#0F172A20"}}""", "INVALID_PROPERTY_VALUE", "shadow.blurRadius", "-1", "0 and 256"),
            ("Button", """{"backgroundColor":{"tokenId":"not-a-guid"}}""", "INVALID_PROPERTY_TYPE", "backgroundColor.tokenId", "Invalid GUID format", "GUID"),
            ("Image", """{"asset":{"assetId":"not-a-guid"}}""", "INVALID_PROPERTY_TYPE", "asset.assetId", "Invalid GUID format", "GUID"),
            ("Button", """{"textStyle":{"styleId":"not-a-guid"}}""", "INVALID_PROPERTY_TYPE", "textStyle.styleId", "Invalid GUID format", "GUID"),
            ("Button", """{"shadow":null}""", "INVALID_PROPERTY_TYPE", "shadow", "Null", "Object"),
            ("Button", """{"backgroundColor":123}""", "INVALID_PROPERTY_TYPE", "backgroundColor", "Number", "tokenId"),
            ("Button", """{"fontWeight":400.5}""", "INVALID_PROPERTY_VALUE", "fontWeight", "400.5", "Integer")
        })
        {
            var properties = JsonSerializer.Deserialize<JsonElement>(json);
            var rejected = await Call("create_node", new { parentId = screenId, kind, properties }, true);
            CheckDiagnostic(rejected, code, path, actual, expected);
        }
        CheckDiagnostic(await Call("set_node_properties", new { nodeId, properties = new { text = "must not be written", opacity = 2 } }, true),
            "INVALID_PROPERTY_VALUE", "opacity", "2", "0 and 1");
        Assert.Equal("Sign in", (await Call("get_node", new { nodeId })).GetProperty("items")[0].GetProperty("properties").GetProperty("text").GetProperty("value").GetString());
        CheckDiagnostic(await Call("create_token", new { name = "bad.color", type = "Color", light = "#FFFFFF", dark = "secret-value" }, true),
            "INVALID_TOKEN", "dark", "Invalid color format", "#RRGGBB");
        var badTypography = new { fontFamily = "Arial", fontSize = "large", fontWeight = 400, lineHeight = 1.2 };
        CheckDiagnostic(await Call("create_token", new { name = "bad.typography", type = "Typography", light = badTypography, dark = badTypography }, true),
            "INVALID_TOKEN", "light.fontSize", "String", "Number");
        CheckDiagnostic(await Call("set_token_value", new { tokenId = colorTokenId, theme = "Light", value = new { tokenId = "bad" } }, true),
            "INVALID_TOKEN", "value.tokenId", "Invalid GUID format", "GUID");
        var missingId = Guid.NewGuid();
        var failedNodeId = Guid.NewGuid();
        var rejectedCommandId = Guid.NewGuid();
        var missingReferenceArguments = new { parentId = screenId, kind = "Button", nodeId = failedNodeId,
            commandId = rejectedCommandId, properties = new { backgroundColor = new { tokenId = missingId } } };
        var missingReference = await Call("create_node", missingReferenceArguments, true);
        CheckDiagnostic(missingReference, "TOKEN_NOT_FOUND", "backgroundColor.tokenId", "Missing token", "Existing compatible token");
        Assert.Equal(missingReference.GetRawText(), (await Call("create_node", missingReferenceArguments, true)).GetRawText());
        await Call("get_node", new { nodeId = failedNodeId }, true);
        CheckDiagnostic(await Call("set_node_properties", new { nodeId, properties = new { fontSize = new { tokenId = colorTokenId } } }, true),
            "INVALID_PROPERTY_VALUE", "fontSize.tokenId", "Incompatible token", "Existing compatible token");
        CheckDiagnostic(await Call("create_token", new { name = "bad.alias", type = "Color",
            light = new { tokenId = missingId }, dark = "#FFFFFF" }, true),
            "INVALID_TOKEN", "light.tokenId", "Missing token", "Existing token");
        CheckDiagnostic(await Call("set_token_value", new { tokenId = colorTokenId, theme = "Dark", value = new { tokenId = missingId } }, true),
            "INVALID_TOKEN", "value.tokenId", "Missing token", "Existing token");
        var invalidTypography = new { fontFamily = "Arial", fontSize = -1, fontWeight = 400, lineHeight = 1.2 };
        CheckDiagnostic(await Call("create_token", new { name = "bad.typography.range", type = "Typography",
            light = invalidTypography, dark = invalidTypography }, true),
            "INVALID_TOKEN", "light.fontSize", "-1", "greater than 0");
        CheckDiagnostic(await Call("create_token", new { name = "bad.opacity", type = "Number", category = "Opacity",
            light = 0.5, dark = 1.5 }, true),
            "INVALID_TOKEN", "dark", "1.5", "0 and 1");
        var secret = new string('s', 5200);
        var longText = await Call("set_node_properties", new { nodeId, properties = new { text = secret } }, true);
        CheckDiagnostic(longText, "INVALID_PROPERTY_VALUE", "text", "String with length 5200", "4096");
        Assert.DoesNotContain(secret, longText.GetRawText());
        Assert.Equal(revision, (await Call("get_document")).GetProperty("revision").GetInt64());
        await Call("remove_node_properties", new { nodeId, properties = new[] { "backgroundColor" }, expectedRevision = revision });
        await Call("set_node_properties", new { nodeId, properties = new { fontWeight = 400 } });
        await Call("set_node_properties", new { nodeId, properties = new { fontWeight = "Bold" } });
        var typography = new { fontFamily = "Arial", fontSize = 16, fontWeight = 400, lineHeight = 1.2 };
        var typographyId = (await Call("create_token", new { name = "login.typography", type = "Typography",
            light = typography, dark = typography })).GetProperty("tokenId").GetGuid();
        var beforeInvalidTypography = (await Call("get_document")).GetProperty("revision").GetInt64();
        CheckDiagnostic(await Call("set_token_value", new { tokenId = typographyId, theme = "Dark", value = invalidTypography }, true),
            "INVALID_TOKEN", "value.fontSize", "-1", "greater than 0");
        Assert.Equal(beforeInvalidTypography, (await Call("get_document")).GetProperty("revision").GetInt64());
        var tokenId = (await Call("create_token", new { name = "spacing.dialog", type = "Spacing", light = 32, dark = 32 })).GetProperty("tokenId").GetGuid();
        await Call("set_token_value", new { tokenId, theme = "Dark", value = 24 });
        var duplicateRevision = (await Call("get_document")).GetProperty("revision").GetInt64();
        var invalidPage = await Call("create_page", new { name = " " }, true);
        Assert.Equal("INVALID_PAGE", invalidPage.GetProperty("code").GetString());
        var invalidScreen = await Call("create_screen", new { pageId, width = 800, height = 600, name = "" }, true);
        Assert.Equal("INVALID_SCREEN_NAME", invalidScreen.GetProperty("code").GetString());
        var invalidNode = await Call("create_node", new { parentId = screenId, kind = "Button", name = new string('x', 257), properties = new { text = "Never created" } }, true);
        Assert.Equal("INVALID_NODE_METADATA", invalidNode.GetProperty("code").GetString());
        var invalidDuplicate = await Call("duplicate_screen", new { screenId, expectedRevision = duplicateRevision, name = " " }, true);
        Assert.Equal("INVALID_SCREEN_NAME", invalidDuplicate.GetProperty("code").GetString());
        Assert.Equal(duplicateRevision, (await Call("get_document")).GetProperty("revision").GetInt64());
        var duplicate = await Call("duplicate_screen", new { screenId, expectedRevision = duplicateRevision, name = "Login Error" });
        Assert.Equal(duplicateRevision + 1, duplicate.GetProperty("revision").GetInt64());
        var target = duplicate.GetProperty("screenId").GetGuid();
        Assert.Equal("Login Error", (await Call("get_screen", new { screenId = target })).GetProperty("items")[0].GetProperty("name").GetString());
        var actions = new[] { new { type = "navigate", screenId = target } };
        var scenario = await Call("create_scenario", new { screenId, nodeId, @event = "Click", actions });
        var scenarioId = scenario.GetProperty("scenarioId").GetGuid();
        var updatedScenario = await Call("update_scenario", new { scenarioId, screenId, nodeId, @event = "Click", actions, expectedRevision = scenario.GetProperty("revision").GetInt64() });
        await Call("list_scenarios", new { screenId });
        await Call("delete_scenario", new { scenarioId, expectedRevision = updatedScenario.GetProperty("revision").GetInt64() });
        await Call("list_pages");
        await Call("list_screens", new { pageId });
        await Call("get_screen", new { screenId });
        await Call("get_node", new { nodeId });
        await Call("list_children", new { parentId = screenId });
        await Call("get_screen_tree", new { screenId });
        await Call("list_node_types");
        await Call("get_node_schema", new { kind = "Button" });
        await Call("list_tokens");
        await Call("get_screen_layout", new { screenId });
        await Call("move_node", new { nodeId, expectedParentId = screenId, targetParentId = screenId, position = 0 });
        await Call("delete_node", new { nodeId });
        Assert.Equal(updated.GetRawText(), (await Call("set_node_properties", new { nodeId, commandId = updateCommandId, properties = new { text = "Sign in" } })).GetRawText());
        await Call("save_version", new { name = "MCP milestone" });

        using var foreignGrant = await foreignOwner.PostAsync($"/api/v1/documents/{foreignId}/mcp-access", null);
        foreignGrant.EnsureSuccessStatusCode();
        var foreignToken = (await foreignGrant.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        await using var other = await McpClient.CreateAsync(new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = endpoint, TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = "Bearer " + foreignToken }
        }));
        async Task<JsonElement> ForeignCall(string name, object? args = null)
        {
            var values = JsonSerializer.SerializeToElement(args ?? new { }).EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value);
            var result = await other.CallToolAsync(name, values);
            Assert.False(result.IsError == true);
            return result.StructuredContent!.Value;
        }
        var foreignPage = (await ForeignCall("create_page")).GetProperty("pageId").GetGuid();
        var foreignScreen = (await ForeignCall("create_screen", new { pageId = foreignPage, width = 800, height = 600 })).GetProperty("screenId").GetGuid();
        var foreignNode = (await ForeignCall("create_node", new { parentId = foreignScreen, kind = "Frame" })).GetProperty("nodeId").GetGuid();
        var foreignDesignToken = (await ForeignCall("create_token", new { name = "other.spacing", type = "Spacing", light = 8, dark = 8 })).GetProperty("tokenId").GetGuid();
        await Call("get_screen", new { screenId = foreignScreen }, true);
        await Call("get_node", new { nodeId = foreignNode }, true);
        await Call("delete_node", new { nodeId = foreignNode }, true);
        await Call("create_node", new { parentId = screenId, kind = "Frame", properties = new { paddingRight = new { tokenId = foreignDesignToken } } }, true);
        await Call("set_token_value", new { tokenId = foreignDesignToken, theme = "Light", value = 10 }, true);
        (await foreignOwner.DeleteAsync(grantPath)).EnsureSuccessStatusCode();
        Assert.Equal(documentId, (await Call("get_document")).GetProperty("documentId").GetGuid());

        // The real UI transport can edit the same document while the MCP connection is open.
        var root = $"/api/v1/documents/{documentId}";
        (await user.PostAsJsonAsync(root + "/commands/rename-screen", new { commandId = Guid.NewGuid(), screenId, name = "Changed by UI" })).EnsureSuccessStatusCode();
        Assert.Equal("Changed by UI", (await Call("get_screen", new { screenId })).GetProperty("items")[0].GetProperty("name").GetString());
        var history = await user.GetFromJsonAsync<JsonElement>(root + "/reconnect?lastSeenRevision=0");
        var events = history.GetProperty("events").EnumerateArray().ToArray();
        Assert.Contains(events, e => e.GetProperty("source").GetString() == "MCP" && e.GetProperty("actorId").GetString() == "owner");
        Assert.Contains(events, e => e.GetProperty("source").GetString() == "UI" && e.GetProperty("type").GetString() == "RENAME_SCREEN");

        // REST uses the same atomic creation contract, visible immediately through MCP.
        var restPageId = Guid.NewGuid();
        var restScreenId = Guid.NewGuid();
        var restNodeId = Guid.NewGuid();
        var restCopyId = Guid.NewGuid();
        (await user.PostAsJsonAsync(root + "/commands/add-page", new { commandId = Guid.NewGuid(), pageId = restPageId, name = "REST page" })).EnsureSuccessStatusCode();
        (await user.PostAsJsonAsync(root + "/commands/add-screen", new { commandId = Guid.NewGuid(), pageId = restPageId, screenId = restScreenId, dimensions = new { width = 800, height = 600 }, name = "REST screen" })).EnsureSuccessStatusCode();
        (await user.PostAsJsonAsync(root + "/commands/add-node", new { commandId = Guid.NewGuid(), parentId = restScreenId, nodeId = restNodeId, kind = "Frame", name = "REST frame" })).EnsureSuccessStatusCode();
        var restRevision = (await Call("get_document")).GetProperty("revision").GetInt64();
        (await user.PostAsJsonAsync(root + "/commands/duplicate-screen", new { commandId = Guid.NewGuid(), screenId = restScreenId, newScreenId = restCopyId, expectedRevision = restRevision, name = "REST copy" })).EnsureSuccessStatusCode();
        Assert.Equal("REST page", (await Call("list_pages")).GetProperty("items").EnumerateArray().Single(p => p.GetProperty("id").GetGuid() == restPageId).GetProperty("name").GetString());
        Assert.Equal("REST screen", (await Call("get_screen", new { screenId = restScreenId })).GetProperty("items")[0].GetProperty("name").GetString());
        Assert.Equal("REST frame", (await Call("get_node", new { nodeId = restNodeId })).GetProperty("items")[0].GetProperty("name").GetString());
        Assert.Equal("REST copy", (await Call("get_screen", new { screenId = restCopyId })).GetProperty("items")[0].GetProperty("name").GetString());

        var foreignRevision = (await ForeignCall("get_document")).GetProperty("revision").GetInt64();
        (await foreignOwner.PostAsJsonAsync($"/api/v1/documents/{foreignId}/commands/delete-document", new { commandId = Guid.NewGuid(), expectedRevision = foreignRevision })).EnsureSuccessStatusCode();
        using var deletedDocumentAccess = server.CreateClient();
        deletedDocumentAccess.DefaultRequestHeaders.Authorization = new("Bearer", foreignToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await deletedDocumentAccess.GetAsync("/mcp")).StatusCode);
        await Call("list_screens", new { pageId = foreignPage }, true);
        await Call("create_screen", new { pageId = foreignPage, width = 800, height = 600 }, true);
        using var editor = server.CreateClient();
        editor.DefaultRequestHeaders.Authorization = new("Bearer", ServerTestIdentity.Token(key, subject: "editor"));
        var members = $"/api/v1/documents/{documentId}/members";
        (await user.PutAsJsonAsync(members, new { memberId = "editor", role = "Viewer" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsync(grantPath, null)).StatusCode);
        (await user.PutAsJsonAsync(members, new { memberId = "editor", role = "Editor" })).EnsureSuccessStatusCode();
        using var editorGrant = await editor.PostAsync(grantPath, null);
        editorGrant.EnsureSuccessStatusCode();
        var editorToken = (await editorGrant.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString()!;
        (await user.PutAsJsonAsync(members, new { memberId = "editor", role = "Viewer" })).EnsureSuccessStatusCode();
        (await user.PutAsJsonAsync(members, new { memberId = "editor", role = "Editor" })).EnsureSuccessStatusCode();
        using var lostRights = server.CreateClient();
        lostRights.DefaultRequestHeaders.Authorization = new("Bearer", editorToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await lostRights.GetAsync("/mcp")).StatusCode);

        using var unauthorized = server.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync("/mcp")).StatusCode);
        unauthorized.DefaultRequestHeaders.Authorization = new("Bearer", "fvm_invalid");
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync("/mcp")).StatusCode);
        unauthorized.DefaultRequestHeaders.Authorization = new("Bearer", token);
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync(grantPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.PostAsync(grantPath, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync("/api/v1/documents")).StatusCode);
        using var wrongOrigin = new HttpRequestMessage(HttpMethod.Get, "/mcp");
        wrongOrigin.Headers.Add("Origin", "https://untrusted.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await unauthorized.SendAsync(wrongOrigin)).StatusCode);
        (await user.DeleteAsync(grantPath)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await unauthorized.GetAsync("/mcp")).StatusCode);
        var disabled = await user.GetFromJsonAsync<JsonElement>(grantPath);
        Assert.False(disabled.GetProperty("enabled").GetBoolean());
        Assert.False(server.LogContains(token), "MCP secret appeared in server logs.");
        foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories))
            Assert.False(System.Text.Encoding.UTF8.GetString(await File.ReadAllBytesAsync(file)).Contains(token, StringComparison.Ordinal), "MCP secret persisted on disk.");
    }
}
