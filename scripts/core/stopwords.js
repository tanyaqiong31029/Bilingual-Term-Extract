'use strict';
/* Bilingual-Term-Extract —— 内置停用词
 * 用途：候选术语的边界过滤（首尾词元不得为停用词/虚词），词中间不检查——
 *       像 state of the art 这类含介词的真术语不会被误杀。
 *
 * 中文单字表的取舍原则（经过金标准基准校验）：
 *   只收「在术语首尾出现会造成大量垃圾候选、且几乎不参与真术语构成」的字。
 *   点/分/向/类/条/架/行/开/化/性/度/器/件/据/网/关/理/算/统/式/系 这些字
 *   高频出现在术语结尾或开头（节点、分析、向量、类型、条件、框架、执行、开发、
 *   自动化、可靠性、精度、服务器、数据、网关、推理、计算、系统、分布式），一律不收；
 *   收进来的字（的了着吗…）配合邻接熵过滤承担第一道垃圾拦截。
 */

const EN = new Set(('a,an,the,and,or,but,if,then,else,when,while,of,to,in,on,at,by,for,with,from,as,into,onto,upon,' +
  'about,above,below,over,under,between,among,through,during,before,after,since,until,till,against,within,without,' +
  'along,across,behind,beyond,around,near,off,out,up,down,' +
  'is,are,was,were,be,been,being,am,do,does,did,done,doing,have,has,had,having,' +
  'will,would,shall,should,can,could,may,might,must,ought,' +
  'not,nor,no,yes,so,too,very,than,there,here,' +
  'i,me,my,mine,we,us,our,ours,you,your,yours,he,him,his,she,her,hers,it,its,they,them,their,theirs,' +
  'this,that,these,those,what,which,who,whom,whose,why,how,' +
  'all,any,both,either,neither,each,every,few,more,most,other,others,some,such,only,own,same,' +
  'also,just,even,still,already,yet,again,further,once,per,via,' +
  's,t,d,ll,re,ve,m,o,nor').split(','));

/* 中文单字虚词（首尾过滤用）。刻意精简，见文件头说明。 */
const ZH_CHARS = new Set((
  '的了呢吗吧啊呀哦嘛啦呐哇哪么' +
  '之所以或并且但是既然如果虽而不但不仅只才都也又再挺很较颇最' +
  '况从于由作为此该各某每另些什' +
  '被让给叫允遭得获到展予' +
  '个辆艘颗滴丝毫县乡省城村镇'
).split(''));

/* 中文多字虚词/通用词：整个候选等于这些词时直接排除（补单字表删减的缺口） */
const ZH_WORDS = new Set(('我们,你们,他们,她们,它们,自己,大家,咱们,这个,那个,这些,那些,这样,那样,这样子,' +
  '可以,应该,需要,能够,可能,也许,大概,或许,必须,一定,肯定,确实,真的,好像,似乎,' +
  '如果,假如,要是,倘若,若是,只要,只有,除非,无论,不管,尽管,即使,就算,' +
  '因为,由于,因此,所以,于是,然后,接着,最后,首先,其次,再者,此外,另外,而且,并且,不过,但是,可是,然而,虽然,' +
  '同时,以及,比较,极其,差不多,相当,通过,经过,根据,依据,按照,依照,本着,为了,关于,对于,至于,鉴于,' +
  '现在,目前,当前,以后,之后,以前,之前,最近,近来,当时,这时,那时,' +
  '非常,十分,特别,尤其,更加,越来越,逐步,逐渐,渐渐,基本上,大体上,一般来说,总的来说,总之,' +
  '进行,予以,加以,作出,做出,成为,变成,作为,属于,包括,包含,具有,拥有,存在,出现,发生,形成,产生,引起,导致,造成').split(','));

function isStopEn(norm) { return EN.has(String(norm || '').toLowerCase()); }
function isZhStopChar(ch) { return ZH_CHARS.has(ch); }
function isZhStopWord(norm) { return ZH_WORDS.has(String(norm || '')); }

module.exports = { EN, ZH_CHARS, ZH_WORDS, isStopEn, isZhStopChar, isZhStopWord };
