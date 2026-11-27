import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const src = files(join(root, 'src'));
const wwwroot = files(join(root, '../FigVam.Server/wwwroot'));
const source = src.filter(path => /\.tsx?$/.test(path) && !path.endsWith('.generated.ts')).map(path => ({
  path: relative(root, path).replaceAll('\\', '/'),
  ast: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true),
}));
function importedModules(ast: ts.SourceFile): string[] {
  return ast.statements.flatMap(statement => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
    ? [statement.moduleSpecifier.text] : []);
}
function countCalls(ast: ts.SourceFile, names: ReadonlySet<string>): number {
  let count = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) &&
        (ts.isIdentifier(node.expression) && names.has(node.expression.text) ||
         ts.isPropertyAccessExpression(node.expression) && names.has(node.expression.name.text))) count++;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return count;
}
describe('frontend architecture', () => {
  it('does not ship handwritten JavaScript source or legacy scripts in wwwroot', () => {
    expect([...src, ...wwwroot].filter(path => /\.[cm]?jsx?$/.test(path))).toEqual([]);
  });
  it('creates a single application React root', () => {
    const counts = source.map(({path, ast}) => {
      const names = new Set<string>(['createRoot']);
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== 'react-dom/client') continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const item of bindings.elements)
            if ((item.propertyName ?? item.name).text === 'createRoot') names.add(item.name.text);
      }
      return {path, count: countCalls(ast, names)};
    }).filter(item => item.count > 0);
    expect(counts.reduce((total, item) => total + item.count, 0)).toBe(1);
  });
  it('prevents additional direct portal implementations while migration continues', () => {
    expect(source.filter(({path, ast}) => path !== 'src/app/react-panels.tsx' &&
      (countCalls(ast, new Set(['createPortal'])) > 0 || ast.statements.some(statement =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === 'react-dom' &&
        statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(item => (item.propertyName ?? item.name).text === 'createPortal'))))
      .map(item => item.path)).toEqual([]);
  });
  it('keeps Canvas independent of React', () => {
    expect(source.filter(({path, ast}) => path.startsWith('src/canvas/') &&
      importedModules(ast).some(name => /^react(?:-dom)?(?:\/|$)/.test(name) || name.includes('react-panels')))
      .map(item => item.path)).toEqual([]);
  });
});
