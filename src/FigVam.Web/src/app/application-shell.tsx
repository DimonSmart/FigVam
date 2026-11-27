import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ApplicationViews } from './application-views';
import { EditorShell, type EditorShellController } from '../features/editor/editor-shell';

/** The application shell is mounted once. Feature views are declared directly;
 * the shell never reparents DOM elements. */
export function ApplicationShell({shell,views}:{shell:EditorShellController;views:ApplicationViews}){
  const signoutLabel=useSyncExternalStore(shell.signoutLabel.subscribe,shell.signoutLabel.getSnapshot);
  return <>
    <a className="skip" href="#content">{"К содержимому"}</a>
    <header className="brand">
      <a className="brand-mark" href="/" data-navigation="">
        <span className="brand-symbol" aria-hidden="true">{"F"}</span>
        {"FigVam"}
      </a>
      <span className="brand-section">{"Рабочее пространство"}</span>
      <button id="disconnect" hidden onClick={shell.signOut}>
        {signoutLabel}
      </button>
    </header>
    <div id="authentication-root"><views.authentication.Component/></div>
    <main id="content" tabIndex={-1} hidden>
      <section id="delete-result" hidden aria-label="Удаление документа">
        <p id="delete-message" role="alert"/>
        <button id="delete-retry" type="button" hidden>{"Повторить проверку удаления"}</button>
      </section>
      <div id="documents-view" hidden>
        <div className="home-layout">
          <aside className="home-sidebar" aria-label="Разделы рабочего пространства">
            <p className="home-sidebar-title">{"Рабочее пространство"}</p>
            <nav id="home-navigation" className="home-navigation" aria-label="Навигация"><views.homeNavigation.Component/></nav>
            <div className="home-sidebar-footer">
              {"FigVam"}
              <br/>
              {"Редактор интерфейсов"}
            </div>
          </aside>
          <div className="home-main">
            <section id="home-documents-content" aria-labelledby="home-documents-title">
              <div className="home-heading">
                <div>
                  <p className="eyebrow">{"Мои проекты"}</p>
                  <h1 id="home-documents-title">{"Документы"}</h1>
                  <p className="home-description">{"Макеты, компоненты и прототипы интерфейсов"}</p>
                </div>
                <button id="refresh" className="home-refresh" type="button">{"Обновить список"}</button>
              </div>
              <div className="home-content-grid">
                <section className="home-projects" aria-labelledby="recent-documents-title">
                  <div className="home-section-heading">
                    <h2 id="recent-documents-title">{"Все документы"}</h2>
                    <span className="home-count" id="home-count"/>
                  </div>
                  <ul id="document-list" aria-label="Доступные документы"><views.documentList.Component/></ul>
                  <div id="home-empty" className="home-empty" hidden>
                    <strong>{"Пока нет документов"}</strong>
                    <p>{"Создайте документ или откройте существующий файл."}</p>
                  </div>
                  <nav id="home-pagination" className="pagination home-pagination" aria-label="Страницы списка">
                    <button id="previous" type="button" disabled>{"Предыдущая"}</button>
                    <span id="page-number"/>
                    <button id="next" type="button" disabled>{"Следующая"}</button>
                  </nav>
                </section>
                <aside className="home-actions" aria-label="Действия с документами">
                  <section className="home-action-card" aria-labelledby="create-title">
                    <div className="home-action-icon" aria-hidden="true">{"+"}</div>
                    <h2 id="create-title">{"Новый документ"}</h2>
                    <p>{"Создайте макет и начните работу в редакторе."}</p>
                    <form id="create-form" className="create">
                      <label htmlFor="document-name">{"Имя нового документа"}</label>
                      <input id="document-name" required maxLength={256} autoComplete="off" placeholder="Например, LoginDialog"/>
                      <button type="submit">{"Создать документ"}</button>
                    </form>
                  </section>
                  <section className="home-action-card home-action-secondary" aria-labelledby="import-title">
                    <h2 id="import-title">{"Импорт документа"}</h2>
                    <p>{"Загрузите ранее сохранённый дизайн."}</p>
                    <form id="import-form">
                      <label id="import-file-label" htmlFor="import-file">{"Файл документа (document.json или .figvam)"}</label>
                      <div className="home-file-picker">
                        <input id="import-file" className="home-file-input" type="file" accept=".json,.figvam,application/json,application/zip" aria-labelledby="import-file-label" required/>
                        <span className="home-file-trigger" aria-hidden="true">{"Выбрать файл"}</span>
                        <span id="import-file-name" className="home-file-name" aria-live="polite">{"Файл не выбран"}</span>
                      </div>
                      <button type="submit">{"Открыть файл как новый документ"}</button>
                      <p id="import-status" role="status" aria-live="polite"/>
                      <p id="import-error" role="alert"/>
                      <ul id="import-diagnostics" aria-label="Диагностика импорта"/>
                    </form>
                  </section>
                </aside>
              </div>
            </section>
            <section id="home-admin-content" aria-labelledby="home-admin-title" hidden>
              <div className="home-heading">
                <div>
                  <p className="eyebrow">{"Настройки пространства"}</p>
                  <h1 id="home-admin-title">{"Пользователи"}</h1>
                  <p className="home-description">{"Управление доступом к FigVam"}</p>
                </div>
              </div>
              <views.userAdmin.Component/>
            </section>
          </div>
        </div>
      </div>
      <div id="editor-view" hidden>
        <EditorShell shell={shell} views={views}/>
        <section id="editor-preview" aria-labelledby="preview-title" hidden>
          <header className="document-panel">
            <h1 id="preview-title">{"Preview"}</h1>
            <button id="close-preview" type="button">{"Вернуться в Design"}</button>
            <button id="preview-back" type="button" disabled>{"Назад по сценарию"}</button>
            <button id="preview-reset" type="button">{"Сбросить Preview"}</button>
            <div className="preview-theme-control">
              <span id="preview-theme-label">{"Тема"}</span>
              <div id="preview-theme" className="theme-segments" role="group" aria-labelledby="preview-theme-label">
                <button type="button" data-theme="Light" aria-pressed="true" aria-label="Светлая тема" title="Светлая тема (Light)">
                  <Sun size={18} strokeWidth={1.8} aria-hidden="true"/>
                </button>
                <button type="button" data-theme="Dark" aria-pressed="false" aria-label="Тёмная тема" title="Тёмная тема (Dark)">
                  <Moon size={18} strokeWidth={1.8} aria-hidden="true"/>
                </button>
              </div>
            </div>
          </header>
          <p id="preview-render-status" role="status"/>
          <button id="preview-render-retry" type="button" hidden>{"Повторить загрузку Preview"}</button>
          <ul id="preview-render-diagnostics" aria-label="Диагностика Preview"/>
          <div id="preview-viewport" role="region" aria-label="Экран Preview"/>
        </section>
      </div>
    </main>
    <div className="feedback">
      <p id="status" role="status" aria-live="polite"/>
      <p id="error" role="alert"/>
      <button id="retry" hidden>{"Повторить запрос"}</button>
    </div>
  </>;
}
