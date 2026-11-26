// Validate the envelope without reserializing the DTCG documents: the existing
// server importer must see duplicate keys and the original values unchanged.
function rawProperties(json: string): Map<string, string> {
  const lexer = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g;
  const next = (): RegExpExecArray => {
    const token = lexer.exec(json);
    if (!token) throw new Error('Некорректный формат FigVam.');
    return token;
  };
  const properties = new Map<string, string>();
  next(); // opening brace; JSON.parse has already checked the grammar
  for (let key = next(); key[0] !== '}'; key = next()) {
    const name: unknown = JSON.parse(key[0]);
    if (typeof name !== 'string') throw new Error('Некорректное имя поля FigVam.');
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

export function splitTokenBundle(json: string): { lightJson: string; darkJson: string } {
  const bundle: unknown = JSON.parse(json);
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(bundle) || bundle.format !== 'figvam-tokens' || bundle.version !== 1 ||
      !object(bundle.themes) || !object(bundle.themes.Light) || !object(bundle.themes.Dark))
    throw new Error('Ожидается файл FigVam версии 1 с обеими темами Light и Dark.');
  const rawThemes = rawProperties(json).get('themes');
  if (rawThemes === undefined) throw new Error('Не заданы темы FigVam.');
  const themes = rawProperties(rawThemes);
  const lightJson = themes.get('Light'), darkJson = themes.get('Dark');
  if (lightJson === undefined || darkJson === undefined) throw new Error('Не заданы обе темы FigVam.');
  return { lightJson, darkJson };
}
