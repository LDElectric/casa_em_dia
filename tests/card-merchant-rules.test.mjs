import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardMerchantKey,
  classifyCardEntry,
  merchantRuleToClassification,
  resolveHouseMerchantRule
} from '../card-merchant-rules.mjs';

const rules = [
  {
    merchant_key: 'varejao sao luiz',
    merchant_label: 'Varejão São Luiz',
    category: 'Saúde',
    subcategory: 'Farmácia',
    budget_group: 'variable'
  },
  {
    merchant_key: 'portalmercado',
    merchant_label: 'Mp *Portalmercado',
    category: 'Alimentação',
    subcategory: 'Mercado',
    budget_group: 'variable'
  }
];

test('normaliza a chave do estabelecimento', () => {
  assert.equal(cardMerchantKey('Varejão São Luiz'), 'varejao sao luiz');
  assert.equal(cardMerchantKey('VAREJAO SAO LUIZ POPUL'), 'varejao sao luiz popul');
  assert.equal(cardMerchantKey('Mp *Portalmercado'), 'portalmercado');
  assert.equal(cardMerchantKey('Dl *Uberrides - Parcela 3/6'), 'uberrides');
  assert.equal(cardMerchantKey('Jim.Com* Wendel Lenny - Parcela 7/10'), 'jim com wendel lenny');
  assert.equal(cardMerchantKey(''), '');
});

test('encontra a regra da casa pela chave exata', () => {
  assert.deepEqual(resolveHouseMerchantRule('Varejão São Luiz', rules), {
    category: 'Saúde',
    subcategory: 'Farmácia',
    budget_group: 'variable'
  });
});

test('aceita nome truncado ou com complemento pelo prefixo mais longo', () => {
  assert.equal(resolveHouseMerchantRule('Varejao Sao Luiz Popul', rules)?.subcategory, 'Farmácia');
  assert.equal(resolveHouseMerchantRule('Varejao Sao Luiz Popular', rules)?.category, 'Saúde');
  assert.equal(resolveHouseMerchantRule('Mp *Portalmercado', rules)?.subcategory, 'Mercado');
});

test('não casa estabelecimento diferente e ignora chave curta demais', () => {
  assert.equal(resolveHouseMerchantRule('Panificadora Portal', rules), null);
  assert.equal(resolveHouseMerchantRule('Varejao', rules), null);
  assert.equal(resolveHouseMerchantRule('', rules), null);
  assert.equal(resolveHouseMerchantRule('Varejao Sao Luiz', []), null);
});

test('a regra da casa vence a regra embutida', () => {
  const houseRules = [{
    merchant_key: 'panificadora portal',
    category: 'Alimentação',
    subcategory: 'Padaria',
    budget_group: 'variable'
  }, {
    merchant_key: 'extrafarma',
    category: 'Saúde',
    subcategory: 'Farmácia',
    budget_group: 'variable'
  }];
  const result = classifyCardEntry({
    title: 'Panificadora Portal',
    rules: houseRules,
    categories: []
  });
  assert.equal(result.source, 'house');
  assert.equal(result.subcategory, 'Padaria');
  assert.equal(result.matched, true);
});

test('sem pista no nome devolve categoria vazia em vez de adivinhar', () => {
  const result = classifyCardEntry({
    title: 'VAREJAO SAO LUIZ',
    rules: [],
    categories: []
  });
  assert.deepEqual(result, {
    category: null,
    subcategory: null,
    budget_group: null,
    matched: false,
    source: 'none'
  });
});

test('usa o histórico salvo quando não há regra por nome', () => {
  const history = new Map([[
    'varejao sao luiz',
    { category: 'Saúde', subcategory: 'Farmácia', budget_group: 'variable' }
  ]]);
  const result = classifyCardEntry({
    title: 'VAREJAO SAO LUIZ POPUL',
    rules: [],
    categories: [],
    history
  });
  assert.equal(result.source, 'history');
  assert.equal(result.subcategory, 'Farmácia');
});

test('converte a regra salva no formato de classificação', () => {
  assert.deepEqual(merchantRuleToClassification({
    category: 'Saúde',
    subcategory: '   ',
    budget_group: null
  }), {
    category: 'Saúde',
    subcategory: null,
    budget_group: 'variable'
  });
});
