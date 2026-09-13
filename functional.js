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

  // Handles both "40. Abate - meaning" and the common Blackbook layout
  // where "40. Abate" and its definition appear on the next OCR line(s).
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
      // Reject obvious prose/header fragments.
      if (/^(blackbook|english vocabulary|top \d+|one word substitution)/i.test(word)) return;
      if (meaning.split(/\s+/).length < 2) return;
      const candidate = {
        id: 'ocr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        word, wordKey: key(word), meaning,
        categories: [inferCategory(category + ' ' + sourceLine + ' ' + meaning)],
        synonyms: '', antonyms: '', example: '',
        source: 'Blackbook', entryNumber: entryNumber == null ? '' : entryNumber,
        troublesome: /[★☆⭐⚠]/.test(sourceLine),
        confidence: entryNumber != null ? 'High Confidence' : 'Needs Review',
        reviewRequired: entryNumber == null
      };
      out.push(candidate);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const numbered = line.match(/^\s*(\d{1,4})\s*[.)\-:]\s*(.+)$/);
      if (numbered) {
        const num = Number(numbered[1]);
        const rest = clean(numbered[2]);

        // 1) Number + word + separator + definition on same line.
        const same = rest.match(/^([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,4})\s*[-–—:|]\s*(.+)$/);
        if (same) {
          push(same[1], same[2], num, line);
          pending = null;
          continue;
        }

        // 2) Number + word only. Definition usually follows.
        const wordOnly = cleanWord(rest);
        if (wordOnly) {
          pending = { word: wordOnly, num, source: line };
          // Look ahead for definition lines until next numbered entry.
          let meaningParts = [];
          for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
            if (/^\s*\d{1,4}\s*[.)\-:]/.test(lines[j])) break;
            if (isNoise(lines[j])) continue;
            const maybe = clean(lines[j]);
            // Don't consume another obvious header.
            if (/^(synonyms?|antonyms?|idioms?|one word substitution|top \d+)/i.test(maybe)) break;
            meaningParts.push(maybe);
            if (meaningParts.join(' ').length > 25) break;
          }
          if (meaningParts.length) {
            push(pending.word, meaningParts.join(' '), pending.num, pending.source);
            pending = null;
          }
          continue;
        }
      }

      // 3) Unnumbered word - meaning lines. Only accept compact headwords.
      const pair = line.match(/^([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,4})\s*[-–—:|]\s*(.+)$/);
      if (pair) {
        const w = cleanWord(pair[1]);
        if (w) push(w, pair[2], null, line);
      }
    }

    // Merge duplicates from the same batch.
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
        ctx.putImageData(data, 0, 0);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function createObj(c) {
    if (typeof window.createWordObject === 'function') {
      return window.createWordObject({
        word: c.word, meaning: c.meaning, categories: c.categories,
        synonyms: c.synonyms || '', antonyms: c.antonyms || '', example: '',
        source: c.source || 'Blackbook', troublesome: !!c.troublesome
      });
    }
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
    } else {
      await window.saveWordDB(createObj(c));
    }
  }

  window.__FUNCTIONAL_PATCH__ = true;

  // Replace OCR with image preprocessing + conservative parser.
  window.handleImageSelection = async function (e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const progress = document.getElementById('ocr-progress-box');
    const bar = document.getElementById('ocr-progress-bar');
    const status = document.getElementById('ocr-status-text');
    const pct = document.getElementById('ocr-percentage');
    if (progress) progress.classList.remove('hidden');
    window.ocrCandidates = [];
    try {
      for (let i = 0; i < files.length; i++) {
        if (status) status.textContent = `Reading page ${i + 1} of ${files.length}...`;
        const canvas = await preprocessImage(files[i]);
        const result = await Tesseract.recognize(canvas, 'eng', {
          logger: m => {
            if (m.status === 'recognizing text') {
              const p = Math.round((m.progress || 0) * 100);
              if (bar) bar.style.width = p + '%';
              if (pct) pct.textContent = p + '%';
            }
          }
        });
        const parsed = parseBlackbook(result.data.text);
        window.ocrCandidates.push(...parsed);
      }
      // Final duplicate pass against bank.
      const bank = Array.isArray(window.allWordsCache) ? window.allWordsCache : [];
      const seen = new Map();
      window.ocrCandidates = window.ocrCandidates.filter(c => {
        const k = c.wordKey;
        if (seen.has(k)) return false;
        seen.set(k, true);
        c.isDuplicate = bank.some(w => key(w.word) === k);
        return true;
      });
      if (status) status.textContent = `Found ${window.ocrCandidates.length} vocabulary entries.`;
      if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
    } catch (err) {
      console.error(err);
      if (typeof window.showToast === 'function') window.showToast('OCR failed. Try a clearer, closer photo.', 'error');
    } finally {
      if (progress) progress.classList.add('hidden');
      e.target.value = '';
    }
  };

  window.parseOcrTextToCandidates = function (rawText) {
    window.ocrCandidates = parseBlackbook(rawText);
    const bank = Array.isArray(window.allWordsCache) ? window.allWordsCache : [];
    window.ocrCandidates.forEach(c => c.isDuplicate = bank.some(w => key(w.word) === c.wordKey));
    if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
  };

  window.acceptSingleOcrCandidate = async function (id) {
    const list = window.ocrCandidates || [];
    const c = list.find(x => x.id === id);
    if (!c) return;
    await importCandidate(c);
    window.ocrCandidates = list.filter(x => x.id !== id);
    if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
    if (typeof window.refreshDataAndUI === 'function') await window.refreshDataAndUI();
    if (typeof window.showToast === 'function') window.showToast(`Saved ${c.word}`, 'success');
  };

  window.acceptAllOcrCandidates = async function () {
    const list = [...(window.ocrCandidates || [])];
    let saved = 0;
    for (const c of list) {
      // Never import a candidate marked Needs Review in the bulk action.
      if (c.reviewRequired || c.confidence !== 'High Confidence') continue;
      await importCandidate(c);
      saved++;
    }
    window.ocrCandidates = list.filter(c => c.reviewRequired || c.confidence !== 'High Confidence');
    if (typeof window.renderOcrCandidatesTable === 'function') window.renderOcrCandidatesTable();
    if (typeof window.refreshDataAndUI === 'function') await window.refreshDataAndUI();
    if (typeof window.showToast === 'function') window.showToast(`Saved ${saved} confirmed entries. Review the remaining entries.`, 'success');
  };

  function splitList(v) { return String(v || '').split(/[,;|]/).map(clean).filter(Boolean); }
  function makeQuestion(target, bank) {
    const syn = splitList(target.synonyms), ant = splitList(target.antonyms);
    const types = ['word-to-meaning','meaning-to-word'];
    if (syn.length) types.push('word-to-synonym');
    if (ant.length) types.push('word-to-antonym');
    const type = types[Math.floor(Math.random()*types.length)];
    let label='Word → Meaning', prompt=target.word, correct=target.meaning;
    if(type==='meaning-to-word'){label='Meaning → Word';prompt=target.meaning;correct=target.word;}
    if(type==='word-to-synonym'){label='Word → Synonym';correct=syn[0];}
    if(type==='word-to-antonym'){label='Word → Antonym';correct=ant[0];}
    const opts=[correct], used=new Set([String(correct).toLowerCase()]);
    const shuffled=bank.filter(w=>w!==target).slice().sort(()=>Math.random()-0.5);
    for(const w of shuffled){
      if(opts.length>=4) break;
      let v=type==='meaning-to-word'?w.word:w.meaning;
      if(type==='word-to-synonym') v=splitList(w.synonyms)[0]||'';
      if(type==='word-to-antonym') v=splitList(w.antonyms)[0]||'';
      if(v && !used.has(v.toLowerCase())){used.add(v.toLowerCase());opts.push(v);}
    }
    while(opts.length<4) opts.push('Not listed');
    opts.sort(()=>Math.random()-0.5);
    return {wordObj:target,type,typeLabel:label,promptText:prompt,correctAnswer:correct,options:opts};
  }

  // Today's Words: add a mode without touching the working quiz engine.
  // The existing startConfiguredQuiz() remains the only quiz engine.
  function installTodayQuizMode() {
    const select = document.getElementById('quiz-mode-select');
    if (!select || select.querySelector('option[value="Today"]')) return;

    const option = document.createElement('option');
    option.value = 'Today';
    option.textContent = "Today's Words";
    select.appendChild(option);

    const startButton = document.querySelector('button[onclick="startConfiguredQuiz()"]');
    if (!startButton || startButton.dataset.todayQuizInstalled === '1') return;
    startButton.dataset.todayQuizInstalled = '1';

    startButton.addEventListener('click', () => {
      if (select.value !== 'Today') return;

      const bank = window.allWordsCache;
      if (!Array.isArray(bank)) return;

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);

      const todayWords = bank.filter(word => {
        const added = new Date(word.dateAdded);
        return !Number.isNaN(added.getTime()) && added >= startOfToday && added < endOfToday;
      });

      // Temporarily narrow the existing quiz engine's source array.
      // It restores itself through refreshDataAndUI() after the quiz starts.
      const originalWords = bank.slice();
      bank.splice(0, bank.length, ...todayWords);

      setTimeout(() => {
        // If the quiz did not trigger a refresh (for example, no words today), restore it.
        if (window.allWordsCache === bank) {
          bank.splice(0, bank.length, ...originalWords);
        }
      }, 0);
    }, true);
  }

  // Keep existing renderer compatible with the new candidate fields.
  const oldRender = window.renderOcrCandidatesTable;
  if (oldRender) {
    // Existing renderer will read window.ocrCandidates, so no replacement needed.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installTodayQuizMode, { once: true });
  } else {
    installTodayQuizMode();
  }

  console.info('[Functional patch] loaded');
})();
