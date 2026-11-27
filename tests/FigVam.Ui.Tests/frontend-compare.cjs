const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('@playwright/test');
const [before,after,baselineRoot,candidateRoot]=process.argv.slice(2);
const readMetrics=dir=>fs.readdirSync(dir).filter(x=>/^metrics-\d+\.json$/.test(x)).map(x=>JSON.parse(fs.readFileSync(path.join(dir,x),'utf8')));
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const bundle=root=>{const dir=path.join(root,'src/FigVam.Web/dist');return fs.readdirSync(dir).filter(x=>x.endsWith('.js')).reduce((n,x)=>n+fs.statSync(path.join(dir,x)).size,0);};
(async()=>{
  const a=readMetrics(before),b=readMetrics(after);
  if(a.length!==3||b.length!==3)throw new Error('Expected three successful runs for each revision');
  const result={metrics:{},screenshots:{},samples:{baseline:a,candidate:b}};
  const notes=['# Frontend baseline comparison','', '| Metric | Baseline (median) | Candidate (median) | Change | Review |','|---|---:|---:|---:|---|'];
  function add(key,x,y,absolute,relative){
    const review=y>x*(1+relative)+absolute;
    const change=x===0?'n/a':((y/x-1)*100).toFixed(1)+'%';
    result.metrics[key]={baseline:x,candidate:y,review};
    notes.push('| '+key+' | '+x.toFixed(2)+' | '+y.toFixed(2)+' | '+change+' | '+(review?'Investigate':'Within budget')+' |');
  }
  for(const key of Object.keys(a[0])) {
    const memory=key==='heapBytes',frames=key==='dragP95FrameMs',percent=key==='dragSlowFramesPercent';
    add(key,median(a.map(x=>x[key])),median(b.map(x=>x[key])),memory?1048576:frames?3:percent?5:100,memory?.15:percent?0:.20);
  }
  add('productionJsBytes',bundle(baselineRoot),bundle(candidateRoot),20480,.10);
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    for(const file of fs.readdirSync(before).filter(x=>x.endsWith('.png'))){
      const urls=[before,after].map(dir=>'data:image/png;base64,'+fs.readFileSync(path.join(dir,file)).toString('base64'));
      result.screenshots[file]=await page.evaluate(async urls=>{
        const images=await Promise.all(urls.map(async url=>{const image=new Image();image.src=url;await image.decode();return image;}));
        const [a,b]=images;
        if(a.width!==b.width||a.height!==b.height)return {differentDimensions:true};
        const canvas=document.createElement('canvas');canvas.width=a.width;canvas.height=a.height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(a,0,0);const x=ctx.getImageData(0,0,a.width,a.height).data;
        ctx.clearRect(0,0,a.width,a.height);ctx.drawImage(b,0,0);const y=ctx.getImageData(0,0,a.width,a.height).data;
        let changed=0;
        for(let i=0;i<x.length;i+=4)if(Math.max(...[0,1,2,3].map(j=>Math.abs(x[i+j]-y[i+j])))>16)changed++;
        return {changedPixelPercent:100*changed/(a.width*a.height)};
      },urls);
    }
  }finally{await browser.close();}
  notes.push('','| Screenshot | Pixels changed (channel delta > 16) |','|---|---:|');
  for(const [name,value] of Object.entries(result.screenshots))notes.push('| '+name+' | '+(value.differentDimensions?'Different dimensions':value.changedPixelPercent.toFixed(2)+'%')+' |');
  notes.push('','Screenshots and raw samples are attached. Differences require review; this is not a visual approval. Timing budgets are investigation thresholds, not a substitute for functional tests.');
  const report=notes.join('\n');
  fs.writeFileSync(path.join(after,'comparison.json'),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(after,'comparison.md'),report);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,report+'\n');
  console.log(report);
  if(Object.values(result.metrics).some(m=>m.review))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
