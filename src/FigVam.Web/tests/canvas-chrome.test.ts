import { describe,expect,it } from 'vitest';
import { createCanvasChrome } from '../src/app/canvas-chrome';
import { createPreviewChrome } from '../src/app/preview-chrome';
describe('renderer chrome',()=>{
  it('does not publish unchanged rounded zoom and keeps UI snapshots independent of geometry',()=>{
    const chrome=createCanvasChrome();let changes=0;const stop=chrome.subscribe(()=>changes++);
    chrome.patch({zoomPercent:100});chrome.patch({zoomPercent:125});chrome.patch({zoomPercent:125});
    expect(changes).toBe(1);expect(chrome.getSnapshot().zoomPercent).toBe(125);stop();
  });
  it('deduplicates renderer diagnostics without replacing unrelated mode state',()=>{
    const chrome=createPreviewChrome();chrome.patch({active:true,theme:'Dark'});
    chrome.preview.addDiagnostic('missing asset');chrome.preview.addDiagnostic('missing asset');
    expect(chrome.preview.getSnapshot().diagnostics).toEqual(['missing asset']);expect(chrome.design.getSnapshot().diagnostics).toEqual([]);
    expect(chrome.getSnapshot().theme).toBe('Dark');
  });
});
