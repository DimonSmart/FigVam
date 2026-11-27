import {describe,it,expect} from 'vitest';
import {createEditorMenu} from '../src/app/editor-menu';
describe('editor menu',()=>{it('keeps one menu active and closes only the intended scope',()=>{const menu=createEditorMenu();menu.toggle('file');menu.closeRows();expect(menu.getSnapshot()).toBe('file');menu.publish('page:1');menu.close('file');expect(menu.getSnapshot()).toBe('page:1');menu.closeRows();expect(menu.getSnapshot()).toBeNull();menu.toggle('palette');menu.toggle('palette');expect(menu.getSnapshot()).toBeNull();});});
