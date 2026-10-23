import ghostscriptSource from '../node_modules/@jspawn/ghostscript-wasm/gs.js?raw';
import wasmUrl from '../node_modules/@jspawn/ghostscript-wasm/gs.wasm?url';

let gsPromise;
const ackWaiters=new Map();
function stage(id,name,message,details){console.info(`[Ghostscript ${id}] ${name}`,details||'');self.postMessage({id,type:'stage',stage:name,message,details});}
function reportGhostscriptOutput(id,level,text){const output=String(text||'');console[level==='warn'?'warn':'info'](`[Ghostscript ${id}]`,output);self.postMessage({id,type:'log',level,text:output});}
async function getGhostscript(id){
  if(!gsPromise){
    stage(id,'engine-init','Loading compression engine…');
    const moduleBox={exports:{}};
    const getPath=()=>({dirname:()=>'/'});
    const factory=Function('exports','module','require','__dirname','process',`${ghostscriptSource}; return module.exports;`)({},moduleBox,getPath,'/',undefined);
    gsPromise=factory({locateFile:name=>name.endsWith('.wasm')?wasmUrl:name,noInitialRun:true,noExitRuntime:true,print:text=>reportGhostscriptOutput(id,'info',text),printErr:text=>reportGhostscriptOutput(id,'warn',text)});
    gsPromise.then(()=>stage(id,'engine-ready','Compression engine ready.')).catch(error=>console.error(`[Ghostscript ${id}] engine initialization failed`,error));
  }
  return gsPromise;
}
self.onmessage=async event=>{
  const data=event.data||{};
  if(data.type==='ack'){
    const waiter=ackWaiters.get(`${data.id}:${data.current}`);
    if(waiter){ackWaiters.delete(`${data.id}:${data.current}`);waiter(data.error?new Error(data.error):null);}
    return;
  }
  const {id,bytes,ratio,totalPages}=data,started=performance.now();
  try{
    stage(id,'received','Compression job received',{inputBytes:bytes?.byteLength,ratio,totalPages});
    if(!(bytes instanceof ArrayBuffer)||bytes.byteLength===0)throw new Error('Compression worker received empty PDF data');
    if(!Number.isInteger(totalPages)||totalPages<1)throw new Error('Invalid PDF page count for compression');
    const gs=await getGhostscript(id);
    stage(id,'engine-loaded','Preparing PDF input…');
    const input='/input.pdf';try{gs.FS.unlink(input)}catch{}gs.FS.writeFile(input,new Uint8Array(bytes));
    const quality=Math.max(0,Math.min(1,(ratio-10)/85)),qFactor=(0.15+quality*0.75).toFixed(3),dpi=Math.round(90+quality*210);
    const psParams=`<</ColorImageDict << /QFactor ${qFactor} /Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2] >> /GrayImageDict << /QFactor ${qFactor} /Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2] >> >> setdistillerparams`;
    stage(id,'input-ready','PDF ready; compressing pages individually.',{inputBytes:bytes.byteLength,totalPages});
    for(let current=1;current<=totalPages;current++){
      const output=`/compressed-page-${current}.pdf`;try{gs.FS.unlink(output)}catch{}
      const args=['-dNOPAUSE','-dBATCH','-dSAFER','-sDEVICE=pdfwrite','-dCompatibilityLevel=1.7',`-sOutputFile=${output}`,`-dFirstPage=${current}`,`-dLastPage=${current}`,'-dAutoFilterColorImages=false','-dAutoFilterGrayImages=false','-dPassThroughJPEGImages=false','-dPassThroughJPXImages=false','-sColorImageFilter=DCTEncode','-sGrayImageFilter=DCTEncode','-dDownsampleColorImages=true','-dDownsampleGrayImages=true','-dColorImageDownsampleType=/Bicubic','-dGrayImageDownsampleType=/Bicubic',`-dColorImageResolution=${dpi}`,`-dGrayImageResolution=${dpi}`,'-c',psParams,'-f',input];
      stage(id,'page-start',`Compressing page ${current}/${totalPages}`,{current,total:totalPages});
      try{gs.callMain(args)}catch(error){if(!String(error).includes('Program terminated'))throw error;}
      const result=gs.FS.readFile(output);if(!result?.byteLength)throw new Error(`Ghostscript returned empty data for page ${current}`);
      const pagePdf=result.slice().buffer;
      console.info(`[Ghostscript ${id}] actual page completed ${current}/${totalPages}`,{bytes:pagePdf.byteLength,elapsedMs:Math.round(performance.now()-started)});
      self.postMessage({id,type:'page',current,total:totalPages,pagePdf},[pagePdf]);
      const ackError=await new Promise(resolve=>ackWaiters.set(`${id}:${current}`,resolve));if(ackError)throw ackError;
    }
    self.postMessage({id,type:'done',total:totalPages,elapsedMs:Math.round(performance.now()-started)});
  }catch(error){console.error(`[Ghostscript ${id}] compression failed`,error,error?.stack);self.postMessage({id,error:error?.message||String(error),stack:error?.stack});}
};
