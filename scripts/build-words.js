// build-words.js — Process word data into sharded JSON packs
// Usage: node scripts/build-words.js [--source <file>] [--out <dir>]

const fs = require('fs');
const path = require('path');

const WORDS_PER_PACK = 500;
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'words');
const SOURCE_FILE = path.join(__dirname, '..', 'data', 'ielts-words.json');

// =============================================================
//  VALIDATION
// =============================================================

const VALID_CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const REQUIRED_FIELDS = [
  'id', 'word', 'phonetic', 'partOfSpeech', 'definition',
  'cefrLevel', 'ieltsFrequency', 'exampleSentence'
];
const OPTIONAL_FIELDS = ['topicTags', 'synonyms', 'antonyms'];

function validateWords(words) {
  const errors = [];
  const seen = new Set();

  for (const w of words) {
    for (const field of REQUIRED_FIELDS) {
      if (w[field] == null || w[field] === '') {
        errors.push(`[${w.word || '?'}] Missing required field: ${field}`);
      }
    }
    if (w.cefrLevel && !VALID_CEFR.includes(w.cefrLevel)) {
      errors.push(`[${w.word}] Invalid cefrLevel "${w.cefrLevel}"`);
    }
    if (w.ieltsFrequency != null && (w.ieltsFrequency < 1 || w.ieltsFrequency > 10)) {
      errors.push(`[${w.word}] ieltsFrequency out of range (1-10): ${w.ieltsFrequency}`);
    }
    const key = (w.word || '').toLowerCase();
    if (key && seen.has(key)) {
      errors.push(`[${w.word}] Duplicate word`);
    }
    if (key) seen.add(key);

    // Ensure optional fields have defaults
    for (const field of OPTIONAL_FIELDS) {
      if (w[field] == null) w[field] = field === 'topicTags' || field === 'synonyms' || field === 'antonyms' ? [] : '';
    }
  }
  return errors;
}

// =============================================================
//  SHARDING
// =============================================================

/**
 * Split words into packs of WORDS_PER_PACK, organized by CEFR level.
 * Each pack contains words from all levels to ensure balanced gameplay.
 */
function shardIntoPacks(words) {
  // Group by CEFR level
  const groups = {};
  for (const w of words) {
    const level = w.cefrLevel;
    if (!groups[level]) groups[level] = [];
    groups[level].push(w);
  }

  // Round-robin distribute into packs
  const packs = [];
  let packIdx = 0;
  let totalAssigned = 0;

  while (totalAssigned < words.length) {
    if (!packs[packIdx]) packs[packIdx] = [];

    // Take one word from each level for this pack (round-robin)
    let added = false;
    for (const level of VALID_CEFR) {
      const group = groups[level];
      if (group && group.length > 0) {
        packs[packIdx].push(group.shift());
        totalAssigned++;
        added = true;
        if (packs[packIdx].length >= WORDS_PER_PACK) break;
      }
    }
    if (!added) break; // Safety

    if (packs[packIdx].length >= WORDS_PER_PACK) {
      packIdx++;
    }
  }

  // Collect any remaining words into a final pack
  let remaining = [];
  for (const level of VALID_CEFR) {
    if (groups[level] && groups[level].length > 0) {
      remaining = remaining.concat(groups[level]);
    }
  }
  if (remaining.length > 0) {
    packs.push(remaining);
  }

  return packs;
}

// =============================================================
//  MANIFEST & OUTPUT
// =============================================================

function buildManifest(packs) {
  return {
    version: 1,
    totalWords: packs.reduce((sum, p) => sum + p.length, 0),
    packCount: packs.length,
    generated: new Date().toISOString().split('T')[0],
    packs: packs.map((pack, i) => {
      const dist = {};
      for (const w of pack) {
        dist[w.cefrLevel] = (dist[w.cefrLevel] || 0) + 1;
      }
      const levelLabels = Object.keys(dist).sort();
      return {
        id: `pack-${String(i + 1).padStart(2, '0')}`,
        file: `pack-${String(i + 1).padStart(2, '0')}.json`,
        count: pack.length,
        cefrDistribution: dist,
        label: levelLabels.length === 1
          ? `Level ${levelLabels[0]}`
          : `${levelLabels[0]}-${levelLabels[levelLabels.length - 1]}`,
      };
    }),
    cefrDistribution: packs.flat().reduce((acc, w) => {
      acc[w.cefrLevel] = (acc[w.cefrLevel] || 0) + 1;
      return acc;
    }, {}),
    source: 'IELTS vocabulary compilation (AI-generated)',
  };
}

function writeOutput(packs, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const manifest = buildManifest(packs);

  // Write each pack
  for (let i = 0; i < packs.length; i++) {
    const packMeta = manifest.packs[i];
    const filePath = path.join(outputDir, packMeta.file);
    const packData = {
      meta: {
        version: manifest.version,
        packId: packMeta.id,
        count: packMeta.count,
        cefrDistribution: packMeta.cefrDistribution,
        generated: manifest.generated,
      },
      words: packs[i],
    };
    fs.writeFileSync(filePath, JSON.stringify(packData, null, 2));
    console.log(`  ✅ ${packMeta.file} — ${packMeta.count} words (${packMeta.label})`);
  }

  // Write manifest
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n📋 manifest.json — ${manifest.totalWords} total words, ${manifest.packCount} packs`);
  console.log(`📁 Output: ${outputDir}/`);
}

// =============================================================
//  MAIN
// =============================================================

function main() {
  const args = process.argv.slice(2);
  const sourceFlag = args.indexOf('--source');
  const outFlag = args.indexOf('--out');

  const sourcePath = sourceFlag >= 0 ? args[sourceFlag + 1] : SOURCE_FILE;
  const outputDir = outFlag >= 0 ? args[outFlag + 1] : OUTPUT_DIR;

  console.log('[Build] IELTS Beach Word Bank Builder');
  console.log(`[Build] Source: ${sourcePath}`);

  if (!fs.existsSync(sourcePath)) {
    console.error(`[Build] ❌ Source file not found: ${sourcePath}`);
    console.error('[Build] Place your word data JSON at data/ielts-words.json or use --source <path>');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  const words = Array.isArray(raw) ? raw : raw.words;

  console.log(`[Build] Loaded ${words.length} words`);

  // Validate
  console.log('[Build] Validating...');
  const errors = validateWords(words);
  if (errors.length > 0) {
    console.error(`[Build] ❌ ${errors.length} validation errors:`);
    for (const err of errors.slice(0, 20)) console.error(`  - ${err}`);
    if (errors.length > 20) console.error(`  ... and ${errors.length - 20} more`);
    process.exit(1);
  }
  console.log('[Build] ✅ Validation passed');

  // Shard
  console.log('[Build] Sharding into packs...');
  const packs = shardIntoPacks(words);
  console.log(`[Build] ${packs.length} packs created`);

  // Output
  writeOutput(packs, outputDir);
  console.log('[Build] ✅ Done!');
}

main();
