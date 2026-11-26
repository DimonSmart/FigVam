import { renderModelPng } from './screen-capture.js';

const result = document.getElementById('result');
try {
  const snapshot = JSON.parse(document.getElementById('snapshot').textContent);
  document.getElementById('snapshot').remove();
  const overrides = new Map(snapshot.overrides.map(item => [item.nodeId, item.properties]));
  const model = {
    screen: snapshot.screen, theme: snapshot.theme, overrides,
    nodes: new Map(snapshot.nodes.map(node => [node.id, { ...node, properties: { ...node.properties, ...overrides.get(node.id) } }])),
    boxes: new Map(snapshot.boxes.map(box => [box.objectId, box])),
    kinds: new Map(snapshot.kinds.map(kind => [kind.kind, kind])),
    assets: new Map(snapshot.assets.map(asset => [asset.id, asset])),
    tokens: new Map(snapshot.tokens.map(token => [token.id, token]))
  };
  const png = await renderModelPng(model, snapshot.width, snapshot.height, id =>
    Promise.resolve(new Blob([Uint8Array.from(atob(snapshot.assetData[id]), c => c.charCodeAt(0))], { type: 'image/png' })),
    snapshot.values, new AbortController().signal);
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(png);
  });
  result.textContent = 'PNG:' + url.split(',')[1];
} catch {
  result.textContent = 'CAPTURE_FAILED';
}
