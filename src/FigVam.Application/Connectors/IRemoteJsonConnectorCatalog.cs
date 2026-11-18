namespace FigVam.Application.Connectors;

// Checks administrator-owned configuration without resolving DNS or fetching data.
public interface IRemoteJsonConnectorCatalog
{
    bool IsAllowed(string connectorId);
}
