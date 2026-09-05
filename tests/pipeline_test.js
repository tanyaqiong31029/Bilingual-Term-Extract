'use strict';
/* Bilingual-Term-Extract —— 无头回归测试（node 直跑，无需浏览器，零依赖）
 * 运行：node tests/pipeline_test.js   （或 npm test）
 * 改动 tokenizer/candidates/vote/exporters/validate/finalize/tmx/docximport 后必须全绿。
 */
const path = require('path');
const fs = require('fs');
const SRC = path.join(__dirname, '..', 'scripts');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  => ' + JSON.stringify(detail) : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}
function section(name) { console.log('== ' + name + ' =='); }

const U = require(path.join(SRC, 'core/util.js'));
const Seg = require(path.join(SRC, 'core/segmenter.js'));
const Tok = require(path.join(SRC, 'core/tokenizer.js'));
const SW = require(path.join(SRC, 'core/stopwords.js'));
const Cand = require(path.join(SRC, 'core/candidates.js'));
const Vote = require(path.join(SRC, 'core/vote.js'));
const Exp = require(path.join(SRC, 'core/exporters.js'));
const Imp = require(path.join(SRC, 'core/docximport.js'));
const Tmx = require(path.join(SRC, 'core/tmx.js'));
const { validateDecisions, normKey } = require(path.join(SRC, 'validate.js'));
const { finalize } = require(path.join(SRC, 'finalize.js'));
const TE = require(path.join(SRC, 'term_extract.js'));

/* ---------- util ---------- */
section('util');
ok('charClass 中文', U.charClass('中'.codePointAt(0)) === 'han');
ok('charClass 拉丁', U.charClass('a'.codePointAt(0)) === 'latin');
ok('weightedLen 汉字 2.3', Math.abs(U.weightedLen('中文') - 4.6) < 1e-9);
eq('normLang en-US', U.normLang('en-US'), 'en');
eq('normLang zh', U.normLang('zh'), 'zh-CN');
eq('normLang zh_CN', U.normLang('zh_CN'), 'zh-CN');
eq('normLang zh-TW 保留', U.normLang('zh-TW'), 'zh-TW');

/* ---------- segmenter ---------- */
section('segmenter');
eq('中文分句', Seg.segmentPlain('第一句。第二句！第三句？', 'zh-CN'), ['第一句。', '第二句！', '第三句？']);
ok('缩写不切分', Seg.segmentPlain('Dr. Smith went to Washington. He left.', 'en').length === 2,
  Seg.segmentPlain('Dr. Smith went to Washington. He left.', 'en'));
eq('detectLang en', Seg.detectLang('Hello world, this is a test.'), 'en');
eq('detectLang zh', Seg.detectLang('你好，世界。这是一个测试。'), 'zh-CN');
ok('段落编号', Seg.segmentRich('段一A。段一B。\n\n段二。', 'zh-CN').map(s => s.para).join(',') === '0,0,1');

/* ---------- tokenizer ---------- */
section('tokenizer');
const toks = Tok.tokenize('Edge Computing, real-time 5G.');
eq('拉丁词元', toks.map(t => t.norm), ['edge', 'computing', 'real-time', '5g']);
ok('逗号产生 brk（仅其后词元）', toks[2].brk === true && toks[1].brk === false && toks[0].brk === false);
const zt = Tok.tokenize('边缘计算。');
ok('CJK 逐字', zt.length === 4 && zt.every(t => t.cjk));
eq('foldSingular', ['sensors', 'classes', 'process', 'devices', 'gateways'].map(Tok.foldSingular),
  ['sensor', 'class', 'process', 'device', 'gateway']);
eq('joinTokens 拉丁空格', Tok.joinTokens(Tok.tokenize('hello world')), 'hello world');
eq('joinTokens CJK 拼接', Tok.joinTokens(Tok.tokenize('边缘计算')), '边缘计算');
eq('keyOf 归一键', Tok.keyOf(Tok.tokenize('Internet of Things')), 'internet of thing');

/* ---------- stopwords ---------- */
section('stopwords');
ok('EN the', SW.isStopEn('the'));
ok('EN gateway 非停用', !SW.isStopEn('gateway'));
ok('ZH 的', SW.isZhStopChar('的'));
ok('ZH 点非停用（节点）', !SW.isZhStopChar('点'));
ok('ZH 分非停用（分布式）', !SW.isZhStopChar('分'));
ok('ZH 网非停用（物联网）', !SW.isZhStopChar('网'));
ok('ZH 可以整词', SW.isZhStopWord('可以'));
ok('ZH 边缘计算非停用', !SW.isZhStopWord('边缘计算'));

/* ---------- candidates：拉丁 + C-value 嵌套折扣 ---------- */
section('candidates 拉丁');
const enPairs = [
  { src: 'The neural network model processes images', tgt: '甲' },
  { src: 'The neural network needs more data', tgt: '乙' },
  { src: 'A neural network model improves accuracy', tgt: '丙' },
  { src: 'The neural part failed', tgt: '丁' }
];
const enC = Cand.extractCandidates(enPairs, { minFreq: 2, topN: 100 }).candidates;
const byNorm = n => enC.find(c => c.norm === n);
ok('neural network 召回', !!byNorm('neural network'));
eq('neural network 频次', byNorm('neural network') && byNorm('neural network').freq, 3);
eq('neural network spread', byNorm('neural network') && byNorm('neural network').spread.size, 3);
ok('neural 嵌套折扣 effFreq < freq', byNorm('neural') && byNorm('neural').effFreq < byNorm('neural').freq,
  byNorm('neural') && { freq: byNorm('neural').freq, eff: byNorm('neural').effFreq });
ok('the 停用词排除', !byNorm('the'));
ok('neural network model 召回（3 词）', !!byNorm('neural network model'));
ok('上下文带句对', byNorm('neural network').contexts.length > 0 && 'src' in byNorm('neural network').contexts[0]);

/* ---------- candidates：中文 + PMI ---------- */
section('candidates 中文');
const zhPairs = [
  { src: '机器学习改变世界', tgt: 'x' },
  { src: '机器学习很重要', tgt: 'x' },
  { src: '学习机器维修指南', tgt: 'x' },
  { src: '机器学习模型强大', tgt: 'x' },
  { src: '机器学习方法很多', tgt: 'x' }
];
const zhC = Cand.extractCandidates(zhPairs, { minFreq: 2, topN: 200 }).candidates;
const zhBy = n => zhC.find(c => c.norm === n);
ok('机器学习 召回', !!zhBy('机器学习'));
ok('机器学习 minPMI 达标', zhBy('机器学习') && zhBy('机器学习').minPMI >= Cand.DEFAULTS.minPMI, zhBy('机器学习') && zhBy('机器学习').minPMI);
ok('学习机器 低频排除', !zhBy('学习机器'));
ok('学习 嵌套折扣', zhBy('学习') && zhBy('学习').effFreq < zhBy('学习').freq);
ok('机器学习 排名高于 学习', zhC.findIndex(c => c.norm === '机器学习') < zhC.findIndex(c => c.norm === '学习'));

/* ---------- vote：玩具语料 ---------- */
section('vote');
const toyPairs = [
  { src: 'the cat eats fish', tgt: '猫吃鱼' },
  { src: 'the dog eats meat', tgt: '狗吃肉' },
  { src: 'a cat and a dog', tgt: '猫和狗' },
  { src: 'the cat sleeps', tgt: '猫睡觉' },
  { src: 'a bird sings', tgt: '鸟唱歌' }
];
const toyC = Cand.extractCandidates(toyPairs, { minFreq: 1, topN: 100 }).candidates;
Vote.voteTranslations(toyC, toyPairs);
const toyBy = n => toyC.find(c => c.norm === n);
ok('cat → 猫', toyBy('cat') && toyBy('cat').translations[0] && toyBy('cat').translations[0].t === '猫',
  toyBy('cat') && toyBy('cat').translations);
eq('cat statConf', toyBy('cat') && toyBy('cat').statConf, 1);
ok('eat → 吃（foldSingular 后的 norm）', toyBy('eat') && toyBy('eat').translations[0] && toyBy('eat').translations[0].t === '吃',
  toyBy('eat') && toyBy('eat').translations);
ok('dog → 狗', toyBy('dog') && toyBy('dog').translations[0] && toyBy('dog').translations[0].t === '狗',
  toyBy('dog') && toyBy('dog').translations);
ok('bird 单句出现跳过投票（dfT=1）', toyBy('bird') && toyBy('bird').translations.length === 0 && toyBy('bird').statConf === 0);
ok('translations 最多 3 条', toyC.every(c => (c.translations || []).length <= 3));

/* ---------- exporters ---------- */
section('exporters');
const entries = [
  { src: 'a<b>', tgt: '边"缘"', freq: 2, conf: 0.9, status: 'confirmed', pos: 'noun', domain: '测试', note: '' },
  { src: 'plain, comma', tgt: '普通', freq: 1, conf: 0.5, status: 'review', pos: '', domain: '', note: 'x|y' }
];
const tbx = Exp.toTBX(entries, 'en', 'zh-CN', '测试表');
ok('TBX 头', tbx.includes('<martif type="TBX"') && tbx.includes('<body>'));
ok('TBX XML 转义', tbx.includes('a&lt;b&gt;') && tbx.includes('边&quot;缘&quot;'));
ok('TBX langSet', tbx.includes('xml:lang="en"') && tbx.includes('xml:lang="zh-CN"'));
ok('TBX termEntry 计数', (tbx.match(/<termEntry /g) || []).length === 2);
const csv = Exp.toCSV(entries);
ok('CSV BOM', csv.charCodeAt(0) === 0xFEFF);
ok('CSV 引号包裹逗号', csv.includes('"plain, comma"'));
ok('CSV 行数', csv.trim().split('\n').length === 3);
const md = Exp.toMD(entries, 'en', 'zh-CN');
ok('MD 管道转义', md.includes('x\\|y'));
const json = Exp.toJSON(entries, { a: 1 });
ok('JSON 结构', JSON.parse(json).terms.length === 2 && JSON.parse(json).meta.a === 1);

/* ---------- validate ---------- */
section('validate');
const fakeCands = [{ term: 'edge computing', norm: 'edge computing', freq: 3, occurrences: [] }];
eq('合法 decisions', validateDecisions([{ term: 'edge computing', accept: true, tgt: '边缘计算', conf: 0.95 }], fakeCands).valid, true);
ok('norm 匹配大小写', validateDecisions([{ term: 'Edge Computing', accept: true }], fakeCands).valid === true);
ok('未知术语报错', validateDecisions([{ term: 'nonexistent', accept: true }], fakeCands).valid === false);
ok('accept 缺失报错', validateDecisions([{ term: 'edge computing' }], fakeCands).valid === false);
ok('conf 越界报错', validateDecisions([{ term: 'edge computing', accept: true, conf: 1.5 }], fakeCands).valid === false);
ok('重复术语报错', validateDecisions([{ term: 'edge computing', accept: true }, { term: 'edge computing', accept: true }], fakeCands).valid === false);
eq('undecided 计数', validateDecisions([{ term: 'edge computing', accept: true }], fakeCands).undecided, 0);
eq('normKey 一致性', normKey('Edge Computing'), 'edge computing');

/* ---------- finalize ---------- */
section('finalize');
const fCands = {
  meta: { srcLang: 'en', tgtLang: 'zh-CN' },
  candidates: [
    { term: 'alpha', norm: 'alpha', freq: 3, statConf: 0.9, translations: [{ t: '甲', votes: 3 }], occurrences: [] },
    { term: 'beta', norm: 'beta', freq: 2, statConf: 0.4, translations: [{ t: '乙', votes: 1 }], occurrences: [] },
    { term: 'gamma', norm: 'gamma', freq: 2, statConf: 1, translations: [{ t: '丙', votes: 2 }], occurrences: [] },
    { term: 'delta', norm: 'delta', freq: 5, statConf: 0.85, translations: [{ t: '丁', votes: 4 }], occurrences: [] }
  ]
};
const fDecisions = [
  { term: 'alpha', accept: true, tgt: '甲', conf: 0.95, pos: 'noun', domain: '测试' },
  { term: 'beta', accept: true, conf: 0.4 },
  { term: 'gamma', accept: false, note: '非术语' }
];
const r1 = finalize(fCands, fDecisions, { autoConf: 0.75, minConf: 0.6, includeReview: false });
eq('导出条数（review 默认排除）', r1.terms.length, 2);
eq('alpha confirmed + LLM 译文', [r1.terms[0].src, r1.terms[0].status, r1.terms[0].tgt, r1.terms[0].conf], ['alpha', 'confirmed', '甲', 0.95]);
eq('delta auto + 统计译文', [r1.terms[1].src, r1.terms[1].status, r1.terms[1].tgt], ['delta', 'auto', '丁']);
eq('gamma 被拒', r1.report.rejectedCount, 1);
ok('被拒者不导出', !r1.terms.some(t => t.src === 'gamma'));
eq('report 计数', [r1.report.confirmed, r1.report.auto, r1.report.review], [1, 1, 1]);
const r2 = finalize(fCands, fDecisions, { autoConf: 0.75, minConf: 0.6, includeReview: true });
eq('includeReview 导出 review', r2.terms.length, 3);
ok('beta review 译文回退统计', r2.terms.find(t => t.src === 'beta').tgt === '乙');
const r3 = finalize(fCands, [], { autoConf: 0.75, minConf: 0.6, includeReview: true });
eq('无 decisions 时低置信进 review', r3.terms.find(t => t.src === 'beta').status, 'review');
eq('无 decisions 时高置信 auto', r3.terms.find(t => t.src === 'delta').status, 'auto');

/* ---------- tmx ---------- */
section('tmx');
const tmxText = '<?xml version="1.0"?><tmx version="1.4"><body>' +
  '<tu><tuv xml:lang="en"><seg>Hello <bpt i="1">X</bpt>world</seg></tuv><tuv xml:lang="zh"><seg>你好世界</seg></tuv></tu>' +
  '<tu><tuv xml:lang="en-US"><seg>Edge computing</seg></tuv><tuv xml:lang="zh-CN"><seg>边缘计算</seg></tuv></tu>' +
  '<tu><tuv xml:lang="en"><seg>only one side</seg></tuv></tu>' +
  '</body></tmx>';
eq('parseTmx 过滤单语 tu', Tmx.parseTmx(tmxText).length, 2);
const tmxPairs = Tmx.extractPairs(tmxText, 'en', 'zh-CN');
eq('extractPairs 语言前缀匹配', tmxPairs.length, 2);
ok('行内标签剥离', tmxPairs[0].src.includes('Hello') && tmxPairs[0].src.includes('world'), tmxPairs[0].src);

/* ---------- docximport ---------- */
section('docximport');
eq('decodeText UTF-8', Imp.decodeText(Buffer.from('中文测试 hello', 'utf8')), '中文测试 hello');
ok('decodeText GBK', Imp.decodeText(Uint8Array.from([0xD6, 0xD0, 0xCE, 0xC4])) === '中文');

/* ---------- srt/vtt 导入 ---------- */
section('srt');
const Srt = require(path.join(SRC, 'core/srt.js'));
eq('tsToMs 带小时', Srt.tsToMs('00:01:02,500'), 62500);
eq('tsToMs 无小时 + 点（VTT）', Srt.tsToMs('01:02.500'), 62500);
const srtText = '1\n00:00:01,000 --> 00:00:02,000\n<i>Edge computing</i>\n\n' +
  '2\n00:00:03,000 --> 00:00:04,000\nreshapes {\\an8}networks\n\nNOTE 注释块\n';
const cues = Srt.parse(srtText);
eq('cue 数（跳过 NOTE）', cues.length, 2);
eq('标签清洗', cues[0].text, 'Edge computing');
eq('位置标签清洗', cues[1].text, 'reshapes networks');
ok('VTT 头识别', Srt.parse('WEBVTT\n\n00:01.000 --> 00:02.000\n你好世界').length === 1);
ok('looksLikeSrt', Srt.looksLikeSrt(srtText) && !Srt.looksLikeSrt('普通文本'));
const srtConverted = Srt.cuesToText(srtText);
ok('cuesToText 每 cue 一段', (srtConverted.match(/\n\n/g) || []).length === 1 && srtConverted.includes('Edge computing'));
const tmpSrt = path.join(require('os').tmpdir(), 'bte_test_' + Date.now() + '.srt');
fs.writeFileSync(tmpSrt, srtText, 'utf8');
eq('readAnyPath 路由 .srt', Imp.readAnyPath(tmpSrt).type, 'srt');
ok('SRT 文本可分句', Seg.segmentPlain(Imp.readAnyPath(tmpSrt).text, 'en').length >= 2);
fs.unlinkSync(tmpSrt);

/* ---------- 单文件双语字幕拆分 ---------- */
section('bilingual srt');
const biSame = '1\n00:00:01,000 --> 00:00:02,000\n边缘计算正在重塑分布式系统。\nEdge computing is reshaping distributed systems.\n\n' +
  '2\n00:00:03,000 --> 00:00:04,000\n机器学习模型运行在云服务器上。\nMachine learning models run on cloud servers.\n';
const biAlt = '1\n00:00:01,000 --> 00:00:02,000\nEdge computing is reshaping distributed systems.\n\n' +
  '2\n00:00:01,500 --> 00:00:02,500\n边缘计算正在重塑分布式系统。\n\n' +
  '3\n00:00:03,000 --> 00:00:04,000\nMachine learning models run on cloud servers.\n\n' +
  '4\n00:00:03,500 --> 00:00:04,500\n机器学习模型运行在云服务器上。\n';
const s1 = Srt.splitBilingual(biSame, { srcLang: 'en' });
eq('同 cue 模式识别', s1.pattern, 'same-cue');
eq('同 cue 拆分对数', s1.pairs.length, 2);
eq('同 cue 源语侧（--src-lang en）', s1.pairs[0].src, 'Edge computing is reshaping distributed systems.');
eq('同 cue 译文侧', s1.pairs[0].tgt, '边缘计算正在重塑分布式系统。');
const s2 = Srt.splitBilingual(biSame, {});
ok('自动选先出现语言为源语', s2.srcLang === 'zh-CN' && s2.pairs[0].src.includes('边缘计算'),
  { srcLang: s2.srcLang, src: s2.pairs[0].src });
const s3 = Srt.splitBilingual(biAlt, { srcLang: 'en' });
eq('交替 cue 模式识别', s3.pattern, 'alternating');
eq('交替 cue 拆分对数', s3.pairs.length, 2);
eq('交替 cue 配对顺序', s3.pairs[1].src, 'Machine learning models run on cloud servers.');
const biBlock = '1\n00:00:01,000 --> 00:00:02,000\nFirst line one.\n\n2\n00:00:02,000 --> 00:00:03,000\nFirst line two.\n\n' +
  '3\n00:00:03,000 --> 00:00:04,000\n第一句。\n\n4\n00:00:04,000 --> 00:00:05,000\n第二句。\n';
const s4 = Srt.splitBilingual(biBlock, { srcLang: 'en' });
eq('分块排布按序配对', s4.pattern, 'alternating');
eq('分块配对对数', s4.pairs.length, 2);
eq('分块配对正确', s4.pairs[0].tgt, '第一句。');
ok('src-lang 不匹配报错', (() => { try { Srt.splitBilingual(biSame, { srcLang: 'ja' }); return false; } catch (e) { return true; } })());
eq('单文件双语统计', s1.stats.cues, 2);

/* ---------- 端到端：alignDocs + 基准数据 ---------- */
section('端到端（基准样例）');
const dataDir = path.join(__dirname, '..', 'benchmark', 'data');
const enText = fs.readFileSync(path.join(dataDir, 'sample_en.txt'), 'utf8');
const zhText = fs.readFileSync(path.join(dataDir, 'sample_zh.txt'), 'utf8');
const aligned = TE.alignDocs(enText, zhText, 'en', 'zh-CN');
ok('1-1 句对数量', aligned.pairs.length >= 15, aligned.pairs.length);
const e2eC = Cand.extractCandidates(aligned.pairs, { minFreq: 2, topN: 500 }).candidates;
Vote.voteTranslations(e2eC, aligned.pairs);
const e2eBy = n => e2eC.find(c => c.norm === n);
ok('edge computing 译文', e2eBy('edge computing') && e2eBy('edge computing').translations[0] && e2eBy('edge computing').translations[0].t === '边缘计算',
  e2eBy('edge computing') && e2eBy('edge computing').translations);
ok('machine learning 共识收敛', e2eBy('machine learning') && e2eBy('machine learning').translations[0] && e2eBy('machine learning').translations[0].t === '机器学习',
  e2eBy('machine learning') && e2eBy('machine learning').translations);
ok('单句术语（encryption）译文留白', e2eBy('encryption') && e2eBy('encryption').translations.length === 0);

/* ---------- 汇总 ---------- */
console.log('\n通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.error('存在 ' + fail + ' 项失败'); process.exit(1); }
console.log('全部通过 ✓');
