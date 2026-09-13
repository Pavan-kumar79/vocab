/* Functionality patch v2: use the app's real global state, not window copies. */
(function(){
'use strict';

const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const key=s=>clean(s).toLowerCase().replace(/[’]/g,"'");
const HEAD=/^(top\s+\d+|top\s+\d+\s+ows|one\s+word\s+substitution|synonyms?|antonyms?|idioms?(\s*&\s*phrases)?|homonyms?|blackbook(\s+of\s+english\s+vocabulary)?|english\s+vocabulary|vocabulary|ssc\s+cgl|page\s*\d*|chapter\s+\d+|section\s+\d+)$/i;
const BAD=/^(the|a|an|is|are|was|were|of|to|in|on|for|with|from|and|or|as|by|be|has|have|had|who|one|person|someone|something)$/i;
function word(s){
 let x=clean(s).replace(/^\d{1,4}\s*[.)\-:]\s*/,'').replace(/^[|•·\-–—:]+|[|•·]+$/g,'').replace(/[^A-Za-z'’\-\s]/g,'').trim();
 if(!x||x.length<2||x.length>45||HEAD.test(x)||BAD.test(x)||x.split(/\s+/).length>5)return '';
 return x;
}
function meaning(s){return clean(s).replace(/^[-–—:|]+\s*/,'').replace(/[|]+/g,' ').slice(0,700);}
function category(s){s=String(s||'').toLowerCase();if(/ows|one\s+word/.test(s))return 'One Word Substitution';if(/idiom|phrase/.test(s))return 'Idioms & Phrases';if(/synonym/.test(s))return 'Synonyms';if(/antonym/.test(s))return 'Antonyms';if(/homonym/.test(s))return 'Homonyms';return 'General Vocabulary';}

function parse(raw){
 const src=String(raw||'').split(/\r?\n/).map(clean).filter(x=>x.length>1);
 const out=[]; let section='';
 for(let i=0;i<src.length;i++){
  const line=src[i];
  if(HEAD.test(line)){section=line;continue;}
  const n=line.match(/^\s*(\d{1,4})\s*[.)\-:]\s*(.+)$/);
  if(!n)continue; // numbered entries only: this prevents definitions/headings becoming words
  const num=Number(n[1]), rest=clean(n[2]);
  // numbered word + definition on same line
  const same=rest.match(/^([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,4})\s*[-–—:|]\s*(.+)$/);
  if(same){
   const w=word(same[1]), m=meaning(same[2]);
   if(w&&m.length>=3)out.push(make(w,m,num,section,line));
   continue;
  }
  // numbered word with definition on following line(s)
  const w=word(rest); if(!w)continue;
  let parts=[];
  for(let j=i+1;j<src.length&&j<=i+3;j++){
   if(/^\s*\d{1,4}\s*[.)\-:]/.test(src[j]))break;
   if(HEAD.test(src[j]))break;
   parts.push(src[j]);
   if(parts.join(' ').length>=30)break;
  }
  const m=meaning(parts.join(' '));
  if(m.split(/\s+/).length>=2)out.push(make(w,m,num,section,line));
 }
 const map=new Map();
 for(const c of out){if(!map.has(c.wordKey))map.set(c.wordKey,c);else{const a=map.get(c.wordKey);if(c.meaning.length>a.meaning.length)a.meaning=c.meaning;a.categories=[...new Set([...a.categories,...c.categories])];a.troublesome=a.troublesome||c.troublesome;}}
 return [...map.values()];
}
function make(w,m,n,section,line){return {id:'ocr_'+Date.now()+'_'+Math.random().toString(36).slice(2),word:w,wordKey:key(w),meaning:m,categories:[category(section+' '+line+' '+m)],synonyms:'',antonyms:'',example:'',source:'Blackbook',entryNumber:n,troublesome:/[★☆⭐⚠]/.test(line),confidence:'High Confidence',reviewRequired:false};}

function bank(){return typeof allWordsCache!=='undefined'&&Array.isArray(allWordsCache)?allWordsCache:[];}
function candidates(){return typeof ocrCandidates!=='undefined'?ocrCandidates:[];}

window.handleImageSelection=async function(e){
 const files=[...(e.target.files||[])];if(!files.length)return;
 const box=document.getElementById('ocr-progress-box'),bar=document.getElementById('ocr-progress-bar'),status=document.getElementById('ocr-status-text'),pct=document.getElementById('ocr-percentage');
 if(box)box.classList.remove('hidden');
 ocrCandidates=[];
 try{
  for(let i=0;i<files.length;i++){
   if(status)status.textContent=`Reading page ${i+1} of ${files.length}...`;
   const r=await Tesseract.recognize(files[i],'eng',{logger:m=>{if(m.status==='recognizing text'){const p=Math.round((m.progress||0)*100);if(bar)bar.style.width=p+'%';if(pct)pct.textContent=p+'%';}}});
   ocrCandidates.push(...parse(r.data.text));
  }
  const seen=new Set();const b=bank();
  ocrCandidates=ocrCandidates.filter(c=>{if(seen.has(c.wordKey))return false;seen.add(c.wordKey);c.isDuplicate=b.some(w=>key(w.word)===c.wordKey);return true;});
  if(status)status.textContent=`Found ${ocrCandidates.length} real vocabulary entries.`;
  renderOcrCandidatesTable();
 }catch(err){console.error(err);if(typeof showToast==='function')showToast('OCR failed. Try a clearer photo.','error');}
 finally{if(box)box.classList.add('hidden');e.target.value='';}
};
window.parseOcrTextToCandidates=function(raw){ocrCandidates=parse(raw);const b=bank();ocrCandidates.forEach(c=>c.isDuplicate=b.some(w=>key(w.word)===c.wordKey));renderOcrCandidatesTable();};

async function saveCandidate(c){
 const b=bank();const old=b.find(w=>key(w.word)===c.wordKey);
 if(old){if(c.meaning.length>String(old.meaning||'').length)old.meaning=c.meaning;old.categories=[...new Set([...(old.categories||[]),...(c.categories||[])])];if(c.troublesome)old.troublesome=true;old.sources=[...new Set([...(old.sources||[]),'Blackbook'])];await saveWordDB(old);}
 else await saveWordDB(createWordObject({word:c.word,meaning:c.meaning,categories:c.categories,source:'Blackbook',troublesome:c.troublesome}));
}
window.acceptSingleOcrCandidate=async function(id){const c=ocrCandidates.find(x=>x.id===id);if(!c)return;await saveCandidate(c);ocrCandidates=ocrCandidates.filter(x=>x.id!==id);renderOcrCandidatesTable();await refreshDataAndUI();if(typeof showToast==='function')showToast(`Saved ${c.word}`,'success');};
window.acceptAllOcrCandidates=async function(){const list=[...ocrCandidates];let count=0;for(const c of list){if(c.confidence==='High Confidence'&&!c.reviewRequired){await saveCandidate(c);count++;}}ocrCandidates=list.filter(c=>c.confidence!=='High Confidence'||c.reviewRequired);renderOcrCandidatesTable();await refreshDataAndUI();if(typeof showToast==='function')showToast(`Saved ${count} confirmed entries.`, 'success');};

// Quiz: use the actual activeQuiz/allWordsCache variables from index.html.
window.startConfiguredQuiz=function(){
 const b=bank();if(!b.length){showToast('Add vocabulary first.','error');return;}
 const modeEl=document.getElementById('quiz-mode-select');const mode=modeEl?modeEl.value:'All Vocabulary';
 let pool=b.filter(w=>mode==='Untested'?Number(w.timesAsked||0)===0:mode==='Weak Words'?w.learningStatus==='Weak':mode==='Troublesome'?!!w.troublesome:mode==='Revision'?['Revision','Learning','Good'].includes(w.learningStatus):['One Word Substitution','Idioms & Phrases','Synonyms','Antonyms','Homonyms'].includes(mode)?(w.categories||[]).includes(mode):true);
 if(!pool.length){showToast('No words available for this quiz.','error');return;}
 pool.sort((a,z)=>{const s=w=>{const asked=+w.timesAsked||0,wrong=+w.timesWrong||0,acc=+w.accuracy||0;return (asked?0:100000)+5000/(asked+1)+wrong*1000+(100-acc)*8+(w.troublesome?700:0)+(w.learningStatus==='Weak'?600:0)+(w.learningStatus==='Revision'?250:0)+Math.random()*10;};return s(z)-s(a);});
 const len=Math.min((typeof activeQuiz!=='undefined'?activeQuiz.length:20),pool.length);
 activeQuiz.questions=pool.slice(0,len).map(w=>makeQ(w,b));activeQuiz.currentIndex=0;activeQuiz.score=0;activeQuiz.userAnswers=[];activeQuiz.startTime=Date.now();navigateTo('quiz-active');startQuizTimer();renderCurrentQuestion();
};
function list(v){return String(v||'').split(/[,;|]/).map(clean).filter(Boolean);}
function makeQ(t,b){const sy=list(t.synonyms),an=list(t.antonyms),types=['word-to-meaning','meaning-to-word'];if(sy.length)types.push('word-to-synonym');if(an.length)types.push('word-to-antonym');const type=types[Math.floor(Math.random()*types.length)];let label='Word → Meaning',prompt=t.word,correct=t.meaning;if(type==='meaning-to-word'){label='Meaning → Word';prompt=t.meaning;correct=t.word;}if(type==='word-to-synonym'){label='Word → Synonym';correct=sy[0];}if(type==='word-to-antonym'){label='Word → Antonym';correct=an[0];}const o=[correct],u=new Set([String(correct).toLowerCase()]);for(const w of b.filter(x=>x!==t).sort(()=>Math.random()-.5)){if(o.length>=4)break;let v=type==='meaning-to-word'?w.word:w.meaning;if(type==='word-to-synonym')v=list(w.synonyms)[0]||'';if(type==='word-to-antonym')v=list(w.antonyms)[0]||'';if(v&&!u.has(v.toLowerCase())){u.add(v.toLowerCase());o.push(v);}}while(o.length<4)o.push('Not listed');o.sort(()=>Math.random()-.5);return {wordObj:t,type,typeLabel:label,promptText:prompt,correctAnswer:correct,options:o};}

console.info('SSC Vocab functionality patch v2 active');
})();
