import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

let sources = [], pages = [], selected = new Set(), order = [], outputUrl = null, usedBytes = 0;
const $ = id => document.getElementById(id), area = $('uploadArea'), LIMIT = 500 * 1024 * 1024, MAX_PAGES = 300;
area.onclick = () => $('fileInput').click();
area.ondragover = e => { e.preventDefault(); area.classList.add('drag'); };
area.ondragleave = () => area.classList.remove('drag');
area.ondrop = e => { e.preventDefault(); area.classList.remove('drag'); if (e.dataTransfer.files.length) choose([...e.dataTransfer.files]); };
$('fileInput').onchange = e => { if (e.target.files.length) choose([...e.target.files]); e.target.value = ''; };
function choose(files) {
  if (files.some(f => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'))) return show('error', '只能上传 PDF 文件');
  const total = usedBytes + files.reduce((n, f) => n + f.size, 0);
  if (files.some(f => f.size > LIMIT)) return show('error', '单个文件不能超过 500 MB');
  if (total > LIMIT) return show('error', '文件总大小不能超过 500 MB');
  loadFiles(files);
}
async function loadFiles(files) {
  const btn = $('processBtn'); btn.disabled = true; show('', '正在本地读取并生成页面预览…');
  try {
    const added = [];
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({data: bytes.slice(0)}).promise;
      const pdf = await PDFDocument.load(bytes, {ignoreEncryption:false});
      if (pages.length + doc.numPages > MAX_PAGES) throw new Error(`最多支持 ${MAX_PAGES} 页，请拆分 PDF 后再试`);
      const entry = {file, bytes, pdf, doc}; added.push(entry);
      for (let i = 1; i <= doc.numPages; i++) {
        const p = doc.getPage(i); const viewport = p.getViewport({scale:.35});
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await p.render({canvasContext:canvas.getContext('2d'), viewport}).promise;
        pages.push({source:entry, index:i-1, image:canvas.toDataURL('image/jpeg',.72)}); canvas.width=0; canvas.height=0;
      }
    }
    sources.push(...added); usedBytes += files.reduce((n,f)=>n+f.size,0); selected = new Set(pages.map((_,i)=>i)); order = pages.map((_,i)=>i);
    $('memoryText').textContent = `${(usedBytes/1048576).toFixed(2)} MB / 500 MB`; $('memoryBar').style.width = Math.min(100, usedBytes/LIMIT*100)+'%';
    $('fileList').innerHTML = sources.map((s,i)=>`<div class="file-entry"><b>${i+1}</b><span title="${escapeHtml(s.file.name)}">${escapeHtml(s.file.name)}</span></div>`).join('');
    $('pages').value=''; $('downloadBtn').classList.remove('show'); render(); markChanged(); show('ok', 'PDF 已在本地载入，文件不会上传。');
  } catch (err) { show('error', `读取失败：${err.message || 'PDF 格式不受支持或文件已加密'}`); }
  finally { btn.disabled = false; }
}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(){const box=$('preview');box.innerHTML='';order.forEach(idx=>{const p=pages[idx];if(!p)return;const el=document.createElement('div');el.className='thumb '+(selected.has(idx)?'selected':'');el.draggable=true;el.innerHTML=`${selected.has(idx)?'<input type="checkbox" checked>':''}<button class="zoom" title="放大查看">⌕</button><img loading="lazy" src="${p.image}"><span>第 ${idx+1} 页 · ${escapeHtml(p.source.file.name)}</span>`;el.onclick=e=>{if(e.target.classList.contains('zoom')||e.target.tagName==='INPUT')return;toggle(idx)};if(selected.has(idx))el.querySelector('input').onchange=()=>toggle(idx);el.querySelector('.zoom').onclick=e=>{e.stopPropagation();$('largeImage').src=p.image;$('modal').classList.add('show')};el.ondragstart=e=>e.dataTransfer.setData('text/plain',idx);el.ondragover=e=>e.preventDefault();el.ondrop=e=>{e.preventDefault();const from=order.indexOf(+e.dataTransfer.getData('text/plain')),to=order.indexOf(idx);if(from<0||to<0)return;const [v]=order.splice(from,1);order.splice(to,0,v);render();markChanged()};box.appendChild(el)});$('pageCount').textContent=`显示 ${selected.size} / ${pages.length} 页`;}
function toggle(i){selected.has(i)?selected.delete(i):selected.add(i);syncPages();render();markChanged();}
function parseLocal(v){if(!v.trim())return [...order].filter(i=>selected.has(i));const out=[];for(const t of v.split(/[\s,，;；]+/)){if(!t)continue;const m=t.match(/^(\d+)(?:[-~至](\d+))?$/);if(!m)return null;const a=+m[1],b=+(m[2]||m[1]);if(a<1||b>pages.length||a>b)return null;for(let i=a;i<=b;i++)if(!out.includes(i-1))out.push(i-1);}return out;}
function syncPages(){const sorted=[...selected].map(i=>i+1).sort((a,b)=>a-b);if(sorted.length===pages.length){$('pages').value='';return}const ranges=[];for(let i=0;i<sorted.length;){let a=sorted[i],b=a;while(i+1<sorted.length&&sorted[i+1]===b+1)b=sorted[++i];ranges.push(a===b?`${a}`:`${a}-${b}`);i++;}$('pages').value=ranges.join(' ');}
$('pages').oninput=()=>{const wanted=parseLocal($('pages').value);if(wanted){selected=new Set(wanted);render()}markChanged()};$('pageSize').onchange=markChanged;
function markChanged(){$('sizeSetting').classList.toggle('changed',$('pageSize').value!=='original');$('pagesSetting').classList.toggle('changed',$('pages').value.trim()!==''&&selected.size!==pages.length)}
$('closeModal').onclick=()=>$('modal').classList.remove('show');$('modal').onclick=e=>{if(e.target.id==='modal')$('modal').classList.remove('show')};
$('processBtn').onclick=async()=>{if(!pages.length)return show('error','请先上传 PDF');const chosen=parseLocal($('pages').value);if(!chosen?.length)return show('error','至少保留一页，且页码格式正确');const btn=$('processBtn');btn.disabled=true;show('','正在本地处理 PDF…');try{const out=await PDFDocument.create();const size=$('pageSize').value;const dims={A4:[595.28,841.89],A3:[841.89,1190.55]};for(const idx of order.filter(i=>chosen.includes(i))){const item=pages[idx], [copy]=await out.copyPages(item.source.pdf,[item.index]);if(size!=='original'){const [w,h]=dims[size],old=copy.getSize(),tw=old.width>old.height?h:w,th=old.width>old.height?w:h,scale=Math.min(tw/old.width,th/old.height);const embedded=await out.embedPage(copy);const target=out.addPage([w,h]);target.drawPage(embedded,{x:(w-old.width*scale)/2,y:(h-old.height*scale)/2,width:old.width*scale,height:old.height*scale});}else out.addPage(copy);}const bytes=await out.save();if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));$('downloadBtn').classList.add('show');show('ok',`处理完成（${(bytes.length/1048576).toFixed(2)} MB），可下载。`);}catch(e){show('error',`处理失败：${e.message||e}`)}finally{btn.disabled=false}};
$('downloadBtn').onclick=()=>{if(!outputUrl)return;const a=document.createElement('a');a.href=outputUrl;a.download='edited.pdf';a.click()};
function show(type,text){$('status').className='status '+type;$('status').textContent=text}
