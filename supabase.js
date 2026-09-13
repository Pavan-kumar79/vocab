/* SSC CGL Vocab Pro - Supabase cloud storage bridge
   This file replaces the app's IndexedDB storage functions with Supabase.
   Only the public anon key is used here. Never put a service-role/secret key in frontend code.
*/
(function () {
    const SUPABASE_URL = 'https://mczrczsnjiruywkzpzny.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jenJjenNuamlydXl3a3pwem55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyNzc1NjAsImV4cCI6MjEwNDg1MzU2MH0.k_ONkmaI-PdWcSIhIJ6f1FQzOwrCM1lradC3vu9Ujrg';

    function loadSupabaseLibrary() {
        return new Promise((resolve, reject) => {
            if (window.supabase && typeof window.supabase.createClient === 'function') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Could not load Supabase client library.'));
            document.head.appendChild(script);
        });
    }

    function splitText(value) {
        if (Array.isArray(value)) return value;
        if (!value) return [];
        return String(value).split(',').map(s => s.trim()).filter(Boolean);
    }

    function toCloudRow(w) {
        const cleanWord = String(w.word || '').trim();
        return {
            word: cleanWord,
            meaning: String(w.meaning || '').trim(),
            categories: Array.isArray(w.categories) ? w.categories.join(', ') : String(w.categories || ''),
            synonyms: String(w.synonyms || '').trim(),
            antonyms: String(w.antonyms || '').trim(),
            example: String(w.example || '').trim(),
            source: Array.isArray(w.sources) ? w.sources.join(', ') : String(w.source || w.sources || ''),
            troublesome: !!w.troublesome,
            times_asked: Number(w.timesAsked || 0),
            times_correct: Number(w.timesCorrect || 0),
            times_wrong: Number(w.timesWrong || 0),
            learning_status: String(w.learningStatus || 'Untested').toLowerCase()
        };
    }

    function fromCloudRow(r) {
        const asked = Number(r.times_asked || 0);
        const correct = Number(r.times_correct || 0);
        return {
            id: r.word,
            word: r.word,
            wordKey: String(r.word || '').trim().toLowerCase(),
            meaning: r.meaning || '',
            hindiMeaning: '',
            partOfSpeech: '',
            entryNumber: '',
            categories: splitText(r.categories),
            synonyms: r.synonyms || '',
            antonyms: r.antonyms || '',
            example: r.example || '',
            sources: splitText(r.source),
            dateAdded: r.created_at || new Date().toISOString(),
            troublesome: !!r.troublesome,
            timesAsked: asked,
            timesCorrect: correct,
            timesWrong: Number(r.times_wrong || 0),
            accuracy: asked ? Math.round((correct / asked) * 10000) / 100 : 0,
            lastAsked: null,
            lastCorrect: null,
            lastWrong: null,
            learningStatus: r.learning_status || 'Untested'
        };
    }

    async function setup() {
        await loadSupabaseLibrary();
        const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.vocabSupabase = client;

        window.initDB = async function () {
            return true;
        };

        window.getAllWordsDB = async function () {
            const { data, error } = await client
                .from('words')
                .select('*')
                .order('word', { ascending: true });
            if (error) throw error;
            return (data || []).map(fromCloudRow);
        };

        window.saveWordDB = async function (wordData) {
            const row = toCloudRow(wordData);
            const { error } = await client.from('words').upsert(row, { onConflict: 'word' });
            if (error) throw error;
            return wordData.id || wordData.word;
        };

        window.bulkSaveWordsDB = async function (wordsArray) {
            const rows = (wordsArray || []).filter(w => w && w.word).map(toCloudRow);
            if (!rows.length) return;
            const { error } = await client.from('words').upsert(rows, { onConflict: 'word' });
            if (error) throw error;
        };

        window.deleteWordDB = async function (id) {
            const word = String(id || '').trim();
            if (!word) return;
            const { error } = await client.from('words').delete().eq('word', word);
            if (error) throw error;
        };

        window.wipeDatabase = async function () {
            if (!confirm('DANGER: Are you sure you want to erase ALL vocabulary entries? Make sure you have exported a backup first!')) return;
            const { error } = await client.from('words').delete().not('word', 'is', null);
            if (error) throw error;
            if (typeof showToast === 'function') showToast('Cloud vocabulary database wiped clean.', 'info');
            if (typeof refreshDataAndUI === 'function') await refreshDataAndUI();
        };

        try {
            if (typeof refreshDataAndUI === 'function') {
                await refreshDataAndUI();
            }
        } catch (err) {
            console.error('Supabase vocabulary load failed:', err);
            if (typeof showToast === 'function') showToast('Could not load cloud vocabulary. Check Supabase access.', 'error');
        }
    }

    window.addEventListener('DOMContentLoaded', function () {
        setup().catch(err => console.error('Supabase setup failed:', err));
    });
})();
