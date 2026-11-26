// Validate the envelope without reserializing the DTCG documents: the existing
// server importer must see duplicate keys and the original values unchanged.
function rawProperties(json) {
  const lexer = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g;
  const next = () => lexer.exec(json);
  const properties = new Map();
  next(); // opening brace; JSON.parse has already checked the grammar
  for (let key = next(); key[0] !== '}'; key = next()) {
    const name = JSON.parse(key[0]);
    next(); // colon
    const first = next();
    let last = first;
    let depth = ['{','['].includes(first[0]) ? 1 : 0;
    while (depth) {
      last = next();
      if (['{','['].includes(last[0])) depth++;
      else if (['}',']'].includes(last[0])) depth--;
    }
    if (properties.has(name)) throw new Error('Повторяющееся поле формата FigVam: ' + name);
    properties.set(name, json.slice(first.index, last.index + last[0].length));
    if (next()[0] === '}') break;
  }
  return properties;
}

export function splitTokenBundle(json) {
  const bundle = JSON.parse(json);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(bundle) || bundle.format !== 'figvam-tokens' || bundle.version !== 1 ||
      !object(bundle.themes) || !object(bundle.themes.Light) || !object(bundle.themes.Dark))
    throw new Error('Ожидается файл FigVam версии 1 с обеими темами Light и Dark.');
  const themes = rawProperties(rawProperties(json).get('themes'));
  return { lightJson: themes.get('Light'), darkJson: themes.get('Dark') };
}
