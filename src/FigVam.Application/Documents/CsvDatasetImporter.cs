using System.Text;
using System.Text.Json;
using FigVam.Domain.Documents;

namespace FigVam.Application.Documents;

internal static class CsvDatasetImporter
{
    internal const int MaxInputBytes = DatasetValidator.MaxFixtureBytes;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    internal static bool TryConvert(string? csv, out string json)
    {
        json = "";
        if (string.IsNullOrEmpty(csv) || csv.Length > MaxInputBytes || csv[0] == '\uFEFF') return false;
        try { if (StrictUtf8.GetByteCount(csv) > MaxInputBytes) return false; }
        catch (EncoderFallbackException) { return false; }

        var rows = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        var closed = false;
        var start = true;
        for (var i = 0; i < csv.Length; i++)
        {
            var c = csv[i];
            if (quoted)
            {
                if (c == '"')
                {
                    if (i + 1 < csv.Length && csv[i + 1] == '"') { field.Append('"'); i++; }
                    else { quoted = false; closed = true; }
                }
                else if (c == '\r')
                {
                    if (i + 1 >= csv.Length || csv[i + 1] != '\n') return false;
                    field.Append("\r\n"); i++;
                }
                else { if (char.IsControl(c) && c != '\n' && c != '\t') return false; field.Append(c); }
                continue;
            }
            if (c == '"')
            {
                if (!start || closed) return false;
                quoted = true; start = false; continue;
            }
            if (c == ',' || c == '\n' || c == '\r')
            {
                if (c == '\r' && (i + 1 >= csv.Length || csv[++i] != '\n')) return false;
                row.Add(field.ToString()); field.Clear(); start = true; closed = false;
                if (c != ',') { rows.Add(row); row = []; }
                continue;
            }
            if (closed || (char.IsControl(c) && c != '\t')) return false;
            field.Append(c); start = false;
        }
        if (quoted) return false;
        if (row.Count > 0 || field.Length > 0 || !start || closed) { row.Add(field.ToString()); rows.Add(row); }
        if (rows.Count == 0) return false;
        var headers = rows[0];
        if (headers.Any(string.IsNullOrWhiteSpace) || headers.Distinct(StringComparer.Ordinal).Count() != headers.Count) return false;
        if (rows.Skip(1).Any(r => r.Count != headers.Count)) return false;
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartArray();
            foreach (var values in rows.Skip(1))
            {
                writer.WriteStartObject();
                for (var i = 0; i < headers.Count; i++)
                {
                    writer.WriteString(headers[i], values[i]);
                    writer.Flush();
                    if (stream.Length > DatasetValidator.MaxFixtureBytes) return false;
                }
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
        }
        if (stream.Length > DatasetValidator.MaxFixtureBytes) return false;
        json = Encoding.UTF8.GetString(stream.ToArray());
        return true;
    }
}
