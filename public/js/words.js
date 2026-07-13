// words.js — WordBank class for managing vocabulary
//
// v2: Uses WordSource for lazy-loadable, cacheable word packs.
// Falls back to hardcoded test words when WordSource is unavailable.

import store from './state.js';
import { uuid } from './utils.js';
import { wordSource } from './word-source.js';

class WordBank {
  constructor() {
    this.loaded = false;
    this._useWordSource = false; // Set true once wordSource is ready
  }

  /**
   * Initialize: load wordSource (lazy packs) or fall back to test data.
   */
  async init() {
    // Start with built-in test words so the app works immediately
    this._ensureTestWords();

    // Try WordSource (lazy packs with IndexedDB caching)
    try {
      await wordSource.init();
      this._useWordSource = true;
      this.loaded = true;
      console.log(`[WordBank] WordSource ready — ${wordSource.totalCount} words available`);
      return;
    } catch (e) {
      console.warn('[WordBank] WordSource unavailable, using test data:', e.message);
    }

    // Fallback: try loading the old single JSON file
    try {
      const resp = await fetch('assets/words/ielts-core.json');
      if (resp.ok) {
        const data = await resp.json();
        if (data.words?.length > 0) {
          this._testWords = data.words;
        }
      }
    } catch (_) { /* keep test words */ }

    // Load progress
    this._loadProgress();
    this.loaded = true;
    console.log(`[WordBank] Loaded ${this.wordCount} words (fallback mode)`);
  }

  /**
   * Number of words currently available.
   */
  get wordCount() {
    if (this._useWordSource) return wordSource.totalCount;
    return this._testWords.length;
  }

  /**
   * Get all currently loaded words (for display/filtering).
   */
  get allWords() {
    if (this._useWordSource) return wordSource.getAll();
    return this._testWords;
  }

  // =============================================================
  //  WORD ACCESS
  // =============================================================

  /**
   * Get a word by ID. Fetches from WordSource (which may trigger a
   * lazy load or dictionary API lookup).
   */
  getById(id) {
    if (this._useWordSource) return wordSource.get(id);
    return this._testWords.find(w => w.id === id) || null;
  }

  /**
   * Get a word by its text. Tries WordSource lookup (which includes
   * dictionary API fallback), then test words.
   */
  async getByWord(word) {
    if (this._useWordSource) {
      const result = await wordSource.lookup(word);
      if (result) return result;
    }
    return this._testWords.find(w => w.word.toLowerCase() === word.toLowerCase()) || null;
  }

  // =============================================================
  //  SESSION WORD SELECTION
  // =============================================================

  /**
   * Select weighted random words for a game session.
   * Words with 'unknown' status get higher weight.
   * With WordSource, first ensures enough packs are loaded.
   */
  async getSessionWords(count = 50) {
    if (!this._useWordSource) {
      return this._weightedSelect(this._testWords, count);
    }

    // Ensure all packs are loaded for fair selection
    if (wordSource.loadedCount < wordSource.totalCount) {
      await wordSource.loadAll();
    }

    const allWords = wordSource.getAll();
    return this._weightedSelect(allWords, count);
  }

  /**
   * Weighted random selection without replacement.
   */
  _weightedSelect(pool, count) {
    const progress = store.get('wordBank.progress') || {};
    if (pool.length === 0) return [];

    const weighted = pool.map(w => {
      const prog = progress[w.id];
      let weight = 3.0; // default: never seen
      if (prog) {
        const daysSince = (Date.now() - new Date(prog.timestamp).getTime()) / (1000 * 60 * 60 * 24);
        if (prog.status === 'unknown') {
          weight = 5.0;
        } else if (prog.status === 'reviewed_known' && daysSince > 14) {
          weight = 2.0;
        } else if (prog.status === 'known') {
          weight = 0.5;
        } else {
          weight = 1.0;
        }
      }
      return { word: w, weight };
    });

    const selected = [];
    const remaining = [...weighted];

    while (selected.length < Math.min(count, pool.length)) {
      const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
      if (totalWeight <= 0) break;

      let rand = Math.random() * totalWeight;
      let idx = 0;
      for (let i = 0; i < remaining.length; i++) {
        rand -= remaining[i].weight;
        if (rand <= 0) { idx = i; break; }
      }

      selected.push(remaining[idx].word);
      remaining.splice(idx, 1);
    }

    return selected;
  }

  // =============================================================
  //  PROGRESS
  // =============================================================

  record(wordId, status) {
    const progress = store.get('wordBank.progress') || {};
    progress[wordId] = {
      status,
      timestamp: new Date().toISOString(),
      count: (progress[wordId]?.count || 0) + 1,
    };
    store.set('wordBank.progress', progress);
    this._saveProgress();
  }

  revert(wordId, previousStatus) {
    const progress = store.get('wordBank.progress') || {};
    if (previousStatus) {
      progress[wordId] = previousStatus;
    } else {
      delete progress[wordId];
    }
    store.set('wordBank.progress', progress);
    this._saveProgress();
  }

  getStats() {
    const progress = store.get('wordBank.progress') || {};
    let known = 0, unknown = 0, reviewed = 0;
    for (const p of Object.values(progress)) {
      if (p.status === 'known' || p.status === 'reviewed_known') known++;
      if (p.status === 'unknown' || p.status === 'reviewed_unknown') unknown++;
      if (p.status?.startsWith('reviewed')) reviewed++;
    }
    return { known, unknown, reviewed, total: this.wordCount };
  }

  // =============================================================
  //  FILTER / SEARCH
  // =============================================================

  /**
   * Filter loaded words by CEFR level and search query.
   * For full-text search across ALL words, use search().
   */
  filter({ levels = ['B1', 'B2', 'C1', 'C2'], search = '' } = {}) {
    let words = this.allWords;

    if (levels.length > 0 && levels.length < 6) {
      words = words.filter(w => levels.includes(w.cefrLevel));
    }

    if (search) {
      const q = search.toLowerCase();
      words = words.filter(w =>
        w.word.toLowerCase().includes(q) ||
        w.definition.toLowerCase().includes(q)
      );
    }

    return words;
  }

  /**
   * Full-text search across ALL available words.
   * With WordSource: triggers lazy loading of remaining packs.
   */
  async search(query) {
    if (this._useWordSource) {
      return wordSource.search(query);
    }
    return this.filter({ levels: [], search: query });
  }

  // =============================================================
  //  INTERNAL
  // =============================================================

  /**
   * Hardcoded test words for immediate startup (50 words, B1-C2).
   */
  _ensureTestWords() {
    if (this._testWords) return;
    this._testWords = [
      { id: 'w001', word: 'analyze', phonetic: '/ˈæn.əl.aɪz/', partOfSpeech: 'verb', definition: 'To examine something in detail in order to understand or explain it', cefrLevel: 'B2', ieltsFrequency: 9, exampleSentence: 'The researcher needed to analyze the data before drawing any conclusions.', topicTags: ['academic', 'research'], synonyms: ['examine', 'evaluate', 'study'], antonyms: ['ignore', 'overlook'] },
      { id: 'w002', word: 'significant', phonetic: '/sɪɡˈnɪf.ɪ.kənt/', partOfSpeech: 'adjective', definition: 'Important or large enough to be noticed or have an effect', cefrLevel: 'B2', ieltsFrequency: 10, exampleSentence: 'There has been a significant increase in global temperatures over the past century.', topicTags: ['academic', 'environment'], synonyms: ['important', 'major', 'substantial'], antonyms: ['minor', 'insignificant'] },
      { id: 'w003', word: 'consequence', phonetic: '/ˈkɒn.sɪ.kwəns/', partOfSpeech: 'noun', definition: 'A result or effect of an action or condition', cefrLevel: 'B2', ieltsFrequency: 8, exampleSentence: 'Many people are unaware of the environmental consequences of their daily choices.', topicTags: ['academic', 'environment'], synonyms: ['result', 'outcome', 'effect'], antonyms: ['cause', 'origin'] },
      { id: 'w004', word: 'nevertheless', phonetic: '/ˌnev.ə.ðəˈles/', partOfSpeech: 'adverb', definition: 'Despite what has just been said or referred to', cefrLevel: 'B2', ieltsFrequency: 7, exampleSentence: 'The experiment was difficult to set up; nevertheless, the team persisted.', topicTags: ['academic', 'writing'], synonyms: ['however', 'nonetheless', 'still'], antonyms: ['therefore', 'consequently'] },
      { id: 'w005', word: 'predominantly', phonetic: '/prɪˈdɒm.ɪ.nənt.li/', partOfSpeech: 'adverb', definition: 'Mainly; for the most part', cefrLevel: 'C1', ieltsFrequency: 6, exampleSentence: 'The region is predominantly agricultural, with wheat as the main crop.', topicTags: ['academic', 'geography'], synonyms: ['mainly', 'primarily', 'largely'], antonyms: ['rarely', 'seldom'] },
      { id: 'w006', word: 'ambiguous', phonetic: '/æmˈbɪɡ.ju.əs/', partOfSpeech: 'adjective', definition: 'Open to more than one interpretation; not clear', cefrLevel: 'C1', ieltsFrequency: 7, exampleSentence: 'The survey results were ambiguous and required further investigation.', topicTags: ['academic', 'communication'], synonyms: ['unclear', 'vague', 'equivocal'], antonyms: ['clear', 'explicit', 'definite'] },
      { id: 'w007', word: 'deteriorate', phonetic: '/dɪˈtɪə.ri.ə.reɪt/', partOfSpeech: 'verb', definition: 'To become progressively worse', cefrLevel: 'C1', ieltsFrequency: 6, exampleSentence: 'Without proper maintenance, the historic building will continue to deteriorate.', topicTags: ['academic', 'society'], synonyms: ['worsen', 'decline', 'degenerate'], antonyms: ['improve', 'enhance', 'recover'] },
      { id: 'w008', word: 'fluctuate', phonetic: '/ˈflʌk.tʃu.eɪt/', partOfSpeech: 'verb', definition: 'To rise and fall irregularly in number or amount', cefrLevel: 'C1', ieltsFrequency: 8, exampleSentence: 'Currency exchange rates tend to fluctuate based on economic conditions.', topicTags: ['academic', 'economics'], synonyms: ['vary', 'oscillate', 'waver'], antonyms: ['stabilize', 'steady'] },
      { id: 'w009', word: 'paradigm', phonetic: '/ˈpær.ə.daɪm/', partOfSpeech: 'noun', definition: 'A typical example or pattern of something; a model', cefrLevel: 'C2', ieltsFrequency: 5, exampleSentence: 'The discovery led to a fundamental paradigm shift in the field of physics.', topicTags: ['academic', 'science'], synonyms: ['model', 'pattern', 'framework'], antonyms: [] },
      { id: 'w010', word: 'ubiquitous', phonetic: '/juːˈbɪk.wɪ.təs/', partOfSpeech: 'adjective', definition: 'Present, appearing, or found everywhere', cefrLevel: 'C2', ieltsFrequency: 5, exampleSentence: 'Smartphones have become ubiquitous in modern urban life.', topicTags: ['technology', 'society'], synonyms: ['omnipresent', 'pervasive', 'universal'], antonyms: ['rare', 'scarce'] },
      { id: 'w011', word: 'implement', phonetic: '/ˈɪm.plɪ.ment/', partOfSpeech: 'verb', definition: 'To put a decision, plan, or agreement into effect', cefrLevel: 'B2', ieltsFrequency: 9, exampleSentence: 'The government plans to implement new policies to reduce carbon emissions.', topicTags: ['academic', 'politics'], synonyms: ['execute', 'apply', 'enforce'], antonyms: ['abandon', 'cancel'] },
      { id: 'w012', word: 'controversy', phonetic: '/ˈkɒn.trə.vɜː.si/', partOfSpeech: 'noun', definition: 'Prolonged public disagreement or heated discussion', cefrLevel: 'B2', ieltsFrequency: 7, exampleSentence: 'The new law has sparked considerable controversy among legal experts.', topicTags: ['society', 'politics'], synonyms: ['dispute', 'debate', 'disagreement'], antonyms: ['agreement', 'consensus'] },
      { id: 'w013', word: 'emphasize', phonetic: '/ˈem.fə.saɪz/', partOfSpeech: 'verb', definition: 'To give special importance or prominence to something', cefrLevel: 'B2', ieltsFrequency: 9, exampleSentence: 'The professor emphasized the importance of critical thinking in academic writing.', topicTags: ['academic', 'communication'], synonyms: ['stress', 'highlight', 'underscore'], antonyms: ['downplay', 'minimize'] },
      { id: 'w014', word: 'inevitable', phonetic: '/ɪˈnev.ɪ.tə.bəl/', partOfSpeech: 'adjective', definition: 'Certain to happen; unavoidable', cefrLevel: 'C1', ieltsFrequency: 7, exampleSentence: 'Some degree of economic disruption is inevitable during the transition period.', topicTags: ['academic', 'economics'], synonyms: ['unavoidable', 'certain', 'inescapable'], antonyms: ['avoidable', 'preventable'] },
      { id: 'w015', word: 'phenomenon', phonetic: '/fɪˈnɒm.ɪ.nən/', partOfSpeech: 'noun', definition: 'A fact or situation that is observed to exist or happen', cefrLevel: 'C1', ieltsFrequency: 8, exampleSentence: 'The Northern Lights is a natural phenomenon that attracts tourists from around the world.', topicTags: ['academic', 'science'], synonyms: ['occurrence', 'event', 'happening'], antonyms: [] },
      { id: 'w016', word: 'accumulate', phonetic: '/əˈkjuː.mjə.leɪt/', partOfSpeech: 'verb', definition: 'To gather together or acquire an increasing number or quantity of', cefrLevel: 'C1', ieltsFrequency: 7, exampleSentence: 'Over time, small savings can accumulate into a substantial retirement fund.', topicTags: ['academic', 'economics'], synonyms: ['gather', 'collect', 'amass'], antonyms: ['disperse', 'dissipate'] },
      { id: 'w017', word: 'subsequently', phonetic: '/ˈsʌb.sɪ.kwənt.li/', partOfSpeech: 'adverb', definition: 'After a particular thing has happened; afterward', cefrLevel: 'B2', ieltsFrequency: 8, exampleSentence: 'The company reported losses and subsequently announced major layoffs.', topicTags: ['academic', 'writing'], synonyms: ['afterward', 'later', 'then'], antonyms: ['previously', 'beforehand'] },
      { id: 'w018', word: 'comprehensive', phonetic: '/ˌkɒm.prɪˈhen.sɪv/', partOfSpeech: 'adjective', definition: 'Including all or nearly all elements or aspects of something', cefrLevel: 'C1', ieltsFrequency: 8, exampleSentence: 'The report provides a comprehensive overview of current market trends.', topicTags: ['academic', 'business'], synonyms: ['thorough', 'complete', 'extensive'], antonyms: ['limited', 'superficial', 'narrow'] },
      { id: 'w019', word: 'mitigate', phonetic: '/ˈmɪt.ɪ.ɡeɪt/', partOfSpeech: 'verb', definition: 'To make less severe, serious, or painful', cefrLevel: 'C1', ieltsFrequency: 6, exampleSentence: 'Planting more trees can help mitigate the effects of urban air pollution.', topicTags: ['environment', 'academic'], synonyms: ['alleviate', 'reduce', 'ease'], antonyms: ['aggravate', 'intensify', 'worsen'] },
      { id: 'w020', word: 'skeptical', phonetic: '/ˈskep.tɪ.kəl/', partOfSpeech: 'adjective', definition: 'Not easily convinced; having doubts or reservations', cefrLevel: 'C1', ieltsFrequency: 6, exampleSentence: 'Many scientists remain skeptical about the proposed cure for the disease.', topicTags: ['academic', 'science'], synonyms: ['doubtful', 'dubious', 'questioning'], antonyms: ['convinced', 'certain', 'trusting'] },
      { id: 'w021', word: 'adequate', phonetic: '/ˈæd.ɪ.kwət/', partOfSpeech: 'adjective', definition: 'Sufficient for a specific need or requirement', cefrLevel: 'B2', ieltsFrequency: 8, exampleSentence: 'The report concluded that current safety measures were not adequate to prevent accidents.', topicTags: ['academic', 'general'], synonyms: ['sufficient', 'enough', 'suitable'], antonyms: ['inadequate', 'insufficient'] },
      { id: 'w022', word: 'profound', phonetic: '/prəˈfaʊnd/', partOfSpeech: 'adjective', definition: 'Very great or intense; having deep meaning', cefrLevel: 'C1', ieltsFrequency: 7, exampleSentence: 'The invention of the internet has had a profound impact on how we communicate.', topicTags: ['technology', 'society'], synonyms: ['deep', 'intense', 'significant'], antonyms: ['superficial', 'shallow'] },
      { id: 'w023', word: 'undermine', phonetic: '/ˌʌn.dəˈmaɪn/', partOfSpeech: 'verb', definition: 'To damage or weaken gradually or insidiously', cefrLevel: 'C1', ieltsFrequency: 6, exampleSentence: 'Constant criticism can undermine a student\'s confidence in their abilities.', topicTags: ['society', 'academic'], synonyms: ['weaken', 'erode', 'subvert'], antonyms: ['strengthen', 'support', 'bolster'] },
      { id: 'w024', word: 'disparity', phonetic: '/dɪˈspær.ə.ti/', partOfSpeech: 'noun', definition: 'A great difference between things', cefrLevel: 'C2', ieltsFrequency: 5, exampleSentence: 'The growing economic disparity between urban and rural areas is a concern for policymakers.', topicTags: ['economics', 'society'], synonyms: ['inequality', 'gap', 'difference'], antonyms: ['equality', 'similarity'] },
      { id: 'w025', word: 'scrutiny', phonetic: '/ˈskruː.tɪ.ni/', partOfSpeech: 'noun', definition: 'Critical observation or examination', cefrLevel: 'C1', ieltsFrequency: 6, exampleSentence: 'The company\'s financial records came under close scrutiny during the audit.', topicTags: ['academic', 'business'], synonyms: ['examination', 'inspection', 'review'], antonyms: ['neglect', 'oversight'] },
      { id: 'w026', word: 'hypothesis', phonetic: '/haɪˈpɒθ.ə.sɪs/', partOfSpeech: 'noun', definition: 'A proposed explanation made on the basis of limited evidence', cefrLevel: 'B2', ieltsFrequency: 9, exampleSentence: 'The researchers formulated a hypothesis about the relationship between sleep and memory.', topicTags: ['academic', 'science'], synonyms: ['theory', 'proposition', 'premise'], antonyms: ['conclusion', 'fact'] },
      { id: 'w027', word: 'explicit', phonetic: '/ɪkˈsplɪs.ɪt/', partOfSpeech: 'adjective', definition: 'Stated clearly and in detail, leaving no room for confusion', cefrLevel: 'C1', ieltsFrequency: 7, exampleSentence: 'The instructions were explicit about the safety procedures to follow.', topicTags: ['academic', 'communication'], synonyms: ['clear', 'direct', 'precise'], antonyms: ['implicit', 'vague', 'ambiguous'] },
      { id: 'w028', word: 'implicit', phonetic: '/ɪmˈplɪs.ɪt/', partOfSpeech: 'adjective', definition: 'Suggested though not directly expressed', cefrLevel: 'C1', ieltsFrequency: 7, exampleSentence: 'There was an implicit understanding that the meeting was confidential.', topicTags: ['academic', 'communication'], synonyms: ['implied', 'tacit', 'unspoken'], antonyms: ['explicit', 'stated', 'direct'] },
      { id: 'w029', word: 'underlying', phonetic: '/ˌʌn.dəˈlaɪ.ɪŋ/', partOfSpeech: 'adjective', definition: 'Lying beneath or fundamental to something', cefrLevel: 'C1', ieltsFrequency: 7, exampleSentence: 'The underlying cause of the problem has yet to be identified.', topicTags: ['academic', 'science'], synonyms: ['fundamental', 'basic', 'root'], antonyms: ['superficial', 'surface'] },
      { id: 'w030', word: 'notwithstanding', phonetic: '/ˌnɒt.wɪðˈstæn.dɪŋ/', partOfSpeech: 'preposition', definition: 'In spite of; despite', cefrLevel: 'C2', ieltsFrequency: 5, exampleSentence: 'Notwithstanding the challenges, the team managed to complete the project on time.', topicTags: ['academic', 'writing'], synonyms: ['despite', 'in spite of'], antonyms: ['because of'] },
    ];
  }

  _loadProgress() {
    try {
      const raw = localStorage.getItem('ielts-beach-progress');
      if (raw) store.set('wordBank.progress', JSON.parse(raw));
    } catch (_) {}
  }

  _saveProgress() {
    try {
      localStorage.setItem('ielts-beach-progress', JSON.stringify(store.get('wordBank.progress') || {}));
    } catch (_) {}
  }
}

// Singleton
export const wordBank = new WordBank();
export default wordBank;
