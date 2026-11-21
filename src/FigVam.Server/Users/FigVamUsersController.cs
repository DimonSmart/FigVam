using FigVam.Server.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace FigVam.Server.Users;

[ApiController, Authorize, Route("api/users")]
public sealed class FigVamUsersController : ControllerBase
{
    private FigVamUserStore? Store => HttpContext.RequestServices.GetService<FigVamUserStore>();
    private bool IsAdmin(FigVamUserStore store) =>
        User.FindFirst("sub") is { Value: var id } && store.IsAdmin(id);

    [HttpGet]
    public IActionResult List()
    {
        if (Store is not { } store) return NotFound();
        if (!IsAdmin(store)) return Forbid();
        return Ok(new { users = store.List() });
    }

    [HttpGet("lookup")]
    public IActionResult Lookup()
    {
        if (Store is not { } store) return NotFound();
        return Ok(new { users = store.List(enabledOnly: true)
            .Select(u => new { u.Id, u.Email, u.Name }).ToArray() });
    }

    [HttpPost]
    public IActionResult Invite(InviteUserRequest request)
    {
        if (Store is not { } store) return NotFound();
        if (!IsAdmin(store)) return Forbid();
        try
        {
            return StatusCode(201, store.Invite(request.Email));
        }
        catch (ArgumentException)
        {
            return BadRequest(new { code = "INVALID_EMAIL" });
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return Conflict(new { code = "USER_EXISTS" });
        }
    }

    [HttpPut("{id}")]
    public IActionResult Update(string id, UpdateUserRequest request)
    {
        if (Store is not { } store) return NotFound();
        if (!IsAdmin(store)) return Forbid();
        try
        {
            return store.Update(id, request.Enabled, request.Admin)
                ? Ok(new { code = "ACCEPTED" }) : NotFound();
        }
        catch (InvalidOperationException)
        {
            return Conflict(new { code = "LAST_ADMIN" });
        }
    }
}

public sealed record InviteUserRequest(string Email);
public sealed record UpdateUserRequest(bool Enabled, bool Admin);
