import { PanelsTopLeft, UsersRound } from 'lucide-react';
import { flushSync } from 'react-dom';
import { createPanelRoot } from '../../app/react-panels';
import { Button } from '../../ui/Button';

type HomeView = 'documents' | 'users';

export function createHomeNavigation(host: HTMLElement, onSelect: (view: HomeView) => void) {
  const root = createPanelRoot(host);
  let admin = false;
  let selected: HomeView = 'documents';
  function render() {
    flushSync(() => root.render(<>
      <Button id="home-documents" aria-current={selected === 'documents' ? 'page' : 'false'} onClick={() => onSelect('documents')}>
        <PanelsTopLeft className="home-nav-icon" aria-hidden="true" />Документы
      </Button>
      <Button id="home-users" hidden={!admin} aria-current={selected === 'users' ? 'page' : 'false'} onClick={() => onSelect('users')}>
        <UsersRound className="home-nav-icon" aria-hidden="true" />Пользователи
      </Button>
    </>));
  }
  render();
  return {
    isAdmin: () => admin,
    setAdmin: (value: boolean) => { admin = value; if (!admin) selected = 'documents'; render(); },
    select: (value: HomeView) => { selected = value; render(); },
  };
}
