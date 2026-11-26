interface Point { x: number; y: number }
interface Screen { id: string; dimensions: { width: number; height: number } }
interface ViewportOptions {
  element: (id: string) => HTMLElement | null;
  getScreen: () => Screen | null | undefined;
  getSelectedScreen: () => string | null;
  onViewportChange: () => void;
  setPresenceCursor: (point: Point | null, screenId: string | null) => void;
}

export function createCanvasViewport({ element: lookup, getScreen, getSelectedScreen, onViewportChange, setPresenceCursor }: ViewportOptions) {
  const lifetime = new AbortController();
  const element = (id: string): HTMLElement => {
    const result = lookup(id);
    if (!result) throw new Error('Missing canvas element: ' + id);
    return result;
  };
  const signal = lifetime.signal;
  let fitFrame = 0;
  let viewport = { scale: 1, x: 0, y: 0 };
  let displayedScreen: string | null = null;

  function paintViewport() {
    const boundary = element('screen-boundary');
    boundary.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    boundary.style.setProperty('--canvas-scale', String(viewport.scale));
    element('zoom-level').textContent = `${Math.round(viewport.scale * 100)}%`;
    const grid = element('viewport');
    const spacing = 20 * viewport.scale;
    grid.style.backgroundSize = `${spacing}px ${spacing}px`;
    grid.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
    onViewportChange();
  }

  function fitScreen() {
    const screen = getScreen();
    if (!screen) return;
    const area = element('viewport'), { width, height } = screen.dimensions;
    if (!area.clientWidth || !area.clientHeight) return;
    const scale = Math.min(width ? (area.clientWidth - 48) / width : 4, height ? (area.clientHeight - 48) / height : 4, 4);
    viewport.scale = Math.max(0.05, scale);
    viewport.x = (area.clientWidth - width * viewport.scale) / 2;
    viewport.y = (area.clientHeight - height * viewport.scale) / 2;
    paintViewport();
  }

  function renderCanvas() {
    const screen = getScreen();
    const boundary = element('screen-boundary');
    boundary.hidden = !screen;
    for (const id of ['zoom-out', 'zoom-in', 'fit-screen', 'actual-size']) {
      const button = element(id);
      if (!(button instanceof HTMLButtonElement)) throw new Error('Expected canvas button: ' + id);
      button.disabled = !screen;
    }
    if (!screen) {
      displayedScreen = null;
      element('canvas-selection').textContent = 'Выберите экран, чтобы показать его на холсте.';
      viewport = { scale: 1, x: 0, y: 0 }; paintViewport(); return;
    }
    const { width, height } = screen.dimensions;
    element('canvas-selection').textContent = `Экран: ${width} × ${height} uiUnit`;
    boundary.style.width = `${width}px`; boundary.style.height = `${height}px`;
    if (displayedScreen !== screen.id) {
      displayedScreen = screen.id;
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(fitScreen);
    }
    paintViewport();
  }

  function zoomAt(scale: number, x: number, y: number) {
    if (!getSelectedScreen()) return;
    const next = Math.max(0.05, Math.min(4, scale));
    const factor = next / viewport.scale;
    viewport.x = x - (x - viewport.x) * factor;
    viewport.y = y - (y - viewport.y) * factor;
    viewport.scale = next; paintViewport();
  }
  function zoomCenter(scale: number) {
    const area = element('viewport'); zoomAt(scale, area.clientWidth / 2, area.clientHeight / 2);
  }
  element('zoom-in').addEventListener('click', () => zoomCenter(viewport.scale * 1.25), { signal });
  element('zoom-out').addEventListener('click', () => zoomCenter(viewport.scale / 1.25), { signal });
  element('actual-size').addEventListener('click', () => zoomCenter(1), { signal });
  element('fit-screen').addEventListener('click', fitScreen, { signal });
  const canvasArea = element('viewport');
  // Preserve zoom and canvas center when sidebars or the browser change size.
  let previousWidth = 0, previousHeight = 0;
  const observer = new ResizeObserver(entries => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0) {
      if (previousWidth > 0 && previousHeight > 0 && displayedScreen) {
        viewport.x += (width - previousWidth) / 2;
        viewport.y += (height - previousHeight) / 2;
        paintViewport();
      }
      previousWidth = width;
      previousHeight = height;
    }
  });
  observer.observe(canvasArea);
  canvasArea.addEventListener('wheel', event => {
    if (!getSelectedScreen() || event.defaultPrevented) return;
    event.preventDefault();
    const rect = canvasArea.getBoundingClientRect();
    zoomAt(viewport.scale * Math.exp(-event.deltaY * 0.001), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false, signal });
  canvasArea.addEventListener('keydown', event => {
    if (!getSelectedScreen() || event.defaultPrevented) return;
    const moves: Readonly<Partial<Record<string, readonly [number, number]>>> = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault(); viewport.x += move[0]; viewport.y += move[1]; paintViewport();
  }, { signal });
  let drag: { id: number; x: number; y: number } | null = null;
  canvasArea.addEventListener('pointerdown', event => {
    if (!getSelectedScreen() || event.defaultPrevented || !event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
    if (event.button === 0 && !event.altKey && event.target instanceof Element && event.target.closest('[data-visual-node]')) return;
    event.preventDefault();
    canvasArea.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; canvasArea.setPointerCapture(event.pointerId);
  }, { signal });
  canvasArea.addEventListener('pointermove', event => {
    if (getSelectedScreen()) { const rect = canvasArea.getBoundingClientRect(); const x = (event.clientX - rect.left - viewport.x) / viewport.scale, y = (event.clientY - rect.top - viewport.y) / viewport.scale; setPresenceCursor(Math.abs(x) <= 10000000 && Math.abs(y) <= 10000000 ? { x, y } : null, getSelectedScreen()); }
    if (!drag || event.pointerId !== drag.id) return;
    viewport.x += event.clientX - drag.x; viewport.y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY; paintViewport();
  }, { signal });
  canvasArea.addEventListener('pointerleave', () => { setPresenceCursor(null, null); }, { signal });
  function endDrag(event: PointerEvent) { if (drag?.id === event.pointerId) drag = null; }
  canvasArea.addEventListener('pointerup', endDrag, { signal });
  canvasArea.addEventListener('pointercancel', endDrag, { signal });
  canvasArea.addEventListener('lostpointercapture', endDrag, { signal });


  return {
    render: renderCanvas,
    fit: fitScreen,
    get scale() { return viewport.scale; },
    toViewportPoint: (point: Point): Point => ({ x: viewport.x + point.x * viewport.scale, y: viewport.y + point.y * viewport.scale }),
    dispose() { lifetime.abort(); observer.disconnect(); cancelAnimationFrame(fitFrame); drag = null; }
  };
}
