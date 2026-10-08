'use strict';
/* 多语言（docs/design.md §16）：源码写中文；打包时 tools/i18n.js 把给玩家看的句子换成 __T('整句', 参数…)，这里按当前语言查表。
   语言：设置里选过的 > Steam 客户端的语言 > 系统语言（不认识的用英语）。表在载入时就查好了，所以换语言要重新载入页面。
   网页版（没打包）没有句子表：一直是中文，T 原样返回。 */
const LANG_LIST = [['zh', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['ar', 'العربية'],
  ['bg', 'Български'], ['cs', 'Čeština'], ['da', 'Dansk'], ['nl', 'Nederlands'], ['fi', 'Suomi'], ['fr', 'Français'], ['de', 'Deutsch'], ['el', 'Ελληνικά'], ['hu', 'Magyar'], ['it', 'Italiano'], ['no', 'Norsk'],
  ['pl', 'Polski'], ['pt', 'Português'], ['pt-BR', 'Português (Brasil)'], ['ro', 'Română'], ['ru', 'Русский'], ['es', 'Español'], ['es-419', 'Español (Latinoamérica)'], ['sv', 'Svenska'], ['tr', 'Türkçe'], ['uk', 'Українська']];
const LANG_KEY = 'dreamtide.lang';
const I18N = { lang: 'zh', dict: null, available: false };
(function () {
  const data = typeof I18N_DATA !== 'undefined' ? I18N_DATA : null;
  I18N.available = !!data;
  if (!data) return;
  const STEAM = { schinese: 'zh', tchinese: 'zh-TW', english: 'en', japanese: 'ja', koreana: 'ko', thai: 'th', vietnamese: 'vi', indonesian: 'id', malay: 'ms', arabic: 'ar', bulgarian: 'bg', czech: 'cs', danish: 'da', dutch: 'nl', finnish: 'fi', french: 'fr', german: 'de', greek: 'el', hungarian: 'hu', italian: 'it', norwegian: 'no', polish: 'pl', portuguese: 'pt', brazilian: 'pt-BR', romanian: 'ro', russian: 'ru', spanish: 'es', latam: 'es-419', swedish: 'sv', turkish: 'tr', ukrainian: 'uk' };
  const known = (l) => LANG_LIST.some((x) => x[0] === l);
  const fromNav = (n) => { n = String(n || '').toLowerCase(); if (/^zh-(tw|hk|mo)|^zh-hant/.test(n)) return 'zh-TW'; if (n.startsWith('zh')) return 'zh'; if (n === 'pt-br') return 'pt-BR'; if (/^es-(419|mx|ar|co|cl|pe|ve|us)/.test(n)) return 'es-419'; if (n.startsWith('nb') || n.startsWith('nn')) return 'no'; const b = n.split('-')[0]; return known(b) ? b : null; };
  let want = null;
  try { want = new URLSearchParams(location.search).get('lang') || localStorage.getItem(LANG_KEY); } catch (e) { want = null; } // ?lang=xx：截图和检查用
  if (!known(want)) { want = null; try { const s = window.kitBridge && window.kitBridge.steam && window.kitBridge.steam.language(); want = STEAM[s] || null; } catch (e) { want = null; } }
  if (!want) want = fromNav(typeof navigator !== 'undefined' && navigator.language) || 'en';
  I18N.lang = want; I18N.dict = data[want] || null;
  try { document.documentElement.lang = want; } catch (e) { /* 无头测试 */ }
})();
function __T(key, ...args) {
  const d = I18N.dict, s = (d && d[key]) || key;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] !== undefined ? args[+i] : m)) : s;
}
/* 拼起来的名字（装备的前缀 + 底子 + 后缀）：中文、日文直接连，其他语言中间加空格 */
function joinName(...parts) { const sep = /^(zh|ja)/.test(I18N.lang) ? '' : ' '; return parts.filter(Boolean).join(sep).replace(/\s+/g, ' ').trim(); }
/* 装备名的语序：形容词放在名词后面的语言（法、意、西、葡、越、印尼、马来、泰、阿拉伯）拼成“底子 + 前缀 + 后缀”；
   形容词要跟名词变性的语言（德、俄、乌、保、波、捷、希腊、罗、荷）和北欧三语，前缀译成属格 / 介词短语，拼成“底子 + 前缀 + 和 + 后缀”；
   定语都在名词前且不变形的语言（芬、匈、土）拼成“前缀 + 后缀 + 底子”，名字中间的词用小写；
   技能专精的前缀译成“技能+”，是个标签，放在最前面 */
const AFFIX_AND = { de: 'und', ru: 'и', uk: 'і', bg: 'и', pl: 'i', cs: 'a', el: 'και', ro: 'și', nl: 'en', sv: 'och', da: 'og', no: 'og' };
function affixName(pre, base, suf) {
  const l = I18N.lang, and = AFFIX_AND[l];
  if (pre && /\+$/.test(pre)) return joinName(pre, affixName('', base, suf));
  if (and) return pre && suf ? joinName(base, pre, and, suf) : joinName(base, pre, suf);
  if (/^(fi|hu|tr)/.test(l)) { const s = joinName(...[pre, suf, base].filter(Boolean).map((w) => w.charAt(0).toLocaleLowerCase(l) + w.slice(1))); return s.charAt(0).toLocaleUpperCase(l) + s.slice(1); }
  return /^(fr|it|es|pt|vi|id|ms|th|ar)/.test(l) ? joinName(base, pre, suf) : joinName(pre, base, suf);
}
function setLang(l) { try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* 存不了也照样换 */ } location.reload(); }
/* index.html 里写死的几句（带 data-t / data-t-aria）也照表换 */
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = __T(el.textContent.trim());
  for (const el of document.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', __T(el.getAttribute('aria-label')));
  document.title = __T(document.title);
});
