import { PanelsTopLeft, UsersRound } from 'lucide-react';
import { createViewModel } from '../../app/view-model';
import { Button } from '../../ui/Button';

type HomeView = 'documents' | 'users';

function HomeNavigation({admin, selected, onSelect}:{admin:boolean;selected:HomeView;onSelect:(view:HomeView)=>void}) {
  return <>
      <Button id="home-documents" aria-current={selected === 'documents' ? 'page' : 'false'} onClick={() => onSelect('documents')}>
        <PanelsTopLeft className="home-nav-icon" aria-hidden="true" />Документы
      </Button>
      <Button id="home-users" hidden={!admin} aria-current={selected === 'users' ? 'page' : 'false'} onClick={() => onSelect('users')}>
        <UsersRound className="home-nav-icon" aria-hidden="true" />Пользователи
      </Button>
    </>;
}
export function createHomeNavigationModel(){return createViewModel(HomeNavigation);}
export function createHomeNavigation(model: ReturnType<typeof createHomeNavigationModel>, onSelect: (view: HomeView) => void) {
  let admin = false;
  let selected: HomeView = 'documents';
  function render(){model.publish({admin,selected,onSelect});}
  render();
  return {
    isAdmin: () => admin,
    setAdmin: (value: boolean) => { admin = value; if (!admin) selected = 'documents'; render(); },
    select: (value: HomeView) => { selected = value; render(); },
  };
}
