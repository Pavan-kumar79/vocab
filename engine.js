/*
 * Vocabulary Engine v1
 * Logic-first layer. UI is intentionally untouched.
 * Handles: conservative OCR parsing, duplicate-safe import, quiz selection,
 * varied question types, and vocabulary-only exposure tracking.
 */
(function () {
    'use strict';

    const ENGINE_VERSION = '1.0.0';

    const NOISE_PATTERNS = [
        /^(top\s+\d+\s+ows|top\s+\d+|one\s+word\s+substitution|one\s+word|synonyms?|antonyms?|idioms?(\s*&\s*phrases?)?|homonyms?)$/i,
        /^(page|chapter|unit|lesson|section|exercise|question|q)\s*\d*$/i,
        /^(ssc|cgl|blackbook|english|vocabulary|word\s+power|previous\s+year|pyq)$/i,
        /^\d+[.)\-:]?$/,
        /^\d+[.)\-:]?\s+(top|one\s+word|synonyms?|antonyms?|idioms?)/i
    ];

    const HEADER_PATTERNS = [
        /^\s*(top\s+\d+\s+ows|one\s+word\s+substitution|synonyms?|antonyms?|idioms?(\s*&\s*phrases?)?|homonyms?)\s*$/i,
        /^\s*(chapter|unit|lesson|section|exercise)\s+\d+/i
    ];

    const ENTRY_PATTERNS = [
        /^\s*(\d{1,4})\s*[.)\-:]\s*([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*)?)\s*(?:[-–—:|]\s+)(.+)$/,
        /^\s*([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*)?)\s*(?:[-–—:|]\s+)(.+)$/
    ];

    function cleanSpace(s) {
        return String(s || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeWordKey(word) {
        return cleanSpace(word)
            .toLowerCase()
            .replace(/[’]/g, "'");
    }

    function looksLikeNoise(text) {
        const s = cleanSpace(text).replace(/[•·]/g, '');
        if (!s || s.length < 2) return true;
        if (/^\d+[.)\-:]?\s*$/.test(s)) return true;
        if (NOISE_PATTERNS.some(re => re.test(s))) return true;
        if (/^[^A-Za-z]+$/.test(s)) return true;
        return false;
    }

    function cleanCandidateWord(raw) {
        let w = cleanSpace(raw)
            .replace(/^[\d\s.)\-:|]+/, '')
            .replace(/[\s\-–—:|]+$/, '')
            .replace(/[^A-Za-z'’\-\s]/g, '');
        w = cleanSpace(w);
        if (!w) return '';
        if (w.length > 60) return '';
        if (looksLikeNoise(w)) return '';
        return w;
    }

    function cleanMeaning(raw) {
        return cleanSpace(raw)
            .replace(/^[-–—:|]+\s*/, '')
            .replace(/\s*[|]+\s*/g, ' ')
            .slice(0, 1000);
    }

    function inferCategory(line, word, meaning) {
        const context = `${line} ${word} ${meaning}`.toLowerCase();
        if (/one\s+word\s+substitution|top\s+\d+\s+ows|\bows\b/.test(context)) return 'One Word Substitution';
        if (/idiom|phrase/.test(context)) return 'Idioms & Phrases';
        if (/synonym/.test(context)) return 'Synonyms';
        if (/antonym/.test(context)) return 'Antonyms';
        if (/homonym/.test(context)) return 'Homonyms';
        return 'General Vocabulary';
    }

    function parseOcrText(rawText) {
        const lines = String(rawText || '').split(/\r?\n/).map(cleanSpace).filter(Boolean);
        const candidates = [];
        let currentCategory = 'General Vocabulary';
        let currentEntry = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (HEADER_PATTERNS.some(re => re.test(line))) {
                const h = line.toLowerCase();
                if (/ows|one\s+word/.test(h)) currentCategory = 'One Word Substitution';
                else if (/idiom|phrase/.test(h)) currentCategory = 'Idioms & Phrases';
                else if (/synonym/.test(h)) currentCategory = 'Synonyms';
                else if (/antonym/.test(h)) currentCategory = 'Antonyms';
                else if (/homonym/.test(h)) currentCategory = 'Homonyms';
                continue;
            }

            let match = null;
            for (const re of ENTRY_PATTERNS) {
                const m = line.match(re);
                if (m) { match = m; break; }
            }
            if (!match) continue;

            let entryNumber = null;
            let rawWord;
            let rawMeaning;
            if (/^\d+$/.test(match[1])) {
                entryNumber = Number(match[1]);
                rawWord = match[2];
                rawMeaning = match[3];
            } else {
                rawWord = match[1];
                rawMeaning = match[2];
            }

            const word = cleanCandidateWord(rawWord);
            const meaning = cleanMeaning(rawMeaning);
            if (!word || !meaning || meaning.length < 2) continue;
            if (looksLikeNoise(word) || HEADER_PATTERNS.some(re => re.test(word))) continue;

            // A vocabulary entry should normally have a compact headword.
            // Multi-word entries are allowed for idioms/OWS but long prose is rejected.
            const wordCount = word.split(/\s+/).length;
            if (wordCount > 5 && currentCategory !== 'Idioms & Phrases' && currentCategory !== 'One Word Substitution') continue;

            const category = inferCategory(`${currentCategory} ${line}`, word, meaning);
            const highlighted = /[★☆⭐⚠️]/.test(line);

            currentEntry = {
                id: 'ocr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                word,
                wordKey: normalizeWordKey(word),
                meaning,
                categories: [category],
                synonyms: '',
                antonyms: '',
                example: '',
                source: 'Blackbook OCR',
                entryNumber,
                troublesome: highlighted,
                confidence: entryNumber !== null ? 'High' : 'Medium',
                reviewRequired: entryNumber === null
            };
            candidates.push(currentEntry);
        }

        // De-duplicate OCR output inside the same photo set.
        const merged = new Map();
        for (const c of candidates) {
            const key = c.wordKey;
            if (!merged.has(key)) merged.set(key, c);
            else {
                const old = merged.get(key);
                if (c.meaning.length > old.meaning.length) old.meaning = c.meaning;
                old.categories = Array.from(new Set([...old.categories, ...c.categories]));
                old.troublesome = old.troublesome || c.troublesome;
                if (old.entryNumber == null) old.entryNumber = c.entryNumber;
                old.confidence = old.confidence === 'High' || c.confidence === 'High' ? 'High' : 'Medium';
            }
        }
        return Array.from(merged.values());
    }

    function scoreWordForQuiz(word, now) {
        const asked = Number(word.timesAsked || 0);
        const wrong = Number(word.timesWrong || 0);
        const correct = Number(word.timesCorrect || 0);
        const accuracy = asked ? correct / asked : 0;
        const troublesome = word.troublesome ? 1 : 0;
        const weak = word.learningStatus === 'Weak' ? 1 : 0;
        const revision = word.learningStatus === 'Revision' ? 1 : 0;
        const lastAsked = word.lastAsked ? new Date(word.lastAsked).getTime() : 0;
        const daysSince = lastAsked ? Math.max(0, (now - lastAsked) / 86400000) : 9999;

        // Higher score = stronger reason to appear now.
        // Untested dominates, but repeated testing of the same word is discouraged.
        let score = 0;
        if (asked === 0) score += 10000;
        score += Math.max(0, 800 - asked * 120);
        score += wrong * 180;
        score += (1 - accuracy) * 500;
        score += troublesome * 260;
        score += weak * 220;
        score += revision * 140;
        score += Math.min(daysSince, 30) * 8;
        score += Math.random() * 20;
        return score;
    }

    function chooseBalancedWords(pool, count) {
        const now = Date.now();
        const sorted = pool.map(w => ({ w, score: scoreWordForQuiz(w, now) }))
            .sort((a, b) => b.score - a.score)
            .map(x => x.w);

        const selected = [];
        const seenCategories = new Map();
        for (const word of sorted) {
            if (selected.length >= count) break;
            const cats = Array.isArray(word.categories) ? word.categories : [];
            const cat = cats[0] || 'General Vocabulary';
            const catCount = seenCategories.get(cat) || 0;
            // Don't let one category consume the entire mixed quiz when alternatives exist.
            if (catCount >= Math.ceil(count * 0.65) && sorted.length > count) continue;
            selected.push(word);
            seenCategories.set(cat, catCount + 1);
        }
        if (selected.length < count) {
            for (const word of sorted) {
                if (selected.length >= count) break;
                if (!selected.includes(word)) selected.push(word);
            }
        }
        return selected;
    }

    function splitList(value) {
        return String(value || '').split(/[,;|]/).map(s => cleanSpace(s)).filter(Boolean);
    }

    function makeQuestion(target, bank) {
        const syns = splitList(target.synonyms);
        const ants = splitList(target.antonyms);
        const cats = Array.isArray(target.categories) ? target.categories : [];
        const types = ['word-to-meaning', 'meaning-to-word'];
        if (syns.length) types.push('word-to-synonym');
        if (ants.length) types.push('word-to-antonym');
        if (cats.includes('One Word Substitution')) types.push('meaning-to-word');
        if (cats.includes('Idioms & Phrases')) types.push('meaning-to-word');

        const type = types[Math.floor(Math.random() * types.length)];
        let promptText = target.word;
        let label = 'Word → Meaning';
        let correct = target.meaning;
        let answerField = 'meaning';

        if (type === 'meaning-to-word') {
            label = 'Meaning → Word';
            promptText = target.meaning;
            correct = target.word;
            answerField = 'word';
        } else if (type === 'word-to-synonym') {
            label = 'Word → Synonym';
            correct = syns[0];
        } else if (type === 'word-to-antonym') {
            label = 'Word → Antonym';
            correct = ants[0];
        }

        const options = [correct];
        const used = new Set([String(correct).toLowerCase()]);
        const shuffled = bank.filter(w => w.id !== target.id).slice();
        if (typeof shuffleArray === 'function') shuffleArray(shuffled);
        else shuffled.sort(() => Math.random() - 0.5);

        for (const w of shuffled) {
            if (options.length >= 4) break;
            let value = answerField === 'word' ? w.word : w.meaning;
            if (type === 'word-to-synonym') value = splitList(w.synonyms)[0] || '';
            if (type === 'word-to-antonym') value = splitList(w.antonyms)[0] || '';
            if (!value || used.has(value.toLowerCase())) continue;
            used.add(value.toLowerCase());
            options.push(value);
        }
        while (options.length < 4) options.push(`Option ${options.length + 1}`);
        options.sort(() => Math.random() - 0.5);

        return { wordObj: target, type, typeLabel: label, promptText, correctAnswer: correct, options };
    }

    function install() {
        if (window.__VOCAB_ENGINE_INSTALLED__) return;
        window.__VOCAB_ENGINE_INSTALLED__ = ENGINE_VERSION;

        // Replace OCR parser with conservative structured extraction.
        window.parseOcrTextToCandidates = function (rawText) {
            const parsed = parseOcrText(rawText);
            const existing = Array.isArray(window.allWordsCache) ? window.allWordsCache : [];
            ocrCandidates = parsed.map(c => ({
                ...c,
                isDuplicate: existing.some(w => normalizeWordKey(w.word) === c.wordKey),
                confidence: c.confidence === 'High' && !c.reviewRequired ? 'High Confidence' : 'Needs Review'
            }));
            if (typeof renderOcrCandidatesTable === 'function') renderOcrCandidatesTable();
        };

        // Better systemic selection. Existing UI remains unchanged.
        window.startConfiguredQuiz = function () {
            if (!Array.isArray(window.allWordsCache) || allWordsCache.length === 0) {
                showToast('Please add vocabulary words before starting a quiz!', 'error');
                return;
            }
            const modeEl = document.getElementById('quiz-mode-select');
            const mode = modeEl ? modeEl.value : 'All Vocabulary';
            let pool = [...allWordsCache];
            const categoryModes = ['One Word Substitution', 'Idioms & Phrases', 'Synonyms', 'Antonyms', 'Homonyms'];
            if (mode === 'Untested') pool = pool.filter(w => Number(w.timesAsked || 0) === 0);
            else if (mode === 'Weak Words') pool = pool.filter(w => w.learningStatus === 'Weak');
            else if (mode === 'Troublesome') pool = pool.filter(w => w.troublesome);
            else if (mode === 'Revision') pool = pool.filter(w => w.learningStatus === 'Revision' || w.learningStatus === 'Good');
            else if (categoryModes.includes(mode)) pool = pool.filter(w => (w.categories || []).includes(mode));

            if (!pool.length) {
                showToast(`No words available for selected mode: ${mode}`, 'error');
                return;
            }
            const selected = chooseBalancedWords(pool, Math.min(activeQuiz.length || 20, pool.length));
            activeQuiz.questions = selected.map(w => makeQuestion(w, allWordsCache));
            activeQuiz.currentIndex = 0;
            activeQuiz.score = 0;
            activeQuiz.userAnswers = [];
            activeQuiz.startTime = Date.now();
            navigateTo('quiz-active');
            startQuizTimer();
            renderCurrentQuestion();
        };

        // Keep compatibility with the existing UI renderer.
        window.generateQuestionObject = makeQuestion;

        console.info('[Vocabulary Engine]', ENGINE_VERSION, 'installed');
    }

    // Run after the original app's DOMContentLoaded initialization.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0));
    } else {
        setTimeout(install, 0);
    }
})();
