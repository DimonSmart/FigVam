import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, posix } from 'node:path';
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

function boundaryViolations(path:string,ast:ts.SourceFile):string[]{
  const violations:string[]=[];
  const positions:Record<string,string>={
    'src/features/editor/editor-shell.tsx':'positionNavigatorMenu',
    'src/features/editor/document-navigator.tsx':'position',
    'src/features/tokens/token-views.tsx':'position',
  };
  const appOrFeature=/^src\/(app|features)\//.test(path);
  if(['src/api/auth-client.ts','src/core/session.ts'].includes(path)){
    for(const statement of ast.statements)
      if(ts.isVariableStatement(statement)&&!(statement.declarationList.flags&ts.NodeFlags.Const))
        violations.push('module-level mutable session state');
  }
  function enclosingFunction(node:ts.Node):string|undefined{
    for(let parent=node.parent;parent;parent=parent.parent)
      if(ts.isFunctionDeclaration(parent))return parent.name?.text;
    return undefined;
  }
  function visit(node:ts.Node){
    if(appOrFeature&&ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
      const {name,expression}=node.expression;
      if(['replaceChildren','setAttribute','removeAttribute','insertAdjacentHTML'].includes(name.text)||
        (ts.isPropertyAccessExpression(expression)&&expression.name.text==='classList'&&['add','remove','toggle','replace'].includes(name.text)))
        violations.push('imperative UI mutation: '+name.text);
    }
    if(appOrFeature&&ts.isBinaryExpression(node)&&ts.isPropertyAccessExpression(node.left)&&
      node.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.operatorToken.kind<=ts.SyntaxKind.LastAssignment){
      const {name,expression}=node.left;
      if(['innerHTML','outerHTML','className'].includes(name.text))violations.push('imperative UI assignment: '+name.text);
      if(ts.isPropertyAccessExpression(expression)&&expression.name.text==='style'&&
        !(positions[path]===enclosingFunction(node)&&['left','top','maxHeight'].includes(name.text)))
        violations.push('imperative CSS assignment: '+name.text);
    }
    if(path!=='src/api/document-commands.ts'&&ts.isCallExpression(node)&&node.arguments.length>=2){
      const [url,options]=node.arguments;
      if(url&&options&&url.getText(ast).includes('/assets/')&&ts.isObjectLiteralExpression(options)&&options.properties.some(p=>
        ts.isPropertyAssignment(p)&&p.name.getText(ast).replace(/['"]/g,'')==='method'&&ts.isStringLiteral(p.initializer)&&/^(PUT|POST|PATCH)$/i.test(p.initializer.text)))
        violations.push('asset upload outside prepared operation');
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  return violations;
}

describe('frontend architecture', () => {
  it('enforces session, DOM and asset mutation boundaries',()=>{
    expect(source.flatMap(({path,ast})=>boundaryViolations(path,ast).map(reason=>path+': '+reason))).toEqual([]);
  });
  it.each([
    ['src/api/auth-client.ts','let csrf = null;','module-level mutable session state'],
    ['src/features/editor/example.ts','element("layers").classList.toggle("active", true);','imperative UI mutation'],
    ['src/app/example.ts','element("layers").style.display = "none";','imperative CSS assignment'],
    ['src/features/editor/example.ts','request("/documents/id/assets/image", {method:"PUT"});','asset upload outside prepared operation'],
  ])('rejects forbidden ownership in %s',(path,code,expected)=>{
    const ast=ts.createSourceFile(path,code,ts.ScriptTarget.Latest,true);
    expect(boundaryViolations(path,ast).join('; ')).toContain(expected);
  });
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
  it('prevents direct portal implementations and legacy panel adapters', () => {
    expect(source.filter(({path, ast}) => (countCalls(ast, new Set(['createPortal'])) > 0 || ast.statements.some(statement =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === 'react-dom' &&
        statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(item => (item.propertyName ?? item.name).text === 'createPortal'))))
      .map(item => item.path)).toEqual([]);
  });
  it('does not retain the portal adapter or legacy static editor markup', () => {
    expect(source.filter(({path,ast}) => /(?:react-panels|node-property-controls|token-value-control|padding-editor)\.(?:ts|tsx)$/.test(path) || path.includes('react-panels') || importedModules(ast).some(name=>name.includes('react-panels'))).map(item=>item.path)).toEqual([]);
    const html=readFileSync(join(root,'../FigVam.Server/wwwroot/index.html'),'utf8');
    const body=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]?.trim();
    expect(body).toBe('<div id="figvam-app"></div>');
  });
  it('prevents controllers from reading or mutating the migrated shell via element IDs', () => {
    const owned = new Set([
      'mcp-access-menu', 'mcp-access-body', 'editor-view', 'documents-view', 'document-name', 'import-form', 'import-file', 'import-file-name',
      'import-status', 'import-error', 'import-diagnostics', 'document-title', 'revision',
      'document-rename', 'rename-document-name', 'delete-document', 'delete-result', 'delete-retry', 'delete-message',
      'history-access', 'history-action-status', 'history-action-error', 'history-action-retry',
      'presence-name', 'presence-color', 'presence-status', 'export-access', 'export-json', 'export-container', 'export-status', 'export-error',
      'editor-design', 'editor-preview', 'preview-theme', 'preview-back', 'preview-reset', 'design-render-status', 'design-render-diagnostics', 'design-render-retry', 'preview-render-status', 'preview-render-diagnostics', 'preview-render-retry', 'zoom-level', 'zoom-in', 'zoom-out', 'actual-size', 'fit-screen', 'canvas-selection', 'canvas-edit-hint', 'node-delete',
    ]);
    const violations: string[] = [];
    for (const {path, ast} of source) {
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          const fn = node.expression, arg = node.arguments[0];
          const name = ts.isIdentifier(fn) ? fn.text : ts.isPropertyAccessExpression(fn) ? fn.name.text : '';
          if (['element', 'getElementById'].includes(name) && arg && ts.isStringLiteral(arg) && owned.has(arg.text))
            violations.push(path + ': ' + arg.text);
          if (path === 'src/app/editor.ts' && name === 'addEventListener' && arg && ts.isStringLiteral(arg) &&
              ['click', 'submit', 'change', 'input'].includes(arg.text)) violations.push(path + ': ' + arg.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
  it('keeps Canvas independent of React', () => {
    expect(source.filter(({path, ast}) => path.startsWith('src/canvas/') &&
      importedModules(ast).some(name => /^react(?:-dom)?(?:\/|$)/.test(name) || name.includes('react-panels') || /(^|\/)(ui|app)\//.test(name)))
      .map(item => item.path)).toEqual([]);
  });
  it('routes document mutations through prepared command operations',()=>{
    const violations:string[]=[];
    for(const {path,ast} of source){
      if(path==='src/api/document-commands.ts')continue;
      function visit(node:ts.Node){
        if((ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))&&node.text.includes('/commands/'))
          violations.push(path+': '+node.text);
        if(ts.isIdentifier(node)&&node.text==='postDocumentCommand')violations.push(path+': legacy transport');
        ts.forEachChild(node,visit);
      }
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
  it('keeps domain logic and features independent of the composition root',()=>{
    expect(source.filter(({path,ast})=>path.startsWith('src/core/')&&importedModules(ast).some(name=>/^react(?:-dom)?(?:\/|$)/.test(name)||/(^|\/)(ui|app|features|canvas)\//.test(name))).map(item=>item.path)).toEqual([]);
    expect(source.filter(({path,ast})=>path.startsWith('src/features/')&&importedModules(ast).some(name=>/(^|\/)app\/editor(?:\.js)?$/.test(name))).map(item=>item.path)).toEqual([]);
  });
  it('does not bypass strict typing with explicit any or disabled checking',()=>{
    const violations:string[]=[];
    for(const {path,ast} of source){
      if(/@ts-(?:ignore|nocheck)\b/.test(ast.getFullText()))violations.push(path+': disabled checking');
      function visit(node:ts.Node){if(node.kind===ts.SyntaxKind.AnyKeyword)violations.push(path+': any');ts.forEachChild(node,visit);}
      visit(ast);
    }
    expect(violations).toEqual([]);
  });
  it('prevents circular runtime imports',()=>{
    const names=new Set(source.map(item=>item.path));
    const edges=new Map<string,string[]>();
    for(const {path,ast} of source){
      const imports=ast.statements.flatMap(statement=>{
        if(!ts.isImportDeclaration(statement)&&!ts.isExportDeclaration(statement))return [];
        const spec=statement.moduleSpecifier;
        if(!spec||!ts.isStringLiteral(spec)||!spec.text.startsWith('.'))return [];
        if(ts.isImportDeclaration(statement)){
          const clause=statement.importClause;
          if(clause?.isTypeOnly)return [];
          if(clause&&!clause.name&&clause.namedBindings&&ts.isNamedImports(clause.namedBindings)&&clause.namedBindings.elements.every(e=>e.isTypeOnly))return [];
        }else if(statement.isTypeOnly)return [];
        const target=posix.normalize(posix.join(posix.dirname(path),spec.text.replace(/\.js$/,'')));
        return [target+'.ts',target+'.tsx',target+'/index.ts'].filter(n=>names.has(n));
      });
      edges.set(path,imports);
    }
    const visited=new Set<string>(),stack=new Set<string>(),cycles:string[]=[];
    function visit(path:string){if(stack.has(path)){cycles.push([...stack,path].join(' -> '));return;}if(visited.has(path))return;visited.add(path);stack.add(path);for(const dependency of edges.get(path)??[])visit(dependency);stack.delete(path);}
    for(const path of names)visit(path);
    expect(cycles).toEqual([]);
  });
});
