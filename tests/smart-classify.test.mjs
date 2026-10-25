import assert from 'node:assert/strict';
import test from 'node:test';

import {
  budgetGroupForControlGroup,
  classifyExpenseGroup,
  controlGroupForBudgetGroup,
  expenseGroupLabel,
  normalizeText
} from '../smart-classify.mjs';

const groupOf = itemName => classifyExpenseGroup({ itemName }).group;

test('classifica contas recorrentes como gastos fixos', () => {
  for (const name of ['Aluguel', 'Condomínio', 'Conta de luz', 'Internet fibra', 'Netflix', 'Plano de celular']) {
    assert.equal(groupOf(name), 'fixed', `${name} deveria ser fixo`);
  }
});

test('classifica compras do dia a dia como gastos variáveis', () => {
  for (const name of ['Supermercado Pão de Açúcar', 'Farmácia', 'Gasolina', 'Uber para o trabalho', 'Padaria']) {
    assert.equal(groupOf(name), 'variable', `${name} deveria ser variável`);
  }
});

test('classifica imprevistos como gastos adicionais', () => {
  for (const name of ['Conserto do chuveiro', 'Multa de trânsito', 'Reforma da cozinha']) {
    assert.equal(groupOf(name), 'additional', `${name} deveria ser adicional`);
  }
});

test('expressões específicas ganham das genéricas', () => {
  assert.equal(groupOf('Gás de cozinha'), 'variable');
  assert.equal(groupOf('Gás encanado'), 'fixed');
  assert.equal(groupOf('Conta de água'), 'fixed');
  assert.equal(groupOf('Água mineral'), 'variable');
});

test('histórico do usuário tem prioridade sobre as palavras-chave', () => {
  const history = [{ name: 'Conta de luz', group: 'variable', monthStart: '2026-09-01' }];
  const result = classifyExpenseGroup({ itemName: 'conta de luz', history });
  assert.equal(result.group, 'variable');
  assert.equal(result.reason, 'history');
});

test('histórico usa a ocorrência mais recente', () => {
  const history = [
    { name: 'Seguro do carro', group: 'additional', monthStart: '2026-08-01' },
    { name: 'Seguro do carro', group: 'fixed', monthStart: '2026-10-01' }
  ];
  assert.equal(classifyExpenseGroup({ itemName: 'Seguro do carro', history }).group, 'fixed');
});

test('categoria informada tem prioridade sobre histórico e palavras-chave', () => {
  const categories = [{ category: 'Moradia', subcategory: 'Aluguel', budget_group: 'fixed' }];
  const history = [{ name: 'Aluguel', group: 'variable', monthStart: '2026-10-01' }];
  const result = classifyExpenseGroup({
    itemName: 'Aluguel',
    category: 'Moradia',
    subcategory: 'Aluguel',
    categories,
    history
  });
  assert.equal(result.group, 'fixed');
  assert.equal(result.reason, 'category');
});

test('nome igual a uma categoria usa o grupo da categoria', () => {
  const categories = [{ category: 'Transporte', subcategory: 'Combustível', budget_group: 'variable' }];
  const result = classifyExpenseGroup({ itemName: 'Transporte', categories });
  assert.equal(result.group, 'variable');
  assert.equal(result.reason, 'category');
});

test('sem pista nenhuma cai em gastos variáveis', () => {
  const result = classifyExpenseGroup({ itemName: 'Zzzz' });
  assert.equal(result.group, 'variable');
  assert.equal(result.reason, 'default');
});

test('converte grupos do orçamento e do mês nos dois sentidos', () => {
  assert.equal(controlGroupForBudgetGroup('fixed'), 'fixed');
  assert.equal(controlGroupForBudgetGroup('emergency'), 'additional');
  assert.equal(controlGroupForBudgetGroup('leisure'), 'variable');
  assert.equal(controlGroupForBudgetGroup(null), 'variable');
  assert.equal(budgetGroupForControlGroup('fixed'), 'fixed');
  assert.equal(budgetGroupForControlGroup('additional'), 'emergency');
  assert.equal(budgetGroupForControlGroup('income'), null);
});

test('rótulos e normalização de texto', () => {
  assert.equal(expenseGroupLabel('fixed'), 'Gastos fixos');
  assert.equal(expenseGroupLabel('additional'), 'Gastos adicionais');
  assert.equal(expenseGroupLabel('desconhecido'), 'Gastos variáveis');
  assert.equal(normalizeText('  Conta de Luz '), 'conta de luz');
  assert.equal(normalizeText('Pão de Açúcar'), 'pao de acucar');
  assert.equal(normalizeText(null), '');
});
