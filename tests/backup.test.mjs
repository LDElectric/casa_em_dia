import assert from 'node:assert/strict';
import test from 'node:test';

import { BACKUP_SCHEMA_VERSION, backupFileName, buildBackup, centsToCsv, toCsv } from '../backup.mjs';

const columns = [
  { label: 'Mês', value: row => row.month },
  { label: 'Item', value: row => row.item },
  { label: 'Valor (R$)', value: row => row.value }
];

test('gera um backup com versão e todas as coleções', () => {
  const backup = buildBackup({
    exportedAt: '2026-10-26T12:00:00.000Z',
    household: { id: 'h1', name: 'Casa' },
    members: [{ user_id: 'u1', email: 'a@b.com', role: 'owner' }],
    financeCategories: [{ category: 'Moradia' }],
    budgetTargets: [{ month_start: '2026-10-01' }],
    reserveMovements: [{ amount_cents: 1000 }],
    creditCards: [{ id: 'c1' }],
    cardStatements: [{ id: 's1' }],
    cardStatementItems: [{ id: 'i1' }],
    recurringItems: [{ id: 'r1' }],
    monthlyControlItems: [{ id: 'm1' }],
    transactions: [{ id: 't1' }]
  });
  assert.equal(backup.app, 'casa-em-dia');
  assert.equal(backup.schema_version, BACKUP_SCHEMA_VERSION);
  assert.equal(backup.exported_at, '2026-10-26T12:00:00.000Z');
  assert.deepEqual(backup.household, { id: 'h1', name: 'Casa' });
  assert.equal(backup.members.length, 1);
  assert.equal(backup.finance_categories.length, 1);
  assert.equal(backup.budget_targets.length, 1);
  assert.equal(backup.reserve_movements.length, 1);
  assert.equal(backup.credit_cards.length, 1);
  assert.equal(backup.card_statements.length, 1);
  assert.equal(backup.card_statement_items.length, 1);
  assert.equal(backup.recurring_items.length, 1);
  assert.equal(backup.monthly_control_items.length, 1);
  assert.equal(backup.transactions.length, 1);
});

test('monta o CSV com BOM, separador ponto e vírgula e quebra CRLF', () => {
  const csv = toCsv(columns, [{ month: '2026-10', item: 'Luz', value: '120,50' }]);
  assert.ok(csv.startsWith('\uFEFF'), 'deve começar com BOM para o Excel reconhecer UTF-8');
  assert.equal(csv, '\uFEFFMês;Item;Valor (R$)\r\n2026-10;Luz;120,50');
});

test('escapa células com separador, aspas e quebra de linha', () => {
  const csv = toCsv(columns, [
    { month: '2026-10', item: 'Padaria; café', value: '10,00' },
    { month: '2026-10', item: 'Nota "especial"', value: '5,00' },
    { month: '2026-10', item: 'Linha\nquebrada', value: '1,00' }
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[1], '2026-10;"Padaria; café";10,00');
  assert.equal(lines[2], '2026-10;"Nota ""especial""";5,00');
  assert.equal(lines[3], '2026-10;"Linha\nquebrada";1,00');
});

test('célula vazia não vira texto "null" ou "undefined"', () => {
  const csv = toCsv(columns, [{ month: '2026-10', item: null, value: undefined }]);
  assert.equal(csv.split('\r\n')[1], '2026-10;;');
});

test('converte centavos em valor com vírgula decimal', () => {
  assert.equal(centsToCsv(123456), '1234,56');
  assert.equal(centsToCsv(5), '0,05');
  assert.equal(centsToCsv(0), '0,00');
  assert.equal(centsToCsv(null), '');
  assert.equal(centsToCsv(undefined), '');
});

test('nome do arquivo usa a data do backup', () => {
  assert.equal(backupFileName('casa-em-dia-backup', new Date(2026, 0, 5)), 'casa-em-dia-backup-2026-01-05');
  assert.equal(backupFileName('casa-em-dia-backup', new Date(2026, 11, 31)), 'casa-em-dia-backup-2026-12-31');
});
