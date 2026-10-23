import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {translations} from './i18n.js';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
let compressorWorker;
async function initializeApp(){
  const loader=document.getElementById('startupLoader'),shell=document.getElementById('appShell'),bar=document.getElementById('startupBar'),percent=document.getElementById('startupPercent'),text=document.getElementById('startupText');
  const update=(value,label)=>{bar.style.width=`${value}%`;percent.textContent=`${value}%`;text.textContent=label;};
  try{
    update(20,'Loading PDF.js…');
    await new Promise(resolve=>requestAnimationFrame(resolve));
    update(55,'Preparing local PDF tools…');
    await new Promise(resolve=>requestAnimationFrame(resolve));
    update(85,'Initializing editor…');
    await new Promise(resolve=>requestAnimationFrame(resolve));
    update(100,'Ready');
    await new Promise(resolve=>setTimeout(resolve,180));
    loader.remove();shell.hidden=false;
  }catch(error){text.textContent='Resource loading failed. Please refresh.';console.error('Startup initialization failed',error);}
}
initializeApp();
function compressPdfWithGhostscript(bytes,ratio,totalPages){return new Promise((resolve,reject)=>{
  const started=performance.now(),id=crypto.randomUUID();console.info(`[PDF compressor ${id}] request`,{inputBytes:bytes.byteLength,ratio,totalPages});
  if(!compressorWorker)compressorWorker=new Worker(new URL('./compress.worker.js',import.meta.url),{type:'module',name:'pdf-compressor'});
  const worker=compressorWorker;let settled=false,outputDoc;setCompressionProgress(0,totalPages,'Starting compression…');
  const cleanup=()=>{clearTimeout(timeout);worker.removeEventListener('message',onMessage);worker.removeEventListener('error',onError);worker.removeEventListener('messageerror',onMessageError);};
  const finish=(callback,value)=>{if(settled)return;settled=true;cleanup();if(callback===resolve){setCompressionProgress(totalPages,totalPages,'Compression complete');compressionProgressHideTimer=setTimeout(()=>hideCompressionProgress(),1800);}else hideCompressionProgress();callback(value);};
  const timeout=setTimeout(()=>{worker.terminate();if(compressorWorker===worker)compressorWorker=null;finish(reject,new Error('PDF compression timed out after 5 minutes'));},300000);
  const acknowledge=(current,error)=>worker.postMessage({type:'ack',id,current,error:error?.message});
  const onMessage=async event=>{const data=event.data;if(data.id!==id)return;
    if(data.type==='stage'){const labels={received:'Preparing compression…','engine-init':'Loading compression engine…','engine-ready':'Compression engine ready','engine-loaded':'Preparing PDF…','input-ready':'Starting page compression…','page-start':`Compressing page ${data.details?.current||''}/${data.details?.total||totalPages}`};show('',labels[data.stage]||'Compressing PDF…');return;}
    if(data.type==='log'){console.debug(`[Ghostscript ${id}]`,data.level||'info',data.text);return;}
    if(data.error){finish(reject,new Error(data.error));return;}
    if(data.type==='page'){
      const current=Number(data.current),total=Number(data.total)||totalPages;
      try{if(!outputDoc)outputDoc=await PDFDocument.create();const pageDoc=await PDFDocument.load(data.pagePdf);const [copied]=await outputDoc.copyPages(pageDoc,[0]);outputDoc.addPage(copied);setCompressionProgress(current,total,'Compressing PDF');show('',`Compressing PDF (${current}/${total})`);console.info(`[PDF compressor ${id}] actual page completed ${current}/${total}`);acknowledge(current);}catch(error){acknowledge(current,error);finish(reject,error);}return;
    }
    if(data.type==='done'){try{if(!outputDoc||outputDoc.getPageCount()!==totalPages)throw new Error(`Compressed ${outputDoc?.getPageCount()||0} of ${totalPages} pages`);const result=await outputDoc.save();console.info(`[PDF compressor ${id}] done`,{outputBytes:result.length,elapsedMs:Math.round(performance.now()-started)});finish(resolve,result);}catch(error){finish(reject,error);}}
  };
  const onError=event=>{console.error(`[PDF compressor ${id}] worker error`,event.message,event.filename,event.lineno);if(compressorWorker===worker)compressorWorker=null;finish(reject,new Error(event.message||'PDF compression worker crashed'));};
  const onMessageError=()=>finish(reject,new Error('Could not read compression worker response'));
  worker.addEventListener('message',onMessage);worker.addEventListener('error',onError);worker.addEventListener('messageerror',onMessageError);
  try{const copy=bytes.slice();worker.postMessage({id,bytes:copy.buffer,ratio,totalPages},[copy.buffer]);}catch(error){finish(reject,error);}
});}


const $ = id => document.getElementById(id);
let sources = [], pages = [], selected = new Set(), order = [], outputUrl = null, usedBytes = 0, language='en';
function applyLanguage(){const t=translations[language];document.documentElement.lang=language;document.querySelector('.upload strong').textContent=t.upload;document.querySelector('.files h3').textContent=t.uploaded;document.querySelector('#sizeSetting h3').textContent=t.pageSize;document.querySelector('#pagesSetting h3').textContent=t.keepPages;document.querySelector('#compressSetting h3').textContent=t.compress;document.querySelector('#processBtn').textContent=t.apply;document.querySelector('#downloadBtn').textContent=t.download;document.querySelector('.download-name-label').textContent=t.fileName;document.querySelector('#pages').placeholder=t.placeholder;document.querySelector('.preview-box .help').textContent=t.pageHelp;document.querySelector('#languageToggle').checked=language==='zh';}
$('themeToggle').onchange=()=>{document.body.classList.toggle('dark',$('themeToggle').checked);localStorage.setItem('pdf-editor-theme',$('themeToggle').checked?'dark':'light');};
$('languageToggle').onchange=()=>{language=$('languageToggle').checked?'zh':'en';applyLanguage();localStorage.setItem('pdf-editor-language',language);};
const savedTheme=localStorage.getItem('pdf-editor-theme');if(savedTheme==='dark'){document.body.classList.add('dark');$('themeToggle').checked=true;}language=localStorage.getItem('pdf-editor-language')==='zh'?'zh':'en';applyLanguage();
const area = $('uploadArea'), LIMIT = 500 * 1024 * 1024, MAX_PAGES = 300;
function setLoadStatus(text){$('loadStatusText').textContent=text;}
let compressionProgressHideTimer;
function setCompressionProgress(current,total,label='Compressing PDF'){const panel=$('compressionProgress'),bar=$('compressionProgressBar'),count=$('compressionProgressCount'),caption=$('compressionProgressLabel');clearTimeout(compressionProgressHideTimer);const max=Math.max(0,Number(total)||0),value=Math.min(max,Math.max(0,Number(current)||0)),percent=max?Math.round(value/max*100):0;panel.hidden=false;caption.textContent=label;count.textContent=`${value}/${max||'?'}`;bar.style.width=`${percent}%`;bar.setAttribute('aria-valuenow',String(percent));bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');}
function hideCompressionProgress(){clearTimeout(compressionProgressHideTimer);$('compressionProgress').hidden=true;$('compressionProgressBar').style.width='0%';}
function setUploadProgress(percent){$('uploadProgressBar').style.width=`${Math.max(0,Math.min(100,percent))}%`;}
const fileInput = $('fileInput');
area.addEventListener('click', event => { if(event.target !== fileInput) fileInput.click(); });
area.addEventListener('dragenter', event => { event.preventDefault(); event.stopPropagation(); area.classList.add('drag'); });
area.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); if(event.dataTransfer) event.dataTransfer.dropEffect='copy'; area.classList.add('drag'); });
area.addEventListener('dragleave', event => { event.preventDefault(); if(!area.contains(event.relatedTarget)) area.classList.remove('drag'); });
area.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); area.classList.remove('drag'); const files=[...(event.dataTransfer?.files||[])]; if(files.length) choose(files); });
fileInput.addEventListener('change', event => { const files=[...(event.target.files||[])]; if(files.length) choose(files); event.target.value = ''; });
function choose(files) {
  if (files.some(f => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'))) return show('error', 'Only PDF files are supported');
  const total = usedBytes + files.reduce((n, f) => n + f.size, 0);
  if (files.some(f => f.size > LIMIT)) return show('error', 'A single file cannot exceed 500 MB');
  if (total > LIMIT) return show('error', 'Total file size cannot exceed 500 MB');
  loadFiles(files);
}
function setProgress(percent){setUploadProgress(percent);if(percent>=100)setLoadStatus('Success');else if(percent>0)setLoadStatus('Uploading…');else setLoadStatus('Waiting…');}
function readFileWithProgress(file,onProgress){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total)};reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||new Error('File read failed'));reader.onabort=()=>reject(new Error('File reading cancelled'));reader.readAsArrayBuffer(file);});}
async function loadFiles(files) {
  const btn = $('processBtn'); btn.disabled = true; show('', 'Uploading…');
  const totalBytes=files.reduce((sum,file)=>sum+file.size,0)||1;let readBytes=0;
  setProgress(0);
  try {
    const added = [];
    for (const [fileIndex,file] of files.entries()) {
      const pagesBeforeLoading=pages.length;
      const bytes = await readFileWithProgress(file,fraction=>setProgress((readBytes+file.size*fraction)/totalBytes*45));
      readBytes+=file.size;setProgress(readBytes/totalBytes*45);
      const doc = await pdfjs.getDocument({data: bytes.slice(0)}).promise;
      const pdf = await PDFDocument.load(bytes, {ignoreEncryption:false});
      if (pagesBeforeLoading + doc.numPages > MAX_PAGES) throw new Error(`最多支持 ${MAX_PAGES} 页，请拆分 PDF 后再试`);
      const entry = {file, bytes, pdf, doc}; added.push(entry);
      const pagesBeforeFile=pages.length;
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i); const viewport = p.getViewport({scale:.75});
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await p.render({canvasContext:canvas.getContext('2d'), viewport}).promise;
        pages.push({source:entry, index:i-1, image:canvas.toDataURL('image/jpeg',.9)}); canvas.width=0; canvas.height=0;
        setProgress(45+((fileIndex+(pages.length-pagesBeforeFile)/doc.numPages)/files.length)*55);
        if(i%2===0) await new Promise(resolve=>requestAnimationFrame(resolve));
      }
    }
    const wasEmpty=sources.length===0;sources.push(...added); if(wasEmpty)$('downloadName').value=defaultDownloadName(); usedBytes += files.reduce((n,f)=>n+f.size,0); selected = new Set(pages.map((_,i)=>i)); order = pages.map((_,i)=>i);
    $('memoryText').textContent = `${(usedBytes/1048576).toFixed(2)} MB / 500 MB`; $('memoryBar').style.width = Math.min(100, usedBytes/LIMIT*100)+'%';
    renderFileList();
    $('pages').value=''; $('downloadBtn').classList.remove('show'); render(); markChanged(); setProgress(100); show('ok', 'Ready');
  } catch (err) { show('error', `Load failed: ${err.message || 'Unsupported or encrypted PDF'}`); }
  finally { btn.disabled = false; }
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function defaultDownloadName(){const name=sources[0]?.file?.name||'document.pdf';return `${name.replace(/\.pdf$/i,'')}_edited.pdf`;}
function renderFileList(){const list=$('fileList');if(!sources.length){list.innerHTML='<div class="hint">No files</div>';return;}list.innerHTML=sources.map((s,i)=>`<div class="file-entry"><b>${i+1}</b><span title="${escapeHtml(s.file.name)}">${escapeHtml(s.file.name)}</span><button class="file-remove" type="button" data-file-index="${i}" title="Remove this PDF and all its pages" aria-label="Remove ${escapeHtml(s.file.name)}">×</button></div>`).join('');list.querySelectorAll('.file-remove').forEach(button=>button.onclick=()=>removeFile(Number(button.dataset.fileIndex)));}
function removeFile(fileIndex){const [removed]=sources.splice(fileIndex,1);if(!removed)return;removed.doc.destroy();usedBytes-=removed.file.size;const kept=pages.filter(page=>page.source!==removed);const oldToNew=new Map();pages.forEach((page,index)=>{if(page.source!==removed)oldToNew.set(index,kept.indexOf(page));});const keepSelected=[...selected].map(index=>oldToNew.get(index)).filter(index=>index!==undefined);const keepOrder=order.map(index=>oldToNew.get(index)).filter(index=>index!==undefined);pages=kept;selected=new Set(keepSelected);order=keepOrder;if(outputUrl){URL.revokeObjectURL(outputUrl);outputUrl=null;}$('downloadBtn').classList.remove('show');$('memoryText').textContent=usedBytes?`${(usedBytes/1048576).toFixed(2)} MB / 500 MB`:'0 B / 500 MB';$('memoryBar').style.width=Math.min(100,usedBytes/LIMIT*100)+'%';renderFileList();render();syncPages();markChanged();setProgress(0);show('ok',`Removed “${removed.file.name}” and all its pages.`);}
function render(){const box=$('preview');box.innerHTML='';order.forEach(idx=>{const p=pages[idx];if(!p)return;const el=document.createElement('div');el.className='thumb '+(selected.has(idx)?'selected':'');el.draggable=true;el.innerHTML=`${selected.has(idx)?'<input type="checkbox" checked>':''}<button class="zoom" title="Open high-resolution preview">⌕</button><img loading="lazy" src="${p.image}"><span>Page ${idx+1} · ${escapeHtml(p.source.file.name)}</span>`;el.onclick=e=>{if(e.target.classList.contains('zoom')||e.target.tagName==='INPUT')return;toggle(idx)};if(selected.has(idx))el.querySelector('input').onchange=()=>toggle(idx);el.querySelector('.zoom').onclick=e=>{e.stopPropagation();openOriginalPreview(p)};el.ondragstart=e=>e.dataTransfer.setData('text/plain',idx);el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();const from=order.indexOf(+e.dataTransfer.getData('text/plain')),to=order.indexOf(idx);if(from<0||to<0)return;const [v]=order.splice(from,1);order.splice(to,0,v);render();markChanged()};box.appendChild(el)});$('pageCount').textContent=`Showing ${selected.size} / ${pages.length} pages`;}
async function openOriginalPreview(pageInfo){const modal=$('modal'),img=$('largeImage');modal.classList.add('show');img.style.display='none';show('','Rendering preview…');try{const page=await pageInfo.source.doc.getPage(pageInfo.index+1);const cssScale=Math.min(3,Math.max(1.5,window.devicePixelRatio||1));const viewport=page.getViewport({scale:cssScale});const outputScale=Math.min(4,Math.max(2,window.devicePixelRatio||1));const renderViewport=page.getViewport({scale:cssScale*outputScale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(renderViewport.width);canvas.height=Math.ceil(renderViewport.height);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;await page.render({canvasContext:canvas.getContext('2d'),viewport:renderViewport}).promise;img.src=canvas.toDataURL('image/png');img.style.display='block';show('','');}catch(err){modal.classList.remove('show');show('error',`Preview failed: ${err.message||err}`)}}
function toggle(i){selected.has(i)?selected.delete(i):selected.add(i);syncPages();render();markChanged();}
function parseLocal(v){if(!v.trim())return [...order];const out=[];for(const t of v.split(/[\s,，;；]+/)){if(!t)continue;const m=t.match(/^(\d+)(?:[-~至](\d+))?$/);if(!m)return null;const a=+m[1],b=+(m[2]||m[1]);if(a<1||b>pages.length||a>b)return null;for(let i=a;i<=b;i++)if(!out.includes(i-1))out.push(i-1);}return out;}
function syncPages(){const sorted=[...selected].map(i=>i+1).sort((a,b)=>a-b);if(sorted.length===pages.length){$('pages').value='';return}const ranges=[];for(let i=0;i<sorted.length;){let a=sorted[i],b=a;while(i+1<sorted.length&&sorted[i+1]===b+1)b=sorted[++i];ranges.push(a===b?`${a}`:`${a}-${b}`);i++;}$('pages').value=ranges.join(' ');}
$('pages').oninput=()=>{const wanted=parseLocal($('pages').value);if(wanted){selected=new Set(wanted);render()}markChanged()};$('pageSize').onchange=markChanged;$('compressionEnabled').onchange=()=>{document.getElementById('compressionOptions').hidden=!$('compressionEnabled').checked;markChanged()};$('compressionRatio').oninput=()=>{$('compressionRatioValue').textContent=`${$('compressionRatio').value}%`;markChanged()};
function markChanged(){$('sizeSetting').classList.toggle('changed',$('pageSize').value!=='original');$('pagesSetting').classList.toggle('changed',$('pages').value.trim()!==''&&selected.size!==pages.length);$('compressSetting').classList.toggle('changed',$('compressionEnabled').checked)}
$('closeModal').onclick=()=>$('modal').classList.remove('show');$('modal').onclick=e=>{if(e.target.id==='modal')$('modal').classList.remove('show')};
$('processBtn').onclick=async()=>{if(!pages.length)return show('error','Please upload a PDF first');const chosen=parseLocal($('pages').value);if(!chosen?.length)return show('error','Keep at least one page and use a valid page range');const btn=$('processBtn'),job=crypto.randomUUID(),started=performance.now();btn.disabled=true;show('','Preparing PDF…');console.info(`[PDF job ${job}] started`,{pageCount:chosen.length,compression:$('compressionEnabled').checked,ratio:$('compressionRatio').value});try{const out=await PDFDocument.create();const size=$('pageSize').value;const dims={A4:[595.28,841.89],A3:[841.89,1190.55]};for(const [pageIndex,idx] of order.filter(i=>chosen.includes(i)).entries()){const item=pages[idx], [copy]=await out.copyPages(item.source.pdf,[item.index]);if(size!=='original'){const [w,h]=dims[size],old=copy.getSize(),tw=old.width>old.height?h:w,th=old.width>old.height?w:h,scale=Math.min(tw/old.width,th/old.height);const embedded=await out.embedPage(copy);const target=out.addPage([w,h]);target.drawPage(embedded,{x:(w-old.width*scale)/2,y:(h-old.height*scale)/2,width:old.width*scale,height:old.height*scale});}else out.addPage(copy);if(pageIndex===0||pageIndex%10===9||pageIndex===chosen.length-1){show('',`Preparing PDF… ${pageIndex+1}/${chosen.length} pages`);console.info(`[PDF job ${job}] copied page ${pageIndex+1}/${chosen.length}`);await new Promise(resolve=>setTimeout(resolve,0));}}let bytes=await out.save();console.info(`[PDF job ${job}] pdf-lib output ready`,{bytes:bytes.length,elapsedMs:Math.round(performance.now()-started)});if($('compressionEnabled').checked){show('','Starting compression worker…');bytes=await compressPdfWithGhostscript(bytes,Number($('compressionRatio').value),chosen.length);}if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));$('downloadBtn').classList.add('show');show('ok',`Completed (${(bytes.length/1048576).toFixed(2)} MB). Ready to download.`);console.info(`[PDF job ${job}] completed`,{outputBytes:bytes.length,elapsedMs:Math.round(performance.now()-started)});}catch(e){console.error(`[PDF job ${job}] failed`,e,e?.stack);show('error',`Processing failed: ${e.message||e}`)}finally{btn.disabled=false}};
$('downloadName').oninput=()=>{$('downloadName').setCustomValidity('');};
$('downloadBtn').onclick=()=>{if(!outputUrl)return;let name=$('downloadName').value.trim()||defaultDownloadName();if(!/\.pdf$/i.test(name))name+='.pdf';name=name.replace(/[\\/:*?"<>|]/g,'_');const a=document.createElement('a');a.href=outputUrl;a.download=name;a.click()};
function show(type,text){$('status').className='status '+type;$('status').textContent=text}
