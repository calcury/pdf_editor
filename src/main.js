import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

let sources = [], pages = [], selected = new Set(), order = [], outputUrl = null, usedBytes = 0;
const $ = id => document.getElementById(id), area = $('uploadArea'), LIMIT = 500 * 1024 * 1024, MAX_PAGES = 300;
function setLoadStatus(text){$('loadStatusText').textContent=text;}
function setUploadProgress(percent){$('uploadProgressBar').style.width=`${Math.max(0,Math.min(100,percent))}%`;}
area.onclick = () => $('fileInput').click();
area.ondragover = e => { e.preventDefault(); area.classList.add('drag'); };
area.ondragleave = () => area.classList.remove('drag');
area.ondrop = e => { e.preventDefault(); area.classList.remove('drag'); if (e.dataTransfer.files.length) choose([...e.dataTransfer.files]); };
$('fileInput').onchange = e => { if (e.target.files.length) choose([...e.target.files]); e.target.value = ''; };
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
    sources.push(...added); usedBytes += files.reduce((n,f)=>n+f.size,0); selected = new Set(pages.map((_,i)=>i)); order = pages.map((_,i)=>i);
    $('memoryText').textContent = `${(usedBytes/1048576).toFixed(2)} MB / 500 MB`; $('memoryBar').style.width = Math.min(100, usedBytes/LIMIT*100)+'%';
    renderFileList();
    $('pages').value=''; $('downloadBtn').classList.remove('show'); render(); markChanged(); setProgress(100); show('ok', 'PDF loaded locally. Nothing was uploaded.');
  } catch (err) { show('error', `Load failed: ${err.message || 'Unsupported or encrypted PDF'}`); }
  finally { btn.disabled = false; }
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderFileList(){const list=$('fileList');if(!sources.length){list.innerHTML='<div class="hint">No files</div>';return;}list.innerHTML=sources.map((s,i)=>`<div class="file-entry"><b>${i+1}</b><span title="${escapeHtml(s.file.name)}">${escapeHtml(s.file.name)}</span><button class="file-remove" type="button" data-file-index="${i}" title="Remove this PDF and all its pages" aria-label="Remove ${escapeHtml(s.file.name)}">×</button></div>`).join('');list.querySelectorAll('.file-remove').forEach(button=>button.onclick=()=>removeFile(Number(button.dataset.fileIndex)));}
function removeFile(fileIndex){const [removed]=sources.splice(fileIndex,1);if(!removed)return;removed.doc.destroy();usedBytes-=removed.file.size;const kept=pages.filter(page=>page.source!==removed);const oldToNew=new Map();pages.forEach((page,index)=>{if(page.source!==removed)oldToNew.set(index,kept.indexOf(page));});const keepSelected=[...selected].map(index=>oldToNew.get(index)).filter(index=>index!==undefined);const keepOrder=order.map(index=>oldToNew.get(index)).filter(index=>index!==undefined);pages=kept;selected=new Set(keepSelected);order=keepOrder;if(outputUrl){URL.revokeObjectURL(outputUrl);outputUrl=null;}$('downloadBtn').classList.remove('show');$('memoryText').textContent=usedBytes?`${(usedBytes/1048576).toFixed(2)} MB / 500 MB`:'0 B / 500 MB';$('memoryBar').style.width=Math.min(100,usedBytes/LIMIT*100)+'%';renderFileList();render();syncPages();markChanged();setProgress(0);show('ok',`Removed “${removed.file.name}” and all its pages.`);}
function render(){const box=$('preview');box.innerHTML='';order.forEach(idx=>{const p=pages[idx];if(!p)return;const el=document.createElement('div');el.className='thumb '+(selected.has(idx)?'selected':'');el.draggable=true;el.innerHTML=`${selected.has(idx)?'<input type="checkbox" checked>':''}<button class="zoom" title="Open high-resolution preview">⌕</button><img loading="lazy" src="${p.image}"><span>Page ${idx+1} · ${escapeHtml(p.source.file.name)}</span>`;el.onclick=e=>{if(e.target.classList.contains('zoom')||e.target.tagName==='INPUT')return;toggle(idx)};if(selected.has(idx))el.querySelector('input').onchange=()=>toggle(idx);el.querySelector('.zoom').onclick=e=>{e.stopPropagation();openOriginalPreview(p)};el.ondragstart=e=>e.dataTransfer.setData('text/plain',idx);el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();const from=order.indexOf(+e.dataTransfer.getData('text/plain')),to=order.indexOf(idx);if(from<0||to<0)return;const [v]=order.splice(from,1);order.splice(to,0,v);render();markChanged()};box.appendChild(el)});$('pageCount').textContent=`Showing ${selected.size} / ${pages.length} pages`;}
async function openOriginalPreview(pageInfo){const modal=$('modal'),img=$('largeImage');modal.classList.add('show');img.style.display='none';show('','Rendering preview…');try{const page=await pageInfo.source.doc.getPage(pageInfo.index+1);const cssScale=Math.min(3,Math.max(1.5,window.devicePixelRatio||1));const viewport=page.getViewport({scale:cssScale});const outputScale=Math.min(4,Math.max(2,window.devicePixelRatio||1));const renderViewport=page.getViewport({scale:cssScale*outputScale});const canvas=document.createElement('canvas');canvas.width=Math.ceil(renderViewport.width);canvas.height=Math.ceil(renderViewport.height);canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;await page.render({canvasContext:canvas.getContext('2d'),viewport:renderViewport}).promise;img.src=canvas.toDataURL('image/png');img.style.display='block';show('','');}catch(err){modal.classList.remove('show');show('error',`Preview failed: ${err.message||err}`)}}
function toggle(i){selected.has(i)?selected.delete(i):selected.add(i);syncPages();render();markChanged();}
function parseLocal(v){if(!v.trim())return [...order].filter(i=>selected.has(i));const out=[];for(const t of v.split(/[\s,，;；]+/)){if(!t)continue;const m=t.match(/^(\d+)(?:[-~至](\d+))?$/);if(!m)return null;const a=+m[1],b=+(m[2]||m[1]);if(a<1||b>pages.length||a>b)return null;for(let i=a;i<=b;i++)if(!out.includes(i-1))out.push(i-1);}return out;}
function syncPages(){const sorted=[...selected].map(i=>i+1).sort((a,b)=>a-b);if(sorted.length===pages.length){$('pages').value='';return}const ranges=[];for(let i=0;i<sorted.length;){let a=sorted[i],b=a;while(i+1<sorted.length&&sorted[i+1]===b+1)b=sorted[++i];ranges.push(a===b?`${a}`:`${a}-${b}`);i++;}$('pages').value=ranges.join(' ');}
$('pages').oninput=()=>{const wanted=parseLocal($('pages').value);if(wanted){selected=new Set(wanted);render()}markChanged()};$('pageSize').onchange=markChanged;
function markChanged(){$('sizeSetting').classList.toggle('changed',$('pageSize').value!=='original');$('pagesSetting').classList.toggle('changed',$('pages').value.trim()!==''&&selected.size!==pages.length)}
$('closeModal').onclick=()=>$('modal').classList.remove('show');$('modal').onclick=e=>{if(e.target.id==='modal')$('modal').classList.remove('show')};
$('processBtn').onclick=async()=>{if(!pages.length)return show('error','Please upload a PDF first');const chosen=parseLocal($('pages').value);if(!chosen?.length)return show('error','Keep at least one page and use a valid page range');const btn=$('processBtn');btn.disabled=true;show('','Processing PDF locally…');try{const out=await PDFDocument.create();const size=$('pageSize').value;const dims={A4:[595.28,841.89],A3:[841.89,1190.55]};for(const idx of order.filter(i=>chosen.includes(i))){const item=pages[idx], [copy]=await out.copyPages(item.source.pdf,[item.index]);if(size!=='original'){const [w,h]=dims[size],old=copy.getSize(),tw=old.width>old.height?h:w,th=old.width>old.height?w:h,scale=Math.min(tw/old.width,th/old.height);const embedded=await out.embedPage(copy);const target=out.addPage([w,h]);target.drawPage(embedded,{x:(w-old.width*scale)/2,y:(h-old.height*scale)/2,width:old.width*scale,height:old.height*scale});}else out.addPage(copy);}const bytes=await out.save();if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));$('downloadBtn').classList.add('show');show('ok',`Completed (${(bytes.length/1048576).toFixed(2)} MB). Ready to download.`);}catch(e){show('error',`Processing failed: ${e.message||e}`)}finally{btn.disabled=false}};
$('downloadBtn').onclick=()=>{if(!outputUrl)return;const a=document.createElement('a');a.href=outputUrl;a.download='edited.pdf';a.click()};
function show(type,text){$('status').className='status '+type;$('status').textContent=text}
