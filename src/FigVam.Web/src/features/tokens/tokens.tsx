import { createTokenModels, type ImportKey, type ImportValues } from './token-views';
export { createTokenModels } from './token-views';
import { knownType, literalValue, types, themes, categories, allowedCategories, typeIndex, categoryIndex, literalExpression, directText, typeOf, categoryOf, typographyFields, groupKey, type TypographyPart } from './token-values';
import { createDocumentCommand, type DocumentCommandOperation } from '../../api/document-commands';
import { toApiTokenExpression } from '../../api/command-value-contracts';
import type { ApiClient } from '../../api/api-client';
import { ApiError } from '../../api/api-client';
import { requiredRecord, record, array, text, errorMessage, aborted } from '../../api/decode';
import { token as readToken } from '../../canvas/render-model';
import type { DesignToken, TokenType, TokenCategory, Theme, TokenValue, TokenExpression, TypographyFieldsValue, TypographyField, ResolvableValue } from '../../core/tokens/token-model';
import { tokenTypes, tokenCategories } from '../../core/tokens/token-model';
import type { TokenGroup } from '../../core/tokens/token-groups';
import { createShadowSpec,createReferenceSpec,createValueField,type ValueSpec,type ValueField,type EditKind,type CompositeSpec } from '../../ui/property-value';
import { rawArray, rawText } from '../../ui/property-control-contract';
import type { components } from '../../api/schema.generated';
type Schema=components['schemas'];
type Command='add-token'|'set-token-value'|'delete-token'|'rename-token'|'import-design-tokens';
type CommandData={
  'add-token':Omit<Schema['AddTokenRequest'],'commandId'|'values'> & {values:Record<Theme,TokenExpression>};
  'set-token-value':Omit<Schema['SetTokenValueRequest'],'commandId'|'value'> & {value:TokenExpression};
  'delete-token':Omit<Schema['DeleteTokenRequest'],'commandId'>;
  'rename-token':Omit<Schema['RenameTokenRequest'],'commandId'>;
  'import-design-tokens':Omit<Schema['ImportDesignTokensRequest'],'commandId'>;
};
type TokenCommandInput={ [K in Command]:[command:K,data:CommandData[K],selection?:string] }[Command];
function prepareTokenCommand(doc:string,...[command,data]:TokenCommandInput):DocumentCommandOperation{
  switch(command){
    case 'add-token':return createDocumentCommand(doc,command,{...data,values:{Light:toApiTokenExpression(data.values.Light),Dark:toApiTokenExpression(data.values.Dark)}});
    case 'set-token-value':return createDocumentCommand(doc,command,{...data,value:toApiTokenExpression(data.value)});
    case 'delete-token':return createDocumentCommand(doc,command,data);
    case 'rename-token':return createDocumentCommand(doc,command,data);
    case 'import-design-tokens':return createDocumentCommand(doc,command,data);
  }
}
interface PendingTokenCommand{operation:DocumentCommandOperation;input:TokenCommandInput;running:boolean;}
interface Context {documentId:string|null;documentRole:string|null;revision:number|null;generation:number;navigationEpoch:number}
interface Options {models:ReturnType<typeof createTokenModels>;selectLayer(id:string):void;showEditor():void;request:ApiClient;getContext():Context;startRequest():{signal:AbortSignal;current:number};stopLive():void;startLive():void;readPages(signal:AbortSignal):Promise<unknown>}
interface Usage {label?:string;kind:string;property?:string|null;theme?:number|string|null;indirect:boolean;ownerId:string;chain:string[]}
interface UsageSnapshot {selection:string|null;usages:Usage[]}
interface Snapshot extends UsageSnapshot {items:DesignToken[]}
interface ThemeSave {tokenId:string;theme:Theme;index:number;value:TokenExpression;documentId:string|null}
function usage(value:unknown):Usage{const v=requiredRecord(value);return{kind:text(v.kind),ownerId:text(v.ownerId),label:v.label==null?undefined:text(v.label),property:v.property==null?null:text(v.property),theme:v.theme==null?null:typeof v.theme==='number'?v.theme:text(v.theme),indirect:v.indirect===true,chain:array(v.chain??[],text)};}
import { splitTokenBundle } from '../../core/tokens/token-exchange';
import { tokenSegments, buildTokenGroups, shortTokenName, tokenNameError, tokenNameDiagnostics, filteredTokens, tokensInGroup, matchesTokenSearch, qualifyTokenName } from '../../core/tokens/token-groups';
import { normalizedTokenType, normalizedTokenCategory, resolveTokenValue, tokenValueText } from '../../core/tokens/token-resolution';

export function createTokens({ models, selectLayer, showEditor, request, getContext, startRequest, stopLive, startLive, readPages }:Options) {
  let tokenItems:DesignToken[]=[],selectedToken:string|null=null,tokenUsages:Usage[]=[],tokenLoad=0,rendered=false;
  const editable=()=>['Owner','Editor'].includes(getContext().documentRole??'');
  let group:string[]=[],collapsed=new Set<string>(), creating = false, usagesReady = false;
  let importEpoch = 0;
  let selectedTypes=new Set<TokenType>(types);
  let createControls:ValueField[]=[],detailControls:ValueField[]=[],renaming=false;
  const pendingThemeValues=new Map<string,ThemeSave>();
  const themeKey=(tokenId:string,theme:Theme)=>`${tokenId}:${theme}`;
  let usageController:AbortController|null=null;
  let activeThemeSave:ThemeSave|null=null;
  let commandBusy=false,detailBusy=false,importOpen=false,importMode:'combined'|'pair'='combined';
  const emptyImport=():ImportValues=>({combined:'',light:'',dark:'',mapping:''});
  let importValues=emptyImport(),importReset=0,search='',newName='',newType='Color',newCategory='',renameName='',status='',error='',diagnostic='';
  const selected = () => tokenItems.find(t => t.id === selectedToken);
  const pendingCommands=new Map<string,PendingTokenCommand>();
  const pending=()=>pendingCommands.get(getContext().documentId??'');
  const busy = () => commandBusy||!!pending();
  function publishPanel(){
    const item=selected();
    models.panel.publish({error,status,editable:editable(),busy:busy(),detailBusy:detailBusy||!!pending()&&pending()?.input[0]!=='set-token-value',retryVisible:editable()&&!!pending()&&!pending()?.running,retry:()=>{const op=pending();if(op)void executeTokenCommand(op).then(saved=>{if(saved)void flushThemeSaves();});},importOpen,importMode,importValues:{...importValues},importReset,
      search,creating,selected:!!item,placeholder:group.length?group.join('.')+'.…':'Имя токена',newName,newType,newCategory,categoryOptions:allowedCategories[newType]??[],
      title:item?.name??'',type:item?[typeOf(item),categoryOf(item)].filter(Boolean).join(' · '):'',diagnostic,renaming,renameName,usagesReady,usageCount:tokenUsages.length,
      Menu:models.menu.Component,Groups:models.groups.Component,Table:models.table.Component,CreateFields:models.createFields.Component,DetailFields:models.detailFields.Component,Usage:models.usage.Component,
      changeSearch:value=>{search=value;group=[];renderTokens(false);},changeImport:(key,value)=>{importValues[key]=value;publishPanel();},
      setImportMode:mode=>{importMode=mode;publishPanel();},loadImportFile:(key,file)=>{void loadImportFile(key,file);},
      submitImport,closeImport:()=>{importOpen=false;publishPanel();},changeNewName:value=>{newName=value;publishPanel();},
      changeType:type=>{newType=type;updateCategoryOptions();},changeCategory:category=>{newCategory=category;updateCreateMode();publishPanel();},
      create:createToken,cancelCreate:()=>{creating=false;publishPanel();},beginRename,cancelRename:endRename,changeRenameName:name=>{renameName=name;publishPanel();},rename:()=>{void renameToken();},remove:deleteToken});
  }
  function setError(value:string){error=value;publishPanel();}
  function resetImport(){importMode='combined';importValues=emptyImport();importReset++;importOpen=false;}
  function clearBusy(){if(!pending()?.running){commandBusy=false;detailBusy=false;}publishPanel();}
  function refreshAccess() {
    syncTypeFilter();
    if (!editable()) { creating=false;pendingThemeValues.clear();importOpen=false;endRename(); }
    detailControls.forEach(control => control.setDisabled?.(!editable()));
    publishPanel();
  }
  function updateDetailVisibility(){publishPanel();}
  function beginCreate() {
    if (!editable() || busy()) return;
    creating = true;newType='Color';newCategory='';newName=group.length?group.join('.')+'.':'';
    endRename();updateCategoryOptions();publishPanel();
  }
  function syncTypeFilter(writable=editable()){
    models.menu.publish({editable:writable,selectedTypes:new Set(selectedTypes),create:beginCreate,importTokens:toggleImport,exportTokens:theme=>void exportTokens(theme),
      toggleAll:()=>{selectedTypes=selectedTypes.size===types.length?new Set():new Set(types);syncTypeFilter();renderTokens(false);},
      toggleType:(type,checked)=>{if(checked)selectedTypes.add(type);else selectedTypes.delete(type);syncTypeFilter();renderTokens(false);}});
  }
  syncTypeFilter();
  function toggleImport(){if(editable()&&!busy()){importOpen=!importOpen;publishPanel();}}
  const fileLoads:Record<ImportKey,number>={combined:0,light:0,dark:0};
  async function loadImportFile(theme:ImportKey,file:File|null){
    const documentId=getContext().documentId,epoch=importEpoch,load=++fileLoads[theme];
    if(!file)return;
    const current=()=>epoch===importEpoch&&load===fileLoads[theme]&&documentId===getContext().documentId;
    try{
      if(file.size>(theme==='combined'?2*1024*1024+4096:1024*1024))throw new Error('Файл токенов слишком большой.');
      const value=await file.text();
      if(current()){importValues[theme]=value;publishPanel();}
    }catch(failure){if(current())setError(errorMessage(failure));}
  }
  function submitImport(){
    try {
      let lightJson:string,darkJson:string;
      if (importMode === 'combined') {
        ({ lightJson, darkJson } = splitTokenBundle(importValues.combined));
      } else {
        lightJson = importValues.light; darkJson = importValues.dark;
        JSON.parse(lightJson); JSON.parse(darkJson);
      }
      const mapping=requiredRecord(JSON.parse(importValues.mapping||'{}'));
      const convert=(values:unknown,names:readonly string[])=>Object.fromEntries(Object.entries(values==null?{}:requiredRecord(values)).map(([key,value])=>{
        const index=typeof value==='number'?value:typeof value==='string'?names.indexOf(value):-1;
        if (!Number.isInteger(index) || index < 0 || index >= names.length) throw new Error('Неизвестный тип или категория: ' + value);
        return [key,index];
      }));
      const revision=getContext().revision;if(revision===null)throw new Error('Документ не открыт.');
      tokenCommand('import-design-tokens', { expectedRevision: revision, lightJson, darkJson,
        dimensionTypes: convert(mapping.dimensionTypes, types),
        dimensionCategories: convert(mapping.dimensionCategories, categories),
        numberCategories: convert(mapping.numberCategories, categories) });
    } catch (error) { setError(errorMessage(error)); }
  }
  async function exportTokens(theme?:Theme) {
    const { documentId, revision, navigationEpoch } = getContext();
    const active = () => documentId === getContext().documentId && navigationEpoch === getContext().navigationEpoch;
    if (!editable() || !documentId || !Number.isSafeInteger(revision)) return;
    setError('');
    try {
      async function readTheme(name:Theme){
        const result=requiredRecord(await request('/api/v1/documents/'+encodeURIComponent(documentId??'')+'/token-export?theme='+name+'&revision='+revision));
        const diagnostics=array(result.diagnostics??[],d=>text(requiredRecord(d).message));
        if(!result.tokens||diagnostics.length||result.revision!==revision)throw new Error(diagnostics.join('; ')||'Экспорт темы '+name+' недоступен.');
        return result.tokens;
      }
      let data;
      if (theme) data = await readTheme(theme);
      else {
        const [Light, Dark] = await Promise.all([readTheme('Light'), readTheme('Dark')]);
        data = { format: 'figvam-tokens', version: 1, themes: { Light, Dark } };
      }
      if (!active()) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = theme ? 'tokens-' + theme.toLowerCase() + '.json' : 'figvam-tokens.json';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { if (active()) setError(errorMessage(error)); }
  }
  const nameOf = (id:string) => tokenItems.find(t => t.id === id)?.name ?? 'Удалённый токен';
  // The shared control owns the literal/reference interaction; this adapter only
  // translates its values to the token command's literal/alias expression.
  const tokenIndex = () => new Map(tokenItems.map(token => [token.id, token]));
  function dependsOn(id:string|undefined,ownerId:string|undefined,theme:Theme,visited=new Set<string>()):boolean {
    if (!ownerId || !id || visited.has(id)) return false;
    if (id === ownerId) return true;
    visited.add(id);
    const expression = tokenItems.find(item => item.id === id)?.values?.[theme];
    if (expression?.expression === 'alias') return dependsOn(expression.tokenId, ownerId, theme, visited);
    if(expression?.expression==='literal'&&expression.value.type==='typographyFields'){
      const value=expression.value;return typographyFields.some(field=>{const part=value[field.name];return part?.expression==='alias'&&dependsOn(part.tokenId,ownerId,theme,visited);});
    }
    return false;
  }
  function makeTokenSpec(prefix:string,label:string,type:TokenType,category:TokenCategory|null,theme:Theme,expression?:TokenExpression|null,ownerId?:string,initialText=''):ValueSpec {
    const literal=expression?.expression==='literal'?expression.value:null;
    let direct:ValueSpec;
    if(type==='Shadow')direct=createShadowSpec(literal?.type==='shadow'?literal:null);
    else if(type==='Typography'){
      const children=typographyFields.map(field=>makeTokenSpec(prefix+'-'+field.name+'-value',field.label,field.type,field.category,theme,typographyPart(literal,field),ownerId,field.initial));
      const composite:CompositeSpec={
        kind:'composite',label,id:prefix+'-typography',children,count:children.reduce((n,child)=>n+child.count,0),
        initial:children.map(child=>child.initial),
        validate(raw){
          const values=rawArray(raw),value:TypographyFieldsValue={type:'typographyFields'};
          let offset=0;
          for(const [i,child] of children.entries()){
            const result=child.validate(values[i]??null),field=typographyFields[i];
            if(!field)throw new Error('Missing typography field');
            if(result.error)return {...result,index:offset+(result.index??0)};
            value[field.name]=asExpression(result.value);offset+=child.count;
          }
          return {value};
        },
        resolvedRaw(result){
          return typographyFields.map(field=>[field.type.toLowerCase(),result.error||result.value?.type!=='typography'||'value' in result.value?'':String(result.value[field.name]??0),'']);
        }
      };
      direct=composite;
    }else{
      direct={kind:'token-scalar',label,inputId:prefix,color:type==='Color',weight:type==='FontWeight',count:type==='Color'||type==='FontWeight'?2:1,
        initial:literal?directText(expression):initialText,
        validate(raw){try{return{value:literalExpression(type,category,rawText(raw).trim()).value};}catch(error){return{index:0,error:errorMessage(error)};}},
        resolvedRaw:result=>result.error?'':tokenValueText(result.value).replace(/ px$/,'')};
    }
    return createReferenceSpec({type,tokenType:type,tokenCategory:category},{tokens:tokenIndex()},
      expression?.expression==='alias'?{type:'token',tokenId:expression.tokenId}:null,direct,label,label,{
        theme,customDirect:true,validateChoices:true,getToken:id=>tokenItems.find(item=>item.id===id),
        getCompatible:()=>allowedAliases(type,category,ownerId??null).filter(item=>!dependsOn(item.id,ownerId,theme)),
        resolve:id=>dependsOn(id,ownerId,theme)?{value:null,error:'Цикл ссылок дизайн-токенов.'}:
          resolveTokenValue({type:'token',tokenId:id},tokenIndex(),theme,type,category)
      });
  }
  function typographyPart(value:TokenValue|null,field:TypographyPart):TokenExpression|null|undefined{
    if(value?.type==='typographyFields')return value[field.name];
    if(value?.type==='typography')return literalExpression(field.type,field.category,String(value[field.name]??(field.name==='letterSpacing'?0:field.initial)));
    return null;
  }
  const asExpression=(value:ResolvableValue|undefined):TokenExpression=>value?.type==='token'?{expression:'alias',tokenId:value.tokenId}:{expression:'literal',value:literalValue(value)};
  function readExpression(control:ValueField) {
    const result=control.validate();
    if(result.error)throw new Error(result.error);
    return asExpression(result.value);
  }
  function replaceThemeControls(hostId:string,_previous:ValueField[],type:TokenType,category:TokenCategory|null,item:DesignToken|null):ValueField[] {
    const fields=themes.map((theme,index)=>{
      const prefix=(item?'token-':'new-token-')+theme.toLowerCase();
      const spec=makeTokenSpec(prefix,theme,type,category,theme,item?.values?.[theme],item?.id);
      let field:ValueField;
      function onEdit(kind:EditKind){
        if(!item||kind==='input'||kind==='color-preview'||(busy()&&!activeThemeSave)||!editable()||selectedToken!==item.id)return;
        try{const value=readExpression(field);setError('');queueThemeSave(item.id,theme,index,value);}
        catch(error){pendingThemeValues.delete(themeKey(item.id,theme));setError(errorMessage(error));}
      }
      field=createValueField(spec,prefix,{onEdit,disabled:!!item&&!editable()});
      return field;
    });
    const view=hostId==='new-token-values'?models.createFields:models.detailFields;
    view.publish({fields});
    return fields;
  }
  // Keep the two theme drafts independent. The existing document command pipeline
  // remains serialized, but saving Light must not discard an edit made in Dark.
  function queueThemeSave(tokenId:string,theme:Theme,index:number,value:TokenExpression) {
    const baseline = activeThemeSave?.tokenId === tokenId && activeThemeSave.theme === theme
      ? activeThemeSave.value : tokenItems.find(item=>item.id===tokenId)?.values?.[theme];
    if (JSON.stringify(value) === JSON.stringify(baseline)) pendingThemeValues.delete(themeKey(tokenId,theme));
    else pendingThemeValues.set(themeKey(tokenId,theme), { tokenId, theme, index, value, documentId: getContext().documentId });
    void flushThemeSaves();
  }
  async function flushThemeSaves() {
    if (activeThemeSave || busy() || !editable() || !pendingThemeValues.size) return;
    const operation=pendingThemeValues.values().next().value;if(!operation)return;
    pendingThemeValues.delete(themeKey(operation.tokenId,operation.theme));
    if (operation.documentId !== getContext().documentId || !tokenItems.some(item => item.id === operation.tokenId)) {
      void flushThemeSaves(); return;
    }
    activeThemeSave = operation;
    const saved = await tokenCommand('set-token-value', {
      tokenId: operation.tokenId, theme: operation.index, value: operation.value
    });
    if (activeThemeSave !== operation) return;
    activeThemeSave = null;
    if (!saved) { if(!pending())pendingThemeValues.clear(); return; }
    void flushThemeSaves();
  }
  function endRename(){renaming=false;publishPanel();}
  function beginRename(){const item=selected();if(!item||!editable()||busy())return;renaming=true;renameName=item.name;publishPanel();}
  function resetTokens() {
    usageController?.abort();usageController=null;
    tokenLoad++;importEpoch++;tokenItems=[];tokenUsages=[];selectedToken=null;rendered=false;
    pendingThemeValues.clear();activeThemeSave=null;group=[];collapsed=new Set();creating=false;usagesReady=false;
    search='';selectedTypes=new Set(types);models.groups.clear();resetImport();syncTypeFilter(false);
    showEditor();commandBusy=false;detailBusy=false;models.table.clear();models.usage.clear();error='';status='';diagnostic='';
    newType='Color';newCategory='';newName='';renaming=false;renameName='';detailControls=[];models.detailFields.clear();
    updateCategoryOptions();
  }
  async function readAllTokenPages<T>(path:string,revision:number,decode:(v:unknown)=>T,signal?:AbortSignal,isCurrent?:()=>boolean):Promise<T[]>{
    const items:T[]=[];let total:number;
    do {
      const result=requiredRecord(await request(`${path}?revision=${revision}&offset=${items.length}&limit=100`,{},signal,isCurrent));
      if (result.revision !== revision || !Array.isArray(result.items) || typeof result.total!=='number'||!Number.isInteger(result.total))
        throw new Error('Некорректный ответ о токенах.');
      items.push(...result.items.map(decode)); total=result.total;
      if (!result.items.length && items.length < total) throw new Error('Неполный ответ о токенах.');
    } while (items.length < total);
    return items;
  }
  async function readTokens(base:string,revision:number,signal:AbortSignal,isCurrent:()=>boolean):Promise<Snapshot> {
    const items = await readAllTokenPages(`${base}/tokens`,revision,readToken,signal,isCurrent);
    const selection = selectedToken;
    const usages = selection && items.some(item => item.id === selection)
      ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`, revision,usage,signal,isCurrent) : [];
    return { items, selection, usages };
  }
  async function readSelectedUsages(base:string,revision:number,signal:AbortSignal,isCurrent:()=>boolean):Promise<UsageSnapshot> {
    const selection = selectedToken;
    const usages = selection ? await readAllTokenPages(`${base}/tokens/${encodeURIComponent(selection)}/usages`,
      revision,usage,signal,isCurrent) : [];
    return { selection, usages };
  }
  function applySelectedUsages({selection,usages}:UsageSnapshot) {
    if (selection !== selectedToken) { if (selectedToken) selectToken(selectedToken); return; }
    if (!usagesReady || JSON.stringify(tokenUsages) !== JSON.stringify(usages)) { usagesReady = true; tokenUsages = usages; renderTokens(true, false); }
  }
  function applyTokens(snapshot:Snapshot) {
    const before = JSON.stringify([tokenItems, tokenUsages, selectedToken]), previousItem = JSON.stringify(selected());
    tokenItems = snapshot.items;
    createControls.forEach(control => control.refresh?.());
    detailControls.forEach(control => control.refresh?.());
    if (selectedToken && selectedToken !== snapshot.selection) { selectToken(selectedToken); return; }
    if (selectedToken && !tokenItems.some(item => item.id === selectedToken)) clearSelection();
    tokenUsages = selectedToken ? snapshot.usages : []; usagesReady = !!selectedToken;
    if (!rendered || before !== JSON.stringify([tokenItems, tokenUsages, selectedToken])) {
      rendered = true;
      renderTokens(true, !activeThemeSave && previousItem !== JSON.stringify(selected()));
    }
  }

  function allowedAliases(type:TokenType,category:TokenCategory|null,excludeId:string|null=null) {
    const t = normalizedTokenType(type), c = normalizedTokenCategory(category);
    return tokenItems.filter(item => item.id !== excludeId && typeOf(item) === t && categoryOf(item) === c);
  }
  function updateCategoryOptions(){
    const choices=allowedCategories[newType]??[];
    if(!choices.includes(newCategory))newCategory=choices[0]??'';
    updateCreateMode();publishPanel();
  }
  function updateCreateMode(){
    createControls=replaceThemeControls('new-token-values',createControls,knownType(newType),normalizedTokenCategory(newCategory),null);
  }
  function renderTokens(refreshDetail = true, refreshEditor = true) {
    const filtered = filteredTokens(tokenItems, search, selectedTypes, typeOf);
    const tree = buildTokenGroups(filtered);
    let active:TokenGroup|undefined=tree;
    for(const segment of group) active=active?.children.get(segment);
    if(!active)group=[];
    const displayed=tokensInGroup(filtered,group);
    if(selectedToken&&!displayed.some(item=>item.id===selectedToken))clearSelection();
    models.groups.publish({tree,group:[...group],collapsed:new Set(collapsed),
      toggle:key=>{if(collapsed.has(key))collapsed.delete(key);else collapsed.add(key);renderTokens(false);},
      select:segments=>{group=segments;renderTokens(false);}});
    models.table.publish({tokenItems,displayed,group:[...group],search,selectedToken,usagesReady,usageCount:tokenUsages.length,
      hasTypes:selectedTypes.size>0,selectToken:id=>{if(!busy())void selectToken(id);},
      selectAlias:id=>{if(busy())return;revealToken(tokenItems.find(item=>item.id===id),true);void selectToken(id);}});
    const index=new Map(tokenItems.map(token=>[token.id,token]));
    const nameDiagnostics=tokenNameDiagnostics(tokenItems);
    const item = selected();
    updateDetailVisibility();
    if (!item || refreshDetail === false) return;
    const diagnostics=[nameDiagnostics.get(item.id)].filter((x):x is string=>!!x);
    for(const selectedTheme of themes) {
      const resolved = resolveTokenValue({ type: 'token', tokenId: item.id }, index, selectedTheme, item.type, item.category);
      if (resolved.error) diagnostics.push(selectedTheme + ': ' + resolved.error);
    }
    diagnostic=diagnostics.join(' · ');publishPanel();
    if (refreshEditor) {
      detailControls = replaceThemeControls('token-values', detailControls, typeOf(item), categoryOf(item), item);
    } else detailControls.forEach(control => control.refresh?.());
    models.usage.publish({usages:tokenUsages,ready:usagesReady,name:id=>tokenItems.find(t=>t.id===id)?.name??id,
      selectLayer:id=>{showEditor();selectLayer(id);}});
  }
  function clearSelection() {
    usageController?.abort();usageController=null;
    selectedToken = null; tokenLoad++; tokenUsages = []; usagesReady = false;
    // A presentation filter must not discard theme edits already queued for saving.
    endRename();
    detailControls=[];models.detailFields.clear();
  }
  function revealToken(item:DesignToken|undefined,navigate=false){
    if(!item)return;
    const hidden = !selectedTypes.has(typeOf(item)) || !matchesTokenSearch(item, search) ||
      !tokensInGroup([item], group).length;
    selectedTypes.add(typeOf(item)); syncTypeFilter();
    if (!matchesTokenSearch(item, search)) search = '';
    if (navigate || hidden) group = tokenSegments(item.name).slice(0,-1);
    const path = tokenSegments(item.name).slice(0,-1);
    for (let i = 0; i <= path.length; i++) collapsed.delete(groupKey(path.slice(0,i)));
  }
  async function selectToken(id:string) {
    endRename();
    usageController?.abort();const controller=new AbortController();usageController=controller;
    selectedToken = id; tokenUsages = []; creating = false; usagesReady = false;
    const current = ++tokenLoad, doc = getContext().documentId, revision = getContext().revision;
    renderTokens();
    if(!id||!doc||revision===null||!Number.isSafeInteger(revision))return;
    try {
      const items = await readAllTokenPages(`/api/v1/documents/${encodeURIComponent(doc)}/tokens/${encodeURIComponent(id)}/usages`,revision,usage,controller.signal,()=>current===tokenLoad&&doc===getContext().documentId&&revision===getContext().revision);
      if (current !== tokenLoad || doc !== getContext().documentId || revision !== getContext().revision) return;
      tokenUsages = items; usagesReady = true; setError(''); renderTokens(true, false);
    } catch (error) {
      if (!controller.signal.aborted && current === tokenLoad && doc === getContext().documentId && revision===getContext().revision) setError(errorMessage(error));
    }
  }
  async function tokenCommand(...input:TokenCommandInput):Promise<boolean|undefined>{
    const doc=getContext().documentId;if(!doc||!editable()||busy())return;
    try{
      const entry:PendingTokenCommand={operation:prepareTokenCommand(doc,...input),input,running:false};
      pendingCommands.set(doc,entry);return await executeTokenCommand(entry);
    }catch(failure){setError(errorMessage(failure));return false;}
  }
  async function executeTokenCommand(entry:PendingTokenCommand):Promise<boolean>{
    const doc=entry.operation.documentId,epoch=getContext().navigationEpoch;
    if(entry.running||!editable()||getContext().documentId!==doc||pendingCommands.get(doc)!==entry)return false;
    const [command,data,selection]=entry.input;
    stopLive();let generation=getContext().generation;const originSelection=selectedToken;
    const active=()=>getContext().documentId===doc&&getContext().navigationEpoch===epoch&&pendingCommands.get(doc)===entry;
    entry.running=true;commandBusy=true;detailBusy=command!=='set-token-value';error='';status='Сохранение…';publishPanel();
    try{
      const result=await entry.operation.execute({request,isCurrent:()=>active()&&editable(),
        synchronize:async confirmation=>{
          const {signal,current}=startRequest();generation=current;
          if(selectedToken===originSelection&&selection&&'name' in data&&'type' in data){revealToken({id:selection,name:data.name,type:data.type});selectedToken=selection;creating=false;}
          const refreshed=await readPages(signal);
          return active()&&!signal.aborted&&current===getContext().generation&&refreshed===true&&(getContext().revision??-1)>=confirmation.revision;
        }});
      if(result.kind==='confirmed'&&result.synchronization==='synced'){
        if(active()){
          if(command==='import-design-tokens'){importEpoch++;resetImport();}
          if(command==='rename-token')endRename();
          status='';
        }
        if(pendingCommands.get(doc)===entry)pendingCommands.delete(doc);
        return true;
      }
      if(result.kind==='rejected'||result.kind==='conflict'){
        const failure=result.error;
        if(active()){
          const diagnostics=failure instanceof ApiError&&Array.isArray(failure.diagnostics)?failure.diagnostics.filter(record).map(d=>String(d.path??'')+': '+String(d.message??'')).join('; '):'';
          error=diagnostics||(failure instanceof ApiError&&failure.code==='INVALID_TOKEN'&&failure.detail?failure.message+' '+failure.detail:errorMessage(failure));
        }
        if(pendingCommands.get(doc)===entry)pendingCommands.delete(doc);
      }else if(active())error=result.kind==='confirmed'?'Команда подтверждена. Повторите обновление.':'Результат неизвестен. Повторите ту же операцию.';
      return false;
    }finally{
      entry.running=false;
      if(getContext().documentId===doc&&getContext().navigationEpoch===epoch){status='';commandBusy=false;detailBusy=false;publishPanel();if(generation===getContext().generation)startLive();}
    }
  }

  function createToken(){
    try {
      const type=newType,category=allowedCategories[type]?newCategory:null;
      const name = qualifyTokenName(newName.trim(), group);
      const error = tokenNameError(name, tokenItems); if (error) throw new Error(error);
      const id=crypto.randomUUID();const [light,dark]=createControls;if(!light||!dark)throw new Error('Отсутствуют значения тем.');
      const values:Record<Theme,TokenExpression>={Light:readExpression(light),Dark:readExpression(dark)};
      tokenCommand('add-token', { tokenId: id, name, type: typeIndex(type),
        category: categoryIndex(category), values }, id);
    } catch (error) { setError(errorMessage(error)); }
  }
  function deleteToken(){
    const revision=getContext().revision;if(!selectedToken||!usagesReady||tokenUsages.length||revision===null)return;
    tokenCommand('delete-token',{tokenId:selectedToken,expectedRevision:revision});
  }
  async function renameToken(){
    const item=selected();if(!item||!editable()||busy())return;
    const name=renameName.trim();
    if (name === item.name) { endRename(); return; }
    const error = tokenNameError(name, tokenItems, item.id);
    if (error) { setError(error); return; }
    if (await tokenCommand('rename-token', { tokenId: item.id, name }) && selectedToken === item.id) endRename();
  }
  updateCategoryOptions();
  return { reset: resetTokens, clearCommands:()=>pendingCommands.clear(),discardDocument:(doc:string)=>pendingCommands.delete(doc), read: readTokens, apply: applyTokens,
    readSelectedUsages, applySelectedUsages, refreshAccess, clearBusy, get items() { return tokenItems; } };
}
