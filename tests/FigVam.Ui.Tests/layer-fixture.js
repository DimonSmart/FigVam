// Synthetic children responses use the same revision-pinned pagination envelope
// as the real structure API. Tests still control the node data and failures.
function fulfillLayerPage(route, items) {
  const url = new URL(route.request().url()), params = url.searchParams;
  const offset = Number(params.get('offset') ?? 0);
  const limit = Number(params.get('limit') ?? 100);
  const parentId = url.pathname.split('/').at(-1);
  return route.fulfill({ json: {
    documentId: url.pathname.split('/')[4],
    revision: Number(params.get('revision')),
    offset, limit, total: items.length,
    items: items.slice(offset, offset + limit).map(item => ({ type: 'node', parentId, ...item }))
  } });
}
module.exports = { fulfillLayerPage };
