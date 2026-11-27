import { createAuthenticationModel } from '../features/home/authentication';
import { createHomeNavigationModel } from '../features/home/navigation';
import { createDocumentListModel } from '../features/home/document-list';
import { createPresenceModels } from '../features/collaboration/presence';

export function createApplicationViews() {
  return {
    authentication: createAuthenticationModel(),
    homeNavigation: createHomeNavigationModel(),
    documentList: createDocumentListModel(),
    presence: createPresenceModels(),
  };
}
export type ApplicationViews = ReturnType<typeof createApplicationViews>;
