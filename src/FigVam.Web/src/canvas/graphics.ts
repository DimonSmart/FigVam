import catalog from 'virtual:figvam-lucide';
import type { Bounds } from './canvas-model';

const ns = 'http://www.w3.org/2000/svg';
function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

export function renderIcon(name: string, stroke: string, thickness: number): SVGElement | null {
  const markup = Object.hasOwn(catalog, name) ? catalog[name] : undefined;
  if (!markup) return null;
  const icon = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  if (icon.namespaceURI !== ns || icon.localName !== 'svg') return null;
  const svg = document.importNode(icon, true) as unknown as SVGElement;
  svg.setAttribute('stroke', stroke);
  svg.setAttribute('stroke-width', String(thickness));
  return svg;
}

export function renderLine(bounds: Bounds, direction: string, stroke: string, thickness: number,
  pattern: string, start: string, end: string): SVGSVGElement {
  const w = Math.max(0.001, bounds.width), h = Math.max(0.001, bounds.height);
  const svg = svgElement('svg', { width: '100%', height: '100%', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', overflow: 'visible' });
  const [x1,y1,x2,y2] = direction === 'Vertical' ? [w/2,0,w/2,h] :
    direction === 'Descending' ? [0,0,w,h] : direction === 'Ascending' ? [0,h,w,0] : [0,h/2,w,h/2];
  const length = Math.hypot(x2!-x1!, y2!-y1!);
  const ux = (x2!-x1!)/length, uy = (y2!-y1!)/length;
  const line = svgElement('line', { x1:x1!, y1:y1!, x2:x2!, y2:y2!, stroke, 'stroke-width':thickness, 'vector-effect':'non-scaling-stroke' });
  if (pattern === 'Dashed') line.setAttribute('stroke-dasharray', `${thickness*4} ${thickness*2}`);
  if (pattern === 'Dotted') {
    line.setAttribute('stroke-linecap','round');
    line.setAttribute('stroke-dasharray', `0 ${thickness*2.5}`);
  }
  svg.append(line);
  function arrow(style: string, x: number, y: number, dx: number, dy: number) {
    if (style !== 'Open' && style !== 'Filled') return;
    const size = Math.min(length/3, thickness*4);
    const bx = x-dx*size, by = y-dy*size;
    const points = `${bx-dy*size/2},${by+dx*size/2} ${x},${y} ${bx+dy*size/2},${by-dx*size/2}`;
    svg.append(svgElement(style === 'Filled' ? 'polygon' : 'polyline', { points, stroke, fill:style === 'Filled' ? stroke : 'none',
      'stroke-width':thickness, 'stroke-linejoin':'round', 'vector-effect':'non-scaling-stroke' }));
  }
  arrow(start,x1!,y1!,-ux,-uy);
  arrow(end,x2!,y2!,ux,uy);
  return svg;
}
