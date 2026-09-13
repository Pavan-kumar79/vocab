/* SSC CGL Vocab Pro - Supabase cloud storage + authentication bridge
   Uses the existing Supabase project. Only the public anon key is used here.
   Never put a service-role/secret key in frontend code.
*/
(function () {
    const SUPABASE_URL = 'https://mczrczsnjiruywkzpzny.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jenJjenNuamlydXl3a3pwem55Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyNzc1NjAsImV4cCI6MjEwNDg1MzU2MH0.k_ONkmaI-PdWcSIhIJ6f1FQzOwrCM1lradC3vu9Ujrg';
    let client = null;
    let currentUser = null;

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
            user_id: currentUser ? currentUser.id : null,
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

    function addLoginUI() {
        if (document.getElementById('vocab-auth-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'vocab-auth-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#0f172a,#1e3a8a);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif;';
        overlay.innerHTML = `
            <div style="width:100%;max-width:420px;background:white;border-radius:20px;padding:32px;box-shadow:0 25px 60px rgba(0,0,0,.35)">
                <div style="text-align:center;margin-bottom:24px">
                    <div style="font-size:42px;margin-bottom:8px">📚</div>
                    <h1 style="margin:0;color:#0f172a;font-size:25px">SSC CGL Vocab Pro</h1>
                    <p style="margin:8px 0 0;color:#64748b;font-size:14px">Sign in to access your cloud vocabulary</p>
                </div>
                <label style="display:block;color:#334155;font-size:13px;font-weight:700;margin-bottom:6px">Email</label>
                <input id="vocab-auth-email" type="email" autocomplete="email" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;margin-bottom:14px;font-size:15px" placeholder="Your email">
                <label style="display:block;color:#334155;font-size:13px;font-weight:700;margin-bottom:6px">Password</label>
                <input id="vocab-auth-password" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;margin-bottom:16px;font-size:15px" placeholder="Your password">
                <button id="vocab-auth-login" style="width:100%;padding:13px;background:#2563eb;color:white;border:0;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer">Sign in</button>
                <p id="vocab-auth-error" style="color:#dc2626;font-size:13px;margin:12px 0 0;min-height:18px;text-align:center"></p>
            </div>`;
        document.body.appendChild(overlay);

        const login = async () => {
            const email = document.getElementById('vocab-auth-email').value.trim();
            const password = document.getElementById('vocab-auth-password').value;
            const errorBox = document.getElementById('vocab-auth-error');
            const button = document.getElementById('vocab-auth-login');
            errorBox.textContent = '';
            if (!email || !password) {
                errorBox.textContent = 'Enter your email and password.';
                return;
            }
            button.disabled = true;
            button.textContent = 'Signing in...';
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            button.disabled = false;
            button.textContent = 'Sign in';
            if (error) {
                errorBox.textContent = error.message;
                return;
            }
            currentUser = data.user;
            overlay.remove();
            await refreshAfterLogin();
        };

        document.getElementById('vocab-auth-login').addEventListener('click', login);
        document.getElementById('vocab-auth-password').addEventListener('keydown', e => {
            if (e.key === 'Enter') login();
        });
    }

    async function refreshAfterLogin() {
        try {
            if (typeof window.refreshDataAndUI === 'function') {
                await window.refreshDataAndUI();
            }
        } catch (err) {
            console.error('Vocabulary cloud load failed:', err);
            if (typeof window.showToast === 'function') window.showToast('Could not load your cloud vocabulary.', 'error');
        }
    }

    function installStorageBridge() {
        window.initDB = async function () { return true; };

        window.getAllWordsDB = async function () {
            if (!currentUser) return [];
            const { data, error } = await client
                .from('words')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('word', { ascending: true });
            if (error) throw error;
            return (data || []).map(fromCloudRow);
        };

        window.saveWordDB = async function (wordData) {
            if (!currentUser) throw new Error('Please sign in first.');
            const row = toCloudRow(wordData);
            const { error } = await client
                .from('words')
                .upsert(row, { onConflict: 'word' });
            if (error) throw error;
            return wordData.id || wordData.word;
        };

        window.bulkSaveWordsDB = async function (wordsArray) {
            if (!currentUser) throw new Error('Please sign in first.');
            const rows = (wordsArray || []).filter(w => w && w.word).map(toCloudRow);
            if (!rows.length) return;
            const { error } = await client.from('words').upsert(rows, { onConflict: 'word' });
            if (error) throw error;
        };

        window.deleteWordDB = async function (id) {
            if (!currentUser) throw new Error('Please sign in first.');
            const word = String(id || '').trim();
            if (!word) return;
            const { error } = await client.from('words').delete().eq('word', word).eq('user_id', currentUser.id);
            if (error) throw error;
        };

        window.wipeDatabase = async function () {
            if (!currentUser) throw new Error('Please sign in first.');
            if (!confirm('DANGER: Are you sure you want to erase ALL your vocabulary entries? Make sure you have exported a backup first!')) return;
            const { error } = await client.from('words').delete().eq('user_id', currentUser.id);
            if (error) throw error;
            if (typeof window.showToast === 'function') window.showToast('Cloud vocabulary database wiped clean.', 'info');
            if (typeof window.refreshDataAndUI === 'function') await window.refreshDataAndUI();
        };
    }

    async function setup() {
        await loadSupabaseLibrary();
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        window.vocabSupabase = client;
        installStorageBridge();

        const { data } = await client.auth.getSession();
        currentUser = data.session ? data.session.user : null;

        client.auth.onAuthStateChange(async (_event, session) => {
            currentUser = session ? session.user : null;
            if (currentUser) {
                const overlay = document.getElementById('vocab-auth-overlay');
                if (overlay) overlay.remove();
                await refreshAfterLogin();
            } else {
                addLoginUI();
            }
        });

        if (currentUser) {
            await refreshAfterLogin();
        } else {
            addLoginUI();
        }
    }

    window.addEventListener('DOMContentLoaded', function () {
        setup().catch(err => {
            console.error('Supabase setup failed:', err);
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;padding:30px;font-family:Arial';
            box.textContent = 'Could not connect to Supabase. Please refresh the page.';
            document.body.appendChild(box);
        });
    });
})();
