import { renderModelPng } from './screen-capture';
import { readRenderModel, number } from './render-model';
import { requiredRecord, text } from '../api/decode';

const result=document.getElementById('result');
if(!result)throw new Error('Missing capture result host');
try{
  const node=document.getElementById('snapshot');
  if(!node?.textContent)throw new Error('Missing render snapshot');
  const snapshot=requiredRecord(JSON.parse(node.textContent));
  node.remove();
  const model=readRenderModel(snapshot);
  const data=requiredRecord(snapshot.assetData), values=requiredRecord(snapshot.values);
  const png=await renderModelPng(model,number(snapshot.width),number(snapshot.height),id=>
    Promise.resolve(new Blob([Uint8Array.from(atob(text(data[id])),c=>c.charCodeAt(0))],{type:'image/png'})),
    Object.fromEntries(Object.entries(values).map(([id,v])=>[id,v==null?null:text(v)])),new AbortController().signal);
  const url=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Invalid image'));
    reader.onerror=reject;reader.readAsDataURL(png);
  });
  const encoded=url.split(',')[1];if(!encoded)throw new Error('Empty image');
  result.textContent='PNG:'+encoded;
}catch{result.textContent='CAPTURE_FAILED';}
