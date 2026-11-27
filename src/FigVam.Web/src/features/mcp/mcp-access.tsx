import { useState } from 'react';
import type { EditorMenu } from '../../app/editor-menu';
import { createViewModel } from '../../app/view-model';
import { Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { ApiError } from '../../api/api-client';
import type { ApiClient } from '../../api/api-client';

interface Tunnel { configured: boolean; enabled: boolean; occupied: boolean }
type Access = { enabled: false; tunnel: Tunnel } | { enabled: true; endpoint: string; token: string; tunnel: Tunnel };
interface Context { title: string; documentId: string | null; token: string | null; navigationEpoch: number; role: string | null; theme: string }
interface Operation extends Context { signal: AbortSignal }
interface Capture { stop(): void; onEvent(event: unknown, signal: AbortSignal): void; onDisconnect(signal: AbortSignal): void }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
export function decodeMcpAccess(value: unknown): Access {
  if (!record(value) || typeof value.enabled !== 'boolean' || !record(value.tunnel) ||
    typeof value.tunnel.configured !== 'boolean' || typeof value.tunnel.enabled !== 'boolean' || typeof value.tunnel.occupied !== 'boolean')
    throw new TypeError('Некорректный ответ MCP-доступа.');
  const tunnel = { configured: value.tunnel.configured, enabled: value.tunnel.enabled, occupied: value.tunnel.occupied };
  if (!value.enabled) return { enabled: false, tunnel };
  if (typeof value.endpoint !== 'string' || typeof value.token !== 'string')
    throw new TypeError('Некорректные параметры MCP-доступа.');
  return { enabled: true, endpoint: value.endpoint, token: value.token, tunnel };
}
type Method = 'GET' | 'POST' | 'DELETE';
type Load = (method?: Method, tunnel?: boolean) => void;
function AccessPanel({status, load, title, valid}: {status: Access; load: Load; title: string; valid(): boolean}) {
  const [reveal, setReveal] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); if (valid()) setFeedback('Скопировано.'); }
    catch { if (valid()) setFeedback('Не удалось скопировать.'); }
  }
  return <>
    <section className="mcp-access-panel">
      {status.tunnel.configured && <strong>Прямое MCP-подключение</strong>}
      <p role="status">{status.enabled ? 'Доступ разрешён' : 'Доступ не предоставлен'}</p>
      {!status.enabled ? <>
        <p>Разрешите AI-агенту читать, редактировать и визуально проверять текущий документ.</p>
        <Button onClick={() => load('POST')}>Разрешить</Button>
      </> : <>
        <p>{title}</p>
        <label>Адрес MCP-сервера<input readOnly value={status.endpoint} /></label>
        <label>Токен доступа<input readOnly type={reveal ? 'text' : 'password'} autoComplete="off" value={status.token} /></label>
        <div className="mcp-access-actions">
          <Button onClick={() => setReveal(v => !v)}>{reveal ? 'Скрыть' : 'Показать'}</Button>
          <Button onClick={() => void copy(status.token)}>Копировать токен</Button>
          <Button className="icon-action" title="Отозвать MCP-доступ" aria-label="Отозвать MCP-доступ" onClick={() => load('DELETE')}><Trash2 size={18} aria-hidden="true" /></Button>
        </div>
        <Button onClick={() => void copy(JSON.stringify({mcpServers: {figvam: {type: 'http', url: status.endpoint, headers: {Authorization: 'Bearer ' + status.token}}}}, null, 2))}>Копировать конфигурацию MCP</Button>
        <p role="status">{feedback}</p><p>Доступ действует до отзыва или перезапуска сервера.</p>
      </>}
    </section>
    {status.tunnel.configured && <><hr/><section className="mcp-access-panel" aria-label="ChatGPT Tunnel">
      <strong>ChatGPT Tunnel</strong>
      <p role="status">{status.tunnel.enabled ? 'Доступ через ChatGPT разрешён' : status.tunnel.occupied ? 'Другой документ уже разрешён' : 'Доступ через ChatGPT не предоставлен'}</p>
      {status.tunnel.enabled ? <Button onClick={() => load('DELETE', true)}>Отозвать доступ через ChatGPT</Button>
        : status.tunnel.occupied ? <p>Сначала отзовите доступ в ранее разрешённом документе.</p>
        : <Button onClick={() => load('POST', true)}>Разрешить доступ через ChatGPT</Button>}
      <p>Запуск и остановка туннеля — в Aspire Dashboard (mcp-tunnel). Разрешение действует до отзыва или перезапуска FigVam.</p>
    </section></>}
  </>;
}
const errors: Record<string, string | undefined> = {
  MCP_ENDPOINT_NOT_CONFIGURED: 'Адрес MCP-сервера не настроен.',
  MCP_TUNNEL_NOT_CONFIGURED: 'Туннель ChatGPT не настроен.',
  MCP_TUNNEL_IN_USE: 'Другой документ уже разрешён для ChatGPT. Сначала отзовите доступ в нём.'
};
type McpViewState={kind:'loading'}|{kind:'ready';props:Parameters<typeof AccessPanel>[0]}|{kind:'error';message:string;reload():void};
function McpView({state}:{state:McpViewState}){
  if(state.kind==='loading')return <p>Загрузка MCP-доступа…</p>;
  if(state.kind==='ready')return <AccessPanel {...state.props}/>;
  return <><p role="alert">{state.message}</p><Button onClick={state.reload}>Обновить</Button></>;
}
export function createMcpAccessModel(){return createViewModel(McpView);}
export function createMcpAccess({model,request,getContext,capture,menu}:{model:ReturnType<typeof createMcpAccessModel>;request:ApiClient;getContext():Context;capture:Capture;menu:EditorMenu}) {
  const isOpen = () => menu.getSnapshot() === 'mcp';
  let controller: AbortController | null = null, current: Operation | null = null;
  const valid = (operation: Operation) => {
    const context = getContext();
    return isOpen() && current === operation && !operation.signal.aborted &&
      context.documentId === operation.documentId && context.token === operation.token && context.navigationEpoch === operation.navigationEpoch;
  };
  function clear() {
    controller?.abort(); controller = null; current = null;
    model.clear();
  }
  function reset() { capture.stop(); menu.close('mcp'); clear(); }
  async function load(method: Method = 'GET', tunnel = false) {
    clear();
    const context = getContext();
    if (!context.documentId || !isOpen()) return;
    controller = new AbortController();
    const operation: Operation = {...context, signal: controller.signal}; current = operation;
    model.publish({state:{kind:'loading'}});
    try {
      const path = '/api/v1/documents/' + encodeURIComponent(context.documentId) + '/mcp-access';
      if (tunnel) {
        await request(path + '/tunnel', {method}, operation.signal, () => valid(operation));
        if (!valid(operation)) return;
      }
      const response = await request(path, {method: tunnel ? 'GET' : method}, operation.signal, () => valid(operation));
      if (!valid(operation)) return;
      const status = decodeMcpAccess(response);
      model.publish({state:{kind:'ready',props:{status,load,title:getContext().title,valid:()=>valid(operation)}}});
    } catch (error) {
      if (!valid(operation) || (error instanceof Error && error.name === 'AbortError')) return;
      const message = (error instanceof ApiError && error.code ? errors[error.code] : undefined) ?? (error instanceof Error ? error.message : String(error));
      model.publish({state:{kind:'error',message,reload:()=>void load()}});
    }
  }
  const unsubscribe = menu.subscribe(() => { if (isOpen()) void load(); else clear(); });
  function dispose() { unsubscribe(); reset(); }
  return {reset, dispose, onCaptureEvent: capture.onEvent, onCaptureDisconnect: capture.onDisconnect};
}
