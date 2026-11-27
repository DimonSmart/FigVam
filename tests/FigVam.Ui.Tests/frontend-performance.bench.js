const { test, expect, bearer } = require('./fixtures');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');

const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const number = value => ({ type: 'number', value });
const geometry = (x,y,width,height) => ({ x:number(x), y:number(y), width:number(width), height:number(height) });
const output = process.env.FIGVAM_BENCH_OUTPUT;
if (!output) throw new Error('Set FIGVAM_BENCH_OUTPUT to an absolute output directory');

test('compare browser editor on a deterministic document', async ({ page, request }, info) => {
  test.setTimeout(180000);
  const size = 100;
  const documentId=id(1), pageId=id(2), screen=id(3), target=id(4), base='/api/v1/documents/'+documentId;
  const headers = { Authorization: 'Bearer '+bearer };
  async function post(url,data) {
    const response = await request.post(url,{headers,data});
    expect(response.ok(),await response.text()).toBeTruthy();
  }
  const command = (name,data) => post(base+'/commands/'+name,{commandId:randomUUID(),...data});
  await post('/api/v1/documents',{documentId,name:'Frontend benchmark'});
  await command('add-page',{pageId});
  await command('add-screen',{pageId,screenId:screen,dimensions:{width:800,height:600}});
  await command('add-node',{nodeId:target,parentId:screen,kind:'Button',properties:{...geometry(40,40,160,48),text:{type:'string',value:'Edit me'}}});
  for(let i=0;i<size;i++) await command('add-node',{nodeId:id(10+i),parentId:screen,kind:'Text',
    properties:{...geometry(20+(i%10)*76,130+Math.floor(i/10)*38,70,28),text:{type:'string',value:'Item '+i}}});

  await page.setViewportSize({width:1800,height:1100});
  const times={};
  async function time(name, action) {const start=performance.now();await action();times[name]=performance.now()-start;}
  await time('initialLoadMs',async()=>{
    await page.goto('/documents/'+documentId);
    await expect(page.getByLabel('Bearer-токен',{exact:true})).toBeVisible();
  });
  await page.getByLabel('Bearer-токен',{exact:true}).fill(bearer);
  await time('openDocumentMs',async()=>{
    await page.getByRole('button',{name:'Продолжить',exact:true}).click();
    await expect(page.locator('#screens button').first()).toBeVisible();
  });
  await time('largeScreenMs',async()=>{
    await page.locator('#screens button').first().click();
    await expect(page.locator('#screen-boundary [data-visual-node]')).toHaveCount(size+1);
    await expect(page.locator('#connection-status')).toContainText('Подключено',{timeout:15000});
  });
  await page.locator('#actual-size').click();
  const node=page.locator('[data-visual-node="'+target+'"]');
  await time('selectionMs',async()=>{
    await node.locator('.visual-surface').click();
    await expect(page.locator('#visual-property-text')).toBeVisible();
  });
  await page.evaluate(()=>document.fonts.ready);
  fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,'selected-'+info.repeatEachIndex+'.png'),animations:'disabled'});
  await time('propertyEditMs',async()=>{
    await page.locator('#visual-property-text').fill('Edited text');
    await expect(page.locator('#visual-inspector-status')).toHaveText('Свойства сохранены.');
  });
  const box=await node.boundingBox();
  expect(box).not.toBeNull();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.evaluate(()=>{
    window.__benchFrames=[];
    let previous=performance.now();
    window.__benchRaf=requestAnimationFrame(function frame(now){
      window.__benchFrames.push(now-previous); previous=now;
      window.__benchRaf=requestAnimationFrame(frame);
    });
  });
  await time('dragMs',async()=>{
    await page.mouse.move(x+60,y+30,{steps:60});
    await expect(node).toHaveCSS('left','100px');
  });
  const frames=await page.evaluate(()=>{
    cancelAnimationFrame(window.__benchRaf);
    return window.__benchFrames;
  });
  await page.mouse.up();
  await expect(page.locator('#canvas-edit-status')).toHaveText('Геометрия сохранена.');
  expect(frames.length).toBeGreaterThan(0);
  const sorted=[...frames].sort((a,b)=>a-b);
  times.dragP95FrameMs=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))];
  times.dragSlowFramesPercent=100*frames.filter(x=>x>33.4).length/frames.length;
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap=await cdp.send('Runtime.getHeapUsage');
  times.heapBytes=heap.usedSize;
  await cdp.detach();
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  await expect(page.locator('#editor-preview')).toBeVisible();
  await page.screenshot({path:path.join(output,'preview-'+info.repeatEachIndex+'.png'),animations:'disabled'});
  await page.getByRole('group',{name:'Тема',exact:true}).getByRole('button',{name:'Тёмная тема'}).click();
  await page.screenshot({path:path.join(output,'preview-dark-'+info.repeatEachIndex+'.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Вернуться в Design'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(output,'mobile-'+info.repeatEachIndex+'.png'),animations:'disabled'});
  fs.writeFileSync(path.join(output,'metrics-'+info.repeatEachIndex+'.json'),JSON.stringify(times,null,2));
});
