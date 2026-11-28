interface Point { x: number; y: number }
interface Screen { id: string; dimensions: { width: number; height: number } }
import type { CanvasChromeSink as CanvasChrome } from './chrome-contracts';
import { clampGuide, decodeGuides, defaultGridSettings, validGridStep, type Guide, type GuideAxis, type GridSettings } from './visual-geometry';
interface ViewportOptions {
  chrome:CanvasChrome;
  element: (id: string) => HTMLElement | null;
  getScreen: () => Screen | null | undefined;
  getSelectedScreen: () => string | null;
  getDocumentId: () => string | null;
  onViewportChange: () => void;
  setPresenceCursor: (point: Point | null, screenId: string | null) => void;
}

export function createCanvasViewport({ chrome, element: lookup, getScreen, getSelectedScreen, getDocumentId, onViewportChange, setPresenceCursor }: ViewportOptions) {
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
  let settings = {...defaultGridSettings};
  let guideScope:string|null=null;
  let guideDrag:{id:string;pointer:number;original:number;scope:string;scale:number}|null=null;
  const guideElements=new Map<string,HTMLButtonElement>();
  const guideHost=element('canvas-manual-guides');
  const scope=()=>{const documentId=getDocumentId(),screenId=getSelectedScreen();return documentId&&screenId?`figvam:guides:${documentId}:${screenId}`:null;};
  function persistGuides(){if(guideScope)try{localStorage.setItem(guideScope,JSON.stringify(settings.guides));}catch{/* Storage is optional for editor preferences. */}}
  function publishGuides(guides:readonly Guide[],persist=true){settings={...settings,guides};if(persist)persistGuides();chrome.patch({grid:settings});paintGuides();}
  function paintGuides(){
    const live=new Set(settings.guides.map(guide=>guide.id));
    for(const [id,line] of guideElements)if(!live.has(id)){line.remove();guideElements.delete(id);}
    const screen=getScreen();
    for(const guide of settings.guides){
      let line=guideElements.get(guide.id);
      if(!line){line=document.createElement('button');line.type='button';line.className='canvas-manual-guide';line.dataset.guideId=guide.id;line.dataset.axis=guide.axis;guideHost.append(line);guideElements.set(guide.id,line);}
      const limit=screen?(guide.axis==='x'?screen.dimensions.width:screen.dimensions.height):0;
      const position=clampGuide(guide.position,limit);
      line.style[guide.axis==='x'?'left':'top']=position+'px';
      line.title=(guide.axis==='x'?'Вертикальная':'Горизонтальная')+' направляющая: '+position+' (Delete — удалить)';
      line.setAttribute('aria-label',line.title);
    }
  }
  function updateGuide(id:string,position:number,persist=true){const screen=getScreen();if(!screen)return;
    publishGuides(settings.guides.map(guide=>guide.id===id?{...guide,position:clampGuide(position,guide.axis==='x'?screen.dimensions.width:screen.dimensions.height)}:guide),persist);
  }
  function addGuide(axis:GuideAxis){const screen=getScreen();if(!screen||settings.guides.length>=128)return;
    const position=(axis==='x'?screen.dimensions.width:screen.dimensions.height)/2;
    const id=crypto.randomUUID();publishGuides([...settings.guides,{id,axis,position}]);guideElements.get(id)?.focus({preventScroll:true});
  }
  function guideFromEvent(event:Event){const id=event.target instanceof HTMLElement?event.target.closest<HTMLElement>('[data-guide-id]')?.dataset.guideId:undefined;return settings.guides.find(guide=>guide.id===id);}
  guideHost.addEventListener('pointerdown',event=>{
    const guide=guideFromEvent(event);if(!guide||!event.isPrimary||event.button!==0||event.altKey||!guideScope)return;
    event.preventDefault();event.stopPropagation();const line=guideElements.get(guide.id);if(!line)return;
    line.focus({preventScroll:true});line.setPointerCapture(event.pointerId);guideDrag={id:guide.id,pointer:event.pointerId,original:guide.position,scope:guideScope,scale:viewport.scale};
  },{signal});
  guideHost.addEventListener('pointermove',event=>{
    const current=guideDrag;if(!current||current.pointer!==event.pointerId||current.scope!==guideScope||current.scale!==viewport.scale)return;
    const guide=settings.guides.find(item=>item.id===current.id);if(!guide)return;
    const bounds=element('screen-boundary').getBoundingClientRect();const position=guide.axis==='x'?(event.clientX-bounds.left)/viewport.scale:(event.clientY-bounds.top)/viewport.scale;
    updateGuide(guide.id,position,false);
  },{signal});
  function finishGuide(event:PointerEvent,commit:boolean){const current=guideDrag;if(!current||current.pointer!==event.pointerId)return;guideDrag=null;
    if(current.scope!==guideScope)return;if(commit)persistGuides();else updateGuide(current.id,current.original,false);
  }
  guideHost.addEventListener('pointerup',event=>finishGuide(event,true),{signal});
  guideHost.addEventListener('pointercancel',event=>finishGuide(event,false),{signal});
  guideHost.addEventListener('lostpointercapture',event=>finishGuide(event,false),{signal});
  guideHost.addEventListener('keydown',event=>{
    const guide=guideFromEvent(event);if(!guide)return;
    const delta=guide.axis==='x'?(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0):(event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0);
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();publishGuides(settings.guides.filter(item=>item.id!==guide.id));element('viewport').focus({preventScroll:true});}
    else if(delta){event.preventDefault();event.stopPropagation();updateGuide(guide.id,guide.position+delta*(event.shiftKey?10:1));}
    else if(event.key==='Escape'&&guideDrag){event.preventDefault();event.stopPropagation();const current=guideDrag;guideDrag=null;updateGuide(current.id,current.original,false);const line=guideElements.get(current.id);if(line?.hasPointerCapture(current.pointer))line.releasePointerCapture(current.pointer);}
  },{signal});

  function paintViewport() {
    const boundary = element('screen-boundary');
    boundary.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    boundary.style.setProperty('--canvas-scale', String(viewport.scale));
    chrome.patch({zoomPercent:Math.round(viewport.scale * 100)});
    const grid = element('viewport');
    const spacing = settings.step * viewport.scale;
    grid.style.backgroundSize = `${spacing}px ${spacing}px`;
    grid.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
    const overlay = element('canvas-grid-overlay');
    overlay.hidden = !getScreen();
    overlay.style.transform = boundary.style.transform;
    overlay.style.width = boundary.style.width;
    overlay.style.height = boundary.style.height;
    overlay.style.backgroundSize = `${settings.step}px ${settings.step}px`;
    overlay.dataset.gridVisible = String(settings.visible);
    overlay.style.setProperty('--canvas-scale',String(viewport.scale));
    paintGuides();
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
    chrome.patch({available:!!screen});
    const nextScope=scope();
    if(nextScope!==guideScope){guideDrag=null;guideScope=nextScope;let guides:Guide[]=[];
      if(guideScope)try{guides=decodeGuides(JSON.parse(localStorage.getItem(guideScope)??'[]'));}catch{/* Ignore corrupted/unavailable local editor settings. */}
      publishGuides(guides,false);
    }
    if (!screen) {
      displayedScreen = null;
      chrome.patch({caption:'Выберите экран, чтобы показать его на холсте.'});
      viewport = { scale: 1, x: 0, y: 0 }; paintViewport(); return;
    }
    const { width, height } = screen.dimensions;
    chrome.patch({caption:`Экран: ${width} × ${height} uiUnit`});
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
    zoomIn:()=>zoomCenter(viewport.scale*1.25),zoomOut:()=>zoomCenter(viewport.scale/1.25),actualSize:()=>zoomCenter(1),
    get scale() { return viewport.scale; },
    get grid() { return settings; },
    addGuide,
    setGrid(next: Partial<GridSettings>) {
      if (next.step !== undefined && !validGridStep(next.step)) return;
      settings = {...settings, ...next};
      chrome.patch({grid:settings});
      paintViewport();
    },
    toViewportPoint: (point: Point): Point => ({ x: viewport.x + point.x * viewport.scale, y: viewport.y + point.y * viewport.scale }),
    dispose() { lifetime.abort(); observer.disconnect(); cancelAnimationFrame(fitFrame); drag = null;guideDrag=null;for(const line of guideElements.values())line.remove();guideElements.clear(); }
  };
}
