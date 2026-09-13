/* SSC CGL Vocab Pro - functionality-first patch
   Conservative Blackbook OCR + reliable quiz/import behavior.
*/
(function () {
  'use strict';

  const NOISE = [
    /^\s*top\s+\d+/i,
    /^\s*one\s+word\s+substitution\s*$/i,
    /^\s*(synonyms?|antonyms?|idioms?|idioms\s*&\s*phrases|homonyms?)\s*$/i,
    /^\s*(blackbook|english\s+vocabulary|vocabulary|ssc\s+cgl|previous\s+year|pyq)\s*$/i,
    /^\s*(chapter|unit|lesson|section|page|exercise|directions?)\b/i,
    /^\s*\d{1,4}\s*[.)-:]?\s*$/i
  ];

  const BAD_WORDS = /^(the|a|an|is|are|was|were|of|to|in|on|for|with|from|and|or|as|by|be|has|have|had|who|one|person|someone|something)$/i;

  function clean(s) {
    return String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function key(s) { return clean(s).toLowerCase().replace(/[’]/g, "'"); }
  function isNoise(s) {
    const x = clean(s);
    if (!x || x.length < 2 || /^[^A-Za-z]+$/.test(x)) return true;
    return NOISE.some(r => r.test(x));
  }
  function cleanWord(s) {
    let x = clean(s)
      .replace(/^\s*\d{1,4}\s*[.)\-:]\s*/, '')
      .replace(/^[|•·\-–—:]+/, '')
      .replace(/[|•·]+$/, '')
      .replace(/\s+/g, ' ');
    x = x.replace(/[^A-Za-z'’\-\s]/g, '').trim();
    if (!x || x.length < 2 || x.length > 45 || isNoise(x) || BAD_WORDS.test(x)) return '';
    const n = x.split(/\s+/).length;
    if (n > 5) return '';
    return x;
  }
  function cleanMeaning(s) {
    return clean(s).replace(/^[-–—:|]+\s*/, '').replace(/[|]+/g, ' ').slice(0, 800);
  }
  function inferCategory(text) {
    const x = clean(text).toLowerCase();
    if (/one\s+word|ows/.test(x)) return 'One Word Substitution';
    if (/idiom|phrase/.test(x)) return 'Idioms & Phrases';
    if (/synonym/.test(x)) return 'Synonyms';
    if (/antonym/.test(x)) return 'Antonyms';
    if (/homonym/.test(x)) return 'Homonyms';
    return 'General Vocabulary';
  }

  function parseBlackbook(raw) {
    const rawLines = String(raw || '').split(/\r?\n/).map(clean).filter(Boolean);
    const lines = [];
    for (const line of rawLines) {
      if (line.length < 2 || isNoise(line)) continue;
      lines.push(line);
    }
    const out = [];
    let category = 'General Vocabulary';
    let pending = null;
    function push(word, meaning, entryNumber, sourceLine) {
      word = cleanWord(word);
      meaning = cleanMeaning(meaning);
      if (!word || !meaning || meaning.length < 3) return;
      if (/^(blackbook|english vocabulary|top \d+|one word substitution)/i.test(word)) return;
      if (meaning.split(/\s+/).length < 2) return;
      out.push({
        id: 'ocr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        word, wordKey: key(word), meaning,
        categories: [inferCategory(category + ' ' + sourceLine + ' ' + meaning)],
        synonyms: '', antonyms: '', example: '', source: 'Blackbook',
        entryNumber: entryNumber == null ? '' : entryNumber,
        troublesome: /[★☆⭐⚠]/.test(sourceLine),
        confidence: entryNumber != null ? 'High Confidence' : 'Needs Review',
        reviewRequired: entryNumber == null
      });
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const numbered = line.match(/^\s*(\d{1,4})\s*[.)\-:]\s*(.+)$/);
      if (numbered) {
        const num = Number(numbered[1]);
        const rest = clean(numbered[2]);
        const same = rest.match(/^([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,4})\s*[-–—:|]\s*(.+)$/);
        if (same) { push(same[1], same[2], num, line); pending = null; continue; }
        const wordOnly = cleanWord(rest);
        if (wordOnly) {
          pending = { word: wordOnly, num, source: line };
          let meaningParts = [];
          for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
            if (/^\s*\d{1,4}\s*[.)\-:]/.test(lines[j])) break;
            if (isNoise(lines[j])) continue;
            const maybe = clean(lines[j]);
            if (/^(synonyms?|antonyms?|idioms?|one word substitution|top \d+)/i.test(maybe)) break;
            meaningParts.push(maybe);
            if (meaningParts.join(' ').length > 25) break;
          }
          if (meaningParts.length) { push(pending.word, meaningParts.join(' '), pending.num, pending.source); pending = null; }
          continue;
        }
      }
      const pair = line.match(/^([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,4})\s*[-–—:|]\s*(.+)$/);
      if (pair) { const w = cleanWord(pair[1]); if (w) push(w, pair[2], null, line); }
    }
    const map = new Map();
    for (const c of out) {
      const k = c.wordKey;
      if (!map.has(k)) map.set(k, c);
      else {
        const old = map.get(k);
        if (c.meaning.length > old.meaning.length) old.meaning = c.meaning;
        old.categories = [...new Set([...old.categories, ...c.categories])];
        old.troublesome = old.troublesome || c.troublesome;
        if (!old.entryNumber && c.entryNumber) old.entryNumber = c.entryNumber;
        if (c.confidence === 'High Confidence') old.confidence = c.confidence;
      }
    }
    return [...map.values()];
  }

  function preprocessImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxW = 2400;
        const scale = Math.min(2.2, maxW / img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1200, Math.round(img.naturalWidth * scale));
        canvas.height = Math.round(img.naturalHeight * (canvas.width / img.naturalWidth));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.data.length; i += 4) {
          const r = data.data[i], g = data.data[i+1], b = data.data[i+2];
          let v = 0.299*r + 0.587*g + 0.114*b;
          v = Math.max(0, Math.min(255, (v - 128) * 1.65 + 128));
          data.data[i] = data.data[i+1] = data.data[i+2] = v;
        }
        ctx.putImageData(data, 0, 0); resolve(canvas);
      };
      img.onerror = reject; img.src = url;
    });
  }

  function createObj(c) {
    if (typeof window.createWordObject === 'function') return window.createWordObject({
      word: c.word, meaning: c.meaning, categories: c.categories,
      synonyms: c.synonyms || '', antonyms: c.antonyms || '', example: '',
      source: c.source || 'Blackbook', troublesome: !!c.troublesome
    });
    return {
      id: 'w_' + Date.now() + Math.random().toString(36).slice(2), word: c.word,
      wordKey: key(c.word), meaning: c.meaning, categories: c.categories,
      synonyms: '', antonyms: '', example: '', sources: [c.source || 'Blackbook'],
      dateAdded: new Date().toISOString(), troublesome: !!c.troublesome,
      timesAsked: 0, timesCorrect: 0, timesWrong: 0, accuracy: 0,
      lastAsked: null, lastCorrect: null, lastWrong: null, learningStatus: 'Untested'
    };
  }

  async function importCandidate(c) {
    const bank = Array.isArray(window.allWordsCache) ? window.allWordsCache : [];
    const existing = bank.find(w => key(w.word) === c.wordKey);
    if (existing) {
      if (c.meaning && c.meaning.length > String(existing.meaning || '').length) existing.meaning = c.meaning;
      existing.categories = [...new Set([...(existing.categories || []), ...(c.categories || [])])];
      if (c.troublesome) existing.troublesome = true;
      if (!existing.sources) existing.sources = [];
      if (!existing.sources.includes('Blackbook')) existing.sources.push('Blackbook');
      await window.saveWordDB(existing);
    } else await window.saveWordDB(createObj(c));
  }

  window.__FUNCTIONAL_PATCH__ = true;

  window.handleImageSelection = async function (e) {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    const progress = document.getElementById('ocr-progress-box'), bar = document.getElementById('ocr-progress-bar');
    const status = document.getElementById('ocr-status-text'), pct = document.getElementById('ocr-percentage');
    if (progress) progress.classList.remove('hidden'); window.ocrCandidates = [];
    try {
      for (let i = 0; i < files.length; i++) {
        if (status) status.textContent = `Reading page ${i + 1} of ${files.length}...`;
        const canvas = await preprocessImage(files[i]);
        const result = await Tesseract.recognize(canvas, 'eng', { logger: m => {
          if (m.status === 'recognizing text') { const p = Math.round((m.progress || 0) * 100); if (bar) bar.style.width = p + '%'; if (pct) pct.textContent = p + '%'; }
        }});
        window.ocrCandidates.push(...parseBlackbook(result.data.text));
      }
      const bank = Array.isArray(window.allWordsCache) ? window.allWordsCache : [], seen = new Map();
      window.ocrCandidates = window.ocrCandidates.filter(c => { const k = c.wordKey; if (seen.has(k)) return false; seen.set(k, true); c.isDuplicate = bank.some(w => key(w.word) === k); return true; });
      if (status) status.textContent = `Found ${window.ocrCandidates.length} vocabulary entries.`;
      if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
    } catch (err) { console.error(err); if (typeof window.showToast === 'function') window.showToast('OCR failed. Try a clearer, closer photo.', 'error'); }
    finally { if (progress) progress.classList.add('hidden'); e.target.value = ''; }
  };

  window.parseOcrTextToCandidates = function (rawText) {
    window.ocrCandidates = parseBlackbook(rawText);
    const bank = Array.isArray(window.allWordsCache) ? window.allWordsCache : [];
    window.ocrCandidates.forEach(c => c.isDuplicate = bank.some(w => key(w.word) === c.wordKey));
    if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
  };

  window.acceptSingleOcrCandidate = async function (id) {
    const list = window.ocrCandidates || [], c = list.find(x => x.id === id); if (!c) return;
    await importCandidate(c); window.ocrCandidates = list.filter(x => x.id !== id);
    if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
    if (typeof window.refreshDataAndUI === 'function') await window.refreshDataAndUI();
    if (typeof window.showToast === 'function') window.showToast(`Saved ${c.word}`, 'success');
  };

  window.acceptAllOcrCandidates = async function () {
    const list = [...(window.ocrCandidates || [])]; let saved = 0;
    for (const c of list) { if (c.reviewRequired || c.confidence !== 'High Confidence') continue; await importCandidate(c); saved++; }
    window.ocrCandidates = list.filter(c => c.reviewRequired || c.confidence !== 'High Confidence');
    if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
    if (typeof window.refreshDataAndUI === 'function') await window.refreshDataAndUI();
    if (typeof window.showToast === 'function') window.showToast(`Saved ${saved} confirmed entries. Review the remaining entries.`, 'success');
  };

  function splitList(v) { return String(v || '').split(/[,;|]/).map(clean).filter(Boolean); }
  function makeQuestion(target, bank) {
    const syn = splitList(target.synonyms), ant = splitList(target.antonyms);
    const types = ['word-to-meaning','meaning-to-word']; if (syn.length) types.push('word-to-synonym'); if (ant.length) types.push('word-to-antonym');
    const type = types[Math.floor(Math.random()*types.length)];
    let label='Word → Meaning', prompt=target.word, correct=target.meaning;
    if(type==='meaning-to-word'){label='Meaning → Word';prompt=target.meaning;correct=target.word;}
    if(type==='word-to-synonym'){label='Word → Synonym';correct=syn[0];}
    if(type==='word-to-antonym'){label='Word → Antonym';correct=ant[0];}
    const opts=[correct], used=new Set([String(correct).toLowerCase()]);
    const shuffled=bank.filter(w=>w!==target).slice().sort(()=>Math.random()-0.5);
    for(const w of shuffled){ if(opts.length>=4) break; let v=type==='meaning-to-word'?w.word:w.meaning; if(type==='word-to-synonym') v=splitList(w.synonyms)[0]||''; if(type==='word-to-antonym') v=splitList(w.antonyms)[0]||''; if(v&&!used.has(v.toLowerCase())){used.add(v.toLowerCase());opts.push(v);} }
    while(opts.length<4) opts.push('Not listed'); opts.sort(()=>Math.random()-0.5);
    return {wordObj:target,type,typeLabel:label,promptText:prompt,correctAnswer:correct,options:opts};
  }

  // Existing working quiz engine remains untouched. This block only narrows its source pool.
  function addMode(select, value, label) {
    if (!select || select.querySelector(`option[value="${value}"]`)) return;
    const o = document.createElement('option'); o.value = value; o.textContent = label; select.appendChild(o);
  }

  function dateOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function filterByMode(bank, mode) {
    const now = new Date(), today = dateOnly(now), start7 = new Date(today); start7.setDate(start7.getDate()-6);
    const start30 = new Date(today); start30.setDate(start30.getDate()-29);
    return bank.filter(w => {
      const d = new Date(w.dateAdded); if (Number.isNaN(d.getTime())) return false;
      const day = dateOnly(d);
      if (mode === 'Today') return day.getTime() === today.getTime();
      if (mode === 'Last7') return day >= start7 && day <= today;
      if (mode === 'Last30') return day >= start30 && day <= today;
      if (mode === 'Older') return day < start30;
      return true;
    });
  }

  function installAllPracticeModes() {
    const select = document.getElementById('quiz-mode-select');
    if (!select) return;
    addMode(select, 'Today', 'Today');
    addMode(select, 'Last7', 'Last 7 Days');
    addMode(select, 'Last30', 'Last 30 Days');
    addMode(select, 'Older', 'Older Than 30 Days');
    addMode(select, 'SpecificDay', 'Specific Day');
    addMode(select, 'SingleWord', 'Practice One Word');

    const startButton = document.querySelector('button[onclick="startConfiguredQuiz()"]');
    if (!startButton || startButton.dataset.allPracticeModesInstalled === '1') return;
    startButton.dataset.allPracticeModesInstalled = '1';

    startButton.addEventListener('click', () => {
      const mode = select.value;
      if (!['Today','Last7','Last30','Older','SpecificDay','SingleWord'].includes(mode)) return;
      const bank = window.allWordsCache;
      if (!Array.isArray(bank)) return;
      const original = bank.slice();
      let pool = [];

      if (mode === 'SpecificDay') {
        const answer = window.prompt('Enter the date to practice (YYYY-MM-DD):', new Date().toISOString().slice(0,10));
        if (!answer || !/^\d{4}-\d{2}-\d{2}$/.test(answer)) { if (typeof window.showToast === 'function') window.showToast('Use date format YYYY-MM-DD.', 'error'); return; }
        const wanted = new Date(answer + 'T00:00:00');
        if (Number.isNaN(wanted.getTime())) return;
        pool = bank.filter(w => { const d = new Date(w.dateAdded); return !Number.isNaN(d.getTime()) && dateOnly(d).getTime() === dateOnly(wanted).getTime(); });
      } else if (mode === 'SingleWord') {
        pool = original.slice().sort((a,b) => {
          const au = (a.timesAsked || 0) === 0 ? 0 : 1, bu = (b.timesAsked || 0) === 0 ? 0 : 1;
          if (au !== bu) return au-bu;
          const aw = (a.timesWrong || 0) > (a.timesCorrect || 0) ? 0 : 1, bw = (b.timesWrong || 0) > (b.timesCorrect || 0) ? 0 : 1;
          if (aw !== bw) return aw-bw;
          return (a.timesAsked || 0) - (b.timesAsked || 0);
        }).slice(0,1);
      } else pool = filterByMode(original, mode);

      bank.splice(0, bank.length, ...pool);
      window.__vocabPracticeMode = mode;
      window.__vocabPracticeOriginal = original;
      setTimeout(() => {
        if (window.allWordsCache === bank && window.__vocabPracticeOriginal === original) bank.splice(0, bank.length, ...original);
      }, 0);
    }, true);
  }

  function installQuizHistoryAndExposure() {
    // Persistent local quiz history complements the per-word Supabase counters without changing schema.
    if (!Array.isArray(window.vocabQuizHistory)) {
      try { window.vocabQuizHistory = JSON.parse(localStorage.getItem('sscCglVocabQuizHistory') || '[]'); } catch (_) { window.vocabQuizHistory = []; }
    }
    window.recordVocabQuiz = function (result) {
      const entry = Object.assign({ timestamp: new Date().toISOString() }, result || {});
      window.vocabQuizHistory.unshift(entry);
      window.vocabQuizHistory = window.vocabQuizHistory.slice(0, 200);
      try { localStorage.setItem('sscCglVocabQuizHistory', JSON.stringify(window.vocabQuizHistory)); } catch (_) {}
    };
    window.getVocabQuizHistory = function () { return (window.vocabQuizHistory || []).slice(); };
  }

  function installAdaptiveSelectionHelpers() {
    window.getNextRevisionWords = function (limit = 20) {
      const bank = Array.isArray(window.allWordsCache) ? window.allWordsCache : [];
      const now = Date.now();
      const score = w => {
        const asked = Number(w.timesAsked || 0), wrong = Number(w.timesWrong || 0), acc = Number(w.accuracy || 0);
        const dueDays = asked === 0 ? 999 : Math.min(14, Math.max(1, Math.round(Math.pow(2, Math.max(0, asked - wrong)))));
        const last = w.lastWrong || w.lastAsked;
        const ageDays = last ? (now - new Date(last).getTime()) / 86400000 : 999;
        return (asked === 0 ? 100000 : 0) + (wrong > 0 ? 50000 : 0) + (w.troublesome ? 20000 : 0) + Math.min(ageDays / dueDays, 10) * 1000 + (100 - acc) * 10 - asked;
      };
      return bank.slice().sort((a,b) => score(b)-score(a)).slice(0, Math.max(1, limit));
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { installAllPracticeModes(); installQuizHistoryAndExposure(); installAdaptiveSelectionHelpers(); }, { once: true });
  } else {
    installAllPracticeModes(); installQuizHistoryAndExposure(); installAdaptiveSelectionHelpers();
  }

  console.info('[Functional patch] loaded');
})();
