(function(){
  'use strict';
  function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
  function key(s){return clean(s).toLowerCase().replace(/[’]/g,"'");}
  function noise(s){
    s=clean(s);
    if(!s || s.length<2) return true;
    if(/^\d{1,4}[.)\-:]?$/.test(s)) return true;
    if(/^(top\s+\d+\s+ows|one\s+word\s+substitution|one\s+word|synonyms?|antonyms?|idioms?(\s*&\s*phrases?)?|homonyms?|blackbook|english vocabulary|vocabulary)$/i.test(s)) return true;
    if(/^(page|chapter|unit|lesson|section|exercise|question|q)\s*\d*$/i.test(s)) return true;
    return /^[^A-Za-z]+$/.test(s);
  }
  function cleanWord(s){
    s=clean(s).replace(/^\d+[.)\-:]?\s*/,'').replace(/^[\s|:;,.\-–—]+|[\s|:;,.\-–—]+$/g,'');
    s=s.replace(/[^A-Za-z'’\-\s]/g,'');
    s=clean(s);
    if(!s || s.length>55 || noise(s)) return '';
    if(s.split(/\s+/).length>5) return '';
    return s;
  }
  function cleanMeaning(s){return clean(s).replace(/^[-–—:|]+\s*/,'').replace(/\s*[|]+\s*/g,' ').slice(0,1200);}
  function categoryFrom(context){
    context=context.toLowerCase();
    if(/one\s+word|ows|person who|one who|one that|one\s+which/.test(context)) return ['One Word Substitution'];
    if(/idiom|phrase/.test(context)) return ['Idioms & Phrases'];
    if(/synonym/.test(context)) return ['Synonyms'];
    if(/antonym/.test(context)) return ['Antonyms'];
    if(/homonym/.test(context)) return ['Homonyms'];
    return ['General Vocabulary'];
  }
  function parse(text){
    const raw=String(text||'').split(/\r?\n/).map(clean).filter(Boolean);
    const out=[]; let section='';
    for(let i=0;i<raw.length;i++){
      const line=raw[i];
      if(/^(top\s+\d+\s+ows|one\s+word\s+substitution|one\s+word)$/i.test(line)){section='ows';continue;}
      if(/^(idioms?|idioms\s*&\s*phrases?)$/i.test(line)){section='idioms';continue;}
      if(/^(synonyms?|antonyms?|homonyms?)$/i.test(line)){section=line.toLowerCase();continue;}
      if(noise(line)) continue;
      const m=line.match(/^\s*(\d{1,4})[.)\-:]?\s+(.+)$/); if(!m) continue;
      const n=Number(m[1]); let rest=clean(m[2]); if(!rest||rest.length<4) continue;
      let word='',meaning='';
      let parts=rest.split(/\s*[-–—:|]\s*/);
      if(parts.length>=2){word=cleanWord(parts[0]);meaning=cleanMeaning(parts.slice(1).join(' '));}
      if(!word){const mm=rest.match(/^([A-Za-z][A-Za-z'’\-]{1,30})\s+(.{8,})$/);if(mm){word=cleanWord(mm[1]);meaning=cleanMeaning(mm[2]);}}
      if(!word||meaning.length<3){const mm=rest.match(/^(.{8,}?)\s+([A-Z][a-zA-Z'’\-]{2,30})$/);if(mm){const candidate=cleanWord(mm[2]);const def=cleanMeaning(mm[1]);if(candidate&&def.split(/\s+/).length>=3){word=candidate;meaning=def;}}}
      if(!word||!meaning||meaning.length<3) continue;
      if(/^(the|a|an|one|who|someone|something|person)$/i.test(word)) continue;
      out.push({id:'ocr_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),word,wordKey:key(word),meaning,categories:section==='ows'?['One Word Substitution']:categoryFrom(section+' '+line),synonyms:'',antonyms:'',example:'',source:'Blackbook OCR',troublesome:false,entryNumber:n,confidence:'High Confidence',reviewRequired:false});
    }
    const map=new Map();
    for(const c of out){if(!map.has(c.wordKey))map.set(c.wordKey,c);else{const x=map.get(c.wordKey);if(c.meaning.length>x.meaning.length)x.meaning=c.meaning;x.categories=[...new Set([...x.categories,...c.categories])];}}
    return [...map.values()];
  }
  function preprocess(file){
    return new Promise(resolve=>{const img=new Image();img.onload=()=>{const scale=Math.min(2,1800/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);const d=ctx.getImageData(0,0,canvas.width,canvas.height),p=d.data;for(let i=0;i<p.length;i+=4){const g=.299*p[i]+.587*p[i+1]+.114*p[i+2];const v=g>180?255:g<90?0:g;p[i]=p[i+1]=p[i+2]=v;}ctx.putImageData(d,0,0);resolve(canvas);URL.revokeObjectURL(img.src);};img.src=URL.createObjectURL(file);});
  }
  window.parseOcrTextToCandidates=function(rawText){const parsed=parse(rawText);const existing=Array.isArray(window.allWordsCache)?window.allWordsCache:[];window.ocrCandidates=parsed.map(c=>({...c,isDuplicate:existing.some(w=>key(w.word)===c.wordKey)}));if(typeof window.renderOcrCandidatesTable==='function')window.renderOcrCandidatesTable();};
  window.handleImageSelection=async function(e){
    const files=e.target.files;if(!files||!files.length)return;
    const box=document.getElementById('ocr-progress-box'),bar=document.getElementById('ocr-progress-bar'),st=document.getElementById('ocr-status-text'),pt=document.getElementById('ocr-percentage');
    box.classList.remove('hidden');window.ocrCandidates=[];
    try{for(let i=0;i<files.length;i++){st.textContent=`Scanning page ${i+1} of ${files.length}...`;bar.style.width='0%';pt.textContent='0%';const canvas=await preprocess(files[i]);const r=await Tesseract.recognize(canvas,'eng',{logger:m=>{if(m.status==='recognizing text'){const p=Math.round(m.progress*100);bar.style.width=p+'%';pt.textContent=p+'%';}}});const parsed=parse(r.data.text);const existing=Array.isArray(window.allWordsCache)?window.allWordsCache:[];for(const c of parsed){c.isDuplicate=existing.some(w=>key(w.word)===c.wordKey)||window.ocrCandidates.some(x=>x.wordKey===c.wordKey);window.ocrCandidates.push(c);}}window.renderOcrCandidatesTable();st.textContent='OCR Extraction Complete!';}catch(err){console.error(err);if(typeof window.showToast==='function')window.showToast('OCR failed. Please try a clearer photo.','error');}finally{box.classList.add('hidden');}
  };
})();