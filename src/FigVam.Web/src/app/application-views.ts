import { createPropertyFieldModels } from '../ui/property-layout';
import { createScenarioModels } from '../features/interactions/scenarios';
import { createTokenModels } from '../features/tokens/tokens';
import { createStyleModels } from '../features/styles/styles';
import { createLayersModel } from '../features/editor/layers';
import { createDocumentNavigatorModel } from '../features/editor/document-navigator';
import { createMembersModel } from '../features/collaboration/members';
import { createComponentsModel } from '../features/components/components';
import { createDatasetsModel } from '../features/datasets/datasets';
import { createScreenDiagnosticsModel } from '../features/editor/screen-diagnostics';
import { createScreenResizeModel } from '../features/editor/screen-resize';
import { createScreenVariantsModel } from '../features/editor/screen-variants';
import { createDocumentHistoryModels } from '../features/history/document-history';
import { createUserAdminModel } from '../features/home/user-admin';
import { createMcpAccessModel } from '../features/mcp/mcp-access';
import { createAuthenticationModel } from '../features/home/authentication';
import { createHomeNavigationModel } from '../features/home/navigation';
import { createDocumentListModel } from '../features/home/document-list';
import { createPresenceModels } from '../features/collaboration/presence';

export function createApplicationViews() {
  return {
    propertyFields: createPropertyFieldModels(),
    scenarios: createScenarioModels(),
    tokens: createTokenModels(),
    styles: createStyleModels(),
    layers: createLayersModel(),
    navigator: createDocumentNavigatorModel(),
    authentication: createAuthenticationModel(),
    homeNavigation: createHomeNavigationModel(),
    documentList: createDocumentListModel(),
    presence: createPresenceModels(),
    members: createMembersModel(),
    components: createComponentsModel(),
    datasets: createDatasetsModel(),
    diagnostics: createScreenDiagnosticsModel(),
    screenResize: createScreenResizeModel(),
    screenVariants: createScreenVariantsModel(),
    history: createDocumentHistoryModels(),
    userAdmin: createUserAdminModel(),
    mcp: createMcpAccessModel(),
  };
}
export type ApplicationViews = ReturnType<typeof createApplicationViews>;
