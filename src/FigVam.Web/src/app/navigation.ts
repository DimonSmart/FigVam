interface NavigationOptions {
  isAuthenticated(): boolean;
  openDocument(id: string): Promise<void>;
  loadList(): Promise<void>;
  requestLeave(resume: () => void): boolean;
  currentDocument(): string | null;
  focusContent(): void;
  hasDirtyDraft(): boolean;
}

export function documentIdFromPath(path: string): string | null {
  return path.match(/^\/documents\/([0-9a-f-]+)\/?$/i)?.[1] ?? null;
}

export function createNavigation(options: NavigationOptions) {
  function route() {
    if (!options.isAuthenticated()) return;
    const id = documentIdFromPath(location.pathname);
    return id ? options.openDocument(id) : options.loadList();
  }
  function navigate(path: string) {
    if (!options.requestLeave(() => navigate(path))) return;
    history.pushState(null, '', path);
    route();
    options.focusContent();
  }
  function onClick(event: MouseEvent) {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-navigation]') : null;
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = link.getAttribute('href');
    if (href) navigate(href);
  }
  function onPopState() {
    const destination = location.pathname;
    if (options.requestLeave(() => navigate(destination))) route();
    else {
      const id = options.currentDocument();
      history.replaceState(null, '', id ? '/documents/' + id : '/');
    }
  }
  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (options.hasDirtyDraft()) { event.preventDefault(); event.returnValue = ''; }
  }
  function attach() {
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }
  return { route, navigate, attach };
}
