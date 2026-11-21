using System.Globalization;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Authentication;

public sealed record FigVamUser(string Id, string Email, string? Name, bool Enabled, bool IsAdmin,
    bool IsBound, string CreatedUtc, string? LastLoginUtc);

/// <summary>Independent allowlist and revocable browser sessions. Document membership remains in the document journal.</summary>
public sealed class FigVamUserStore
{
    private readonly string connectionString;

    public FigVamUserStore(string directory)
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "figvam-users.sqlite");
        connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = true
        }.ToString();
        using var db = Open();
        Sql(db, null, @"CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
            name TEXT, enabled INTEGER NOT NULL, is_admin INTEGER NOT NULL,
            created_utc TEXT NOT NULL, last_login_utc TEXT);
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
                expires_utc TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        Sql(connection, null, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON").ExecuteNonQuery();
        return connection;
    }

    private static SqliteCommand Sql(SqliteConnection db, SqliteTransaction? tx, string statement, params (string Name, object? Value)[] args)
    {
        var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = statement;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        return cmd;
    }

    private static FigVamUser Read(SqliteDataReader r) => new(
        r.GetString(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2),
        r.GetInt64(3) != 0, r.GetInt64(4) != 0, r.GetInt64(5) != 0,
        r.GetString(6), r.IsDBNull(7) ? null : r.GetString(7));

    private const string Fields = @"SELECT id,email,name,enabled,is_admin,
        CASE WHEN google_sub IS NULL THEN 0 ELSE 1 END,created_utc,last_login_utc FROM users";

    private static string NormalizeEmail(string email)
    {
        var normalized = email.Trim().ToLowerInvariant();
        if (normalized.Length is < 3 or > 254 || normalized.Any(char.IsControl) ||
            !System.Net.Mail.MailAddress.TryCreate(normalized, out var parsed) ||
            !string.Equals(parsed.Address, normalized, StringComparison.Ordinal))
            throw new ArgumentException("Invalid email address.", nameof(email));
        return normalized;
    }

    public IReadOnlyList<FigVamUser> List(bool enabledOnly = false)
    {
        using var db = Open();
        using var cmd = Sql(db, null, Fields + (enabledOnly ? " WHERE enabled=1 AND google_sub IS NOT NULL" : "") + " ORDER BY email ");
        using var reader = cmd.ExecuteReader();
        var users = new List<FigVamUser>();
        while (reader.Read()) users.Add(Read(reader));
        return users;
    }

    public FigVamUser Invite(string email)
    {
        email = NormalizeEmail(email);
        using var db = Open();
        using var tx = db.BeginTransaction(deferred: false);
        var id = "google:" + Guid.NewGuid().ToString("N");
        Sql(db, tx, @"INSERT INTO users(id,email,enabled,is_admin,created_utc)
            VALUES($id,$email,1,0,$now)", ("$id", id), ("$email", email),
            ("$now", DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture))).ExecuteNonQuery();
        tx.Commit();
        return List().Single(u => u.Id == id);
    }

    public bool Update(string id, bool enabled, bool admin)
    {
        using var db = Open();
        using var tx = db.BeginTransaction(deferred: false);
        using var existing = Sql(db, tx, "SELECT enabled,is_admin FROM users WHERE id=$id", ("$id", id)).ExecuteReader();
        if (!existing.Read()) return false;
        var wasAdmin = existing.GetInt64(0) != 0 && existing.GetInt64(1) != 0;
        existing.Close();
        if (wasAdmin && (!enabled || !admin))
        {
            var admins = (long)Sql(db, tx, "SELECT COUNT(*) FROM users WHERE enabled=1 AND is_admin=1").ExecuteScalar()!;
            if (admins <= 1) throw new InvalidOperationException("Cannot disable or demote the last enabled administrator.");
        }
        Sql(db, tx, "UPDATE users SET enabled=$enabled,is_admin=$admin WHERE id=$id",
            ("$enabled", enabled ? 1 : 0), ("$admin", admin ? 1 : 0), ("$id", id)).ExecuteNonQuery();
        if (!enabled)
            Sql(db, tx, "DELETE FROM sessions WHERE user_id=$id", ("$id", id)).ExecuteNonQuery();
        tx.Commit();
        return true;
    }

    public string? ResolveMember(string value, bool includeDisabled = false)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 256) return null;
        using var db = Open();
        using var cmd = Sql(db, null,
            "SELECT id FROM users WHERE (id=$value OR email=$value COLLATE NOCASE) AND google_sub IS NOT NULL",
            ("$value", value.Trim()));
        return cmd.ExecuteScalar() as string;
    }

    public bool IsAdmin(string id)
    {
        using var db = Open();
        return (long)Sql(db, null, "SELECT EXISTS(SELECT 1 FROM users WHERE id=$id AND enabled=1 AND is_admin=1)",
            ("$id", id)).ExecuteScalar()! == 1;
    }

    public bool IsActiveSession(string userId, string sessionId)
    {
        if (string.IsNullOrEmpty(userId) || string.IsNullOrEmpty(sessionId)) return false;
        using var db = Open();
        return (long)Sql(db, null, @"SELECT EXISTS(SELECT 1 FROM sessions s
            JOIN users u ON u.id=s.user_id WHERE s.id=$session AND s.user_id=$user
            AND u.enabled=1 AND s.expires_utc>$now)", ("$session", sessionId),
            ("$user", userId), ("$now", DateTimeOffset.UtcNow.ToString("O"))).ExecuteScalar()! == 1;
    }

    public void RevokeSession(string sessionId)
    {
        if (string.IsNullOrWhiteSpace(sessionId)) return;
        using var db = Open();
        Sql(db, null, "DELETE FROM sessions WHERE id=$id", ("$id", sessionId)).ExecuteNonQuery();
    }

    public (FigVamUser User, string SessionId)? AcceptVerifiedGoogleIdentity(string googleSub, string email,
        string? displayName, string bootstrapEmail)
    {
        if (string.IsNullOrWhiteSpace(googleSub) || googleSub.Length > 256) return null;
        email = NormalizeEmail(email);
        using var db = Open();
        using var tx = db.BeginTransaction(deferred: false);

        string? id = null;
        string? boundSubject = null;
        using (var cmd = Sql(db, tx, "SELECT id,google_sub FROM users WHERE google_sub=$sub OR email=$email COLLATE NOCASE",
            ("$sub", googleSub), ("$email", email)))
        using (var reader = cmd.ExecuteReader())
        {
            while (reader.Read())
            {
                var candidateSubject = reader.IsDBNull(1) ? null : reader.GetString(1);
                if (candidateSubject == googleSub)
                {
                    if (id is not null && boundSubject != googleSub) return null;
                    id = reader.GetString(0);
                    boundSubject = googleSub;
                }
                else if (id is null && candidateSubject is null)
                    id = reader.GetString(0);
                else
                    return null; // Never rebind an already claimed email or merge two identities.
            }
        }

        var initialized = (long)Sql(db, tx, "SELECT EXISTS(SELECT 1 FROM settings WHERE key='bootstrap_completed')").ExecuteScalar()! != 0;
        if (id is null)
        {
            if (initialized || !string.Equals(email, bootstrapEmail, StringComparison.OrdinalIgnoreCase)) return null;
            id = "google:" + Guid.NewGuid().ToString("N");
            Sql(db, tx, @"INSERT INTO users(id,email,enabled,is_admin,created_utc)
                VALUES($id,$email,1,1,$now)", ("$id", id), ("$email", email),
                ("$now", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
        }

        var record = (long)Sql(db, tx, "SELECT enabled FROM users WHERE id=$id", ("$id", id)).ExecuteScalar()!;
        if (record == 0) return null;
        if (boundSubject is not null && boundSubject != googleSub) return null;
        Sql(db, tx, @"UPDATE users SET google_sub=$sub,email=$email,name=$name,last_login_utc=$now
            WHERE id=$id AND (google_sub IS NULL OR google_sub=$sub)",
            ("$sub", googleSub), ("$email", email), ("$name", displayName),
            ("$now", DateTimeOffset.UtcNow.ToString("O")), ("$id", id)).ExecuteNonQuery();
        if (!initialized && (long)Sql(db, tx, "SELECT is_admin FROM users WHERE id=$id", ("$id", id)).ExecuteScalar()! == 1)
            Sql(db, tx, "INSERT INTO settings(key,value) VALUES('bootstrap_completed','1')").ExecuteNonQuery();
        var sessionId = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        Sql(db, tx, "INSERT INTO sessions(id,user_id,expires_utc) VALUES($session,$id,$expiry)",
            ("$session", sessionId), ("$id", id),
            ("$expiry", DateTimeOffset.UtcNow.AddHours(8).ToString("O"))).ExecuteNonQuery();
        tx.Commit();
        var user = List().Single(u => u.Id == id);
        return (user, sessionId);
    }
}
