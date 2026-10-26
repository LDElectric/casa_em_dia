import { classifyCardPurchase } from './card-statement.mjs';
import { normalizeText } from './smart-classify.mjs';

// Prefixos que o adquirente coloca na frente do nome (Mp *, Dl *, Ig*…).
const PROCESSOR_PREFIXES = new Set([
  'mp', 'dl', 'ig', 'zp', 'pg', 'ifd', 'ebw', 'gr', 'app', 'cappta', 'cielo',
  'stone', 'pagseguro', 'mercadopago', 'paypal', 'getnet', 'rede', 'visanet'
]);

const MIN_PREFIX_MATCH = 6;
// Para casar quando a fatura traz o nome mais curto que a regra salva, exige
// um trecho já bem específico: "Varejão" sozinho não pode valer "Varejão São Luiz".
const MIN_TRUNCATED_MATCH = 10;

/**
 * Chave do estabelecimento usada pelo dicionário da casa: minúsculas, sem
 * acentos, sem prefixo de adquirente e sem o marcador de parcela.
 * Ex.: "Mp *Portalmercado - Parcela 3/6" -> "portalmercado".
 */
export function cardMerchantKey(title) {
  let key = normalizeText(title);
  if (!key) return '';
  key = key.replace(/\bparcela\b.*$/, '').trim();
  const tokens = key.split(' ').filter(Boolean);
  while (tokens.length > 1 && PROCESSOR_PREFIXES.has(tokens[0])) tokens.shift();
  return tokens.join(' ').trim().slice(0, 120);
}

function lookupMerchantMap(map, key) {
  if (!key || !map?.size) return null;
  const exact = map.get(key);
  if (exact) return exact;
  if (key.length < MIN_PREFIX_MATCH) return null;
  let bestKey = null;
  for (const mapKey of map.keys()) {
    if (mapKey.length < MIN_PREFIX_MATCH) continue;
    const longerThanRule = key.startsWith(mapKey);
    const shorterThanRule = key.length >= MIN_TRUNCATED_MATCH && mapKey.startsWith(key);
    if (!longerThanRule && !shorterThanRule) continue;
    if (!bestKey || mapKey.length > bestKey.length) bestKey = mapKey;
  }
  return bestKey ? map.get(bestKey) : null;
}

/**
 * Ordem de decisão: dicionário da casa → regra explícita embutida → histórico
 * já salvo. Sem pista nenhuma, devolve `matched: false` e o lançamento fica
 * sem categoria esperando a decisão do usuário.
 */
export function classifyCardEntry({ title, rules = [], categories = [], history = new Map() }) {
  const houseRule = resolveHouseMerchantRule(title, rules);
  if (houseRule) return { ...houseRule, matched: true, source: 'house' };
  const builtin = classifyCardPurchase(title, categories);
  if (builtin.matched) return { ...builtin, source: 'rules' };
  const learned = lookupMerchantMap(history, cardMerchantKey(title));
  if (learned) return { ...learned, matched: true, source: 'history' };
  return { category: null, subcategory: null, budget_group: null, matched: false, source: 'none' };
}

export function merchantRuleToClassification(rule) {
  const subcategory = String(rule?.subcategory ?? '').trim();
  return {
    category: rule.category,
    subcategory: subcategory || null,
    budget_group: rule.budget_group ?? 'variable'
  };
}

/**
 * Procura o estabelecimento no dicionário da casa. Aceita correspondência
 * exata e, para nomes truncados/com complemento, a maior chave que seja
 * prefixo nos dois sentidos (mínimo de 6 caracteres para evitar casamento
 * acidental em nomes curtos).
 */
export function resolveHouseMerchantRule(title, rules = []) {
  const key = cardMerchantKey(title);
  if (!key || !rules?.length) return null;
  const exact = rules.find(rule => rule.merchant_key === key);
  if (exact) return merchantRuleToClassification(exact);
  if (key.length < MIN_PREFIX_MATCH) return null;
  let best = null;
  for (const rule of rules) {
    const ruleKey = String(rule.merchant_key ?? '');
    if (ruleKey.length < MIN_PREFIX_MATCH) continue;
    const longerThanRule = key.startsWith(ruleKey);
    const shorterThanRule = key.length >= MIN_TRUNCATED_MATCH && ruleKey.startsWith(key);
    if (!longerThanRule && !shorterThanRule) continue;
    if (!best || ruleKey.length > best.merchant_key.length) best = rule;
  }
  return best ? merchantRuleToClassification(best) : null;
}
