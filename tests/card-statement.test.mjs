import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMonthlyCashFlow,
  classifyCardPurchase,
  financialMonthKey,
  getStatementReferenceMonth,
  parseCardOfx,
  parseCardOfxPeriod,
  parseCardOfxTotal,
  parseCardPdfLines,
  parseCardPdfTotal
} from '../card-statement.mjs';

const categories = [
  { transaction_type: 'expense', category: 'Alimentação', subcategory: 'Padaria', budget_group: 'variable' },
  { transaction_type: 'expense', category: 'Saúde', subcategory: 'Farmácia', budget_group: 'variable' },
  { transaction_type: 'expense', category: 'Família e educação', subcategory: 'Creche', budget_group: 'fixed' }
];

test('classifies known merchants only when the matching household category exists', () => {
  assert.deepEqual(classifyCardPurchase('PADARIA PÃO QUENTE', categories), {
    category: 'Alimentação',
    subcategory: 'Padaria',
    budget_group: 'variable'
  });
  assert.equal(classifyCardPurchase('LOJA SEM CATEGORIA', categories), null);
  assert.equal(classifyCardPurchase('DROGARIA CENTRAL', categories)?.subcategory, 'Farmácia');
});

test('extracts dated purchases and installment details from PDF text lines', () => {
  assert.deepEqual(parseCardPdfLines([
    '03/10 PADARIA DO BAIRRO 54,80',
    '12/10 FARMACIA CENTRAL Parcela 2/6 1.234,56',
    'TOTAL DA FATURA 3.573,48'
  ], '2026-11-07'), [
    {
      purchase_date: '2026-10-03',
      title: 'PADARIA DO BAIRRO',
      cardholder_label: '',
      amount_cents: 5480,
      installment_number: null,
      installment_total: null
    },
    {
      purchase_date: '2026-10-12',
      title: 'FARMACIA CENTRAL Parcela 2/6',
      cardholder_label: '',
      amount_cents: 123456,
      installment_number: 2,
      installment_total: 6
    }
  ]);
});

test('rejects statement PDFs without extractable purchase rows', () => {
  assert.throws(() => parseCardPdfLines(['Fatura fechada'], '2026-11-07'), /Não encontrei compras/);
});

test('extracts the invoice total separately from categorized purchases', () => {
  assert.equal(parseCardPdfTotal(['TOTAL DA FATURA R$ 3.573,48']), 357348);
  assert.equal(parseCardPdfTotal(['Total de compras R$ 1.200,00']), null);
});

test('parses OFX SGML transactions and converts card charges and credits to expense signs', () => {
  const rows = parseCardOfx(`OFXHEADER:100
DATA:OFXSGML
<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261018120000[-3:BRT]
<TRNAMT>-15.25
<NAME>PADARIA &amp; CIA
<MEMO>Compra presencial
<FITID>abc
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261019120000[-3:BRT]
<TRNAMT>5.00
<NAME>ESTORNO
<BANKTRANLIST>
</OFX>`);

  assert.deepEqual(rows, [
    {
      purchase_date: '2026-10-18',
      title: 'PADARIA & CIA · Compra presencial',
      cardholder_label: '',
      amount_cents: 1525,
      installment_number: null,
      installment_total: null
    },
    {
      purchase_date: '2026-10-19',
      title: 'ESTORNO',
      cardholder_label: '',
      amount_cents: -500,
      installment_number: null,
      installment_total: null
    }
  ]);
});

test('parses OFX XML transaction tags and installment details', () => {
  assert.deepEqual(parseCardOfx(`<OFX><CCSTMTRS><BANKTRANLIST>
    <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261102120000</DTPOSTED>
    <TRNAMT>-69.54</TRNAMT><NAME>LOJA</NAME><MEMO>Parcela 2/4</MEMO></STMTTRN>
  </BANKTRANLIST></CCSTMTRS></OFX>`), [{
    purchase_date: '2026-11-02',
    title: 'LOJA · Parcela 2/4',
    cardholder_label: '',
    amount_cents: 6954,
    installment_number: 2,
    installment_total: 4
  }]);
});

test('rejects invalid OFX transaction values', () => {
  assert.throws(() => parseCardOfx('<OFX><STMTTRN><TRNAMT>abc</TRNAMT></STMTTRN></OFX>'), /transação OFX 1/);
  assert.throws(() => parseCardOfx('<OFX></OFX>'), /Não encontrei transações OFX/);
});

// Fatura com vencimento 07/11 (dia <= 15) tem competência em outubro (2026-10).
test('counts statement totals in the reference month (competencia) without adding imported purchases twice', () => {
  const result = calculateMonthlyCashFlow([
    { transaction_type: 'income', amount_cents: 850000, amount_behavior: 'fixed' },
    { transaction_type: 'expense', amount_cents: 100000, amount_behavior: 'fixed' },
    { transaction_type: 'expense', amount_cents: 200000, payment_method: 'credit' },
    { transaction_type: 'expense', amount_cents: 350000, source_item_id: 'item-1' },
    { transaction_type: 'expense', amount_cents: 40000, is_forecast: true }
  ], [{
    id: 'statement-1',
    due_date: '2026-11-07',       // vencimento em novembro
    statement_total_cents: 350000
  }], [{
    id: 'item-1',
    statement_id: 'statement-1',
    title: 'Compra',
    amount_cents: 350000
  }], '2026-10');  // mês de competência = outubro

  assert.equal(result.income, 850000);
  assert.equal(result.incomeFixed, 850000);
  assert.equal(result.incomeVariable, 0);
  assert.equal(result.expensesFixed, 100000);
  assert.equal(result.expensesVariable, 0);
  assert.equal(result.cardExpenses, 350000);
  assert.equal(result.forecastExpenses, 40000);
  assert.equal(result.expenses, 490000);

  // No mês de novembro (vencimento), a fatura NÃO aparece.
  const novResult = calculateMonthlyCashFlow([{ transaction_type: 'expense', amount_cents: 40000, is_forecast: true }],
    [{ id: 'statement-1', due_date: '2026-11-07', statement_total_cents: 350000 }],
    [{ id: 'item-1', statement_id: 'statement-1', title: 'Compra', amount_cents: 350000 }],
    '2026-11');
  assert.equal(novResult.cardExpenses, 0);
});

// Fatura com vencimento 07/11 (dia <= 15) tem competência em outubro.
test('falls back to statement purchase rows when an invoice has no declared total', () => {
  const result = calculateMonthlyCashFlow([], [{
    id: 'statement-1',
    due_date: '2026-11-07',   // vencimento em novembro
    statement_total_cents: null
  }], [
    { statement_id: 'statement-1', title: 'Compra', amount_cents: 25000 },
    { statement_id: 'statement-1', title: 'Pagamento recebido', amount_cents: -25000 }
  ], '2026-10');  // mês de competência = outubro

  assert.equal(result.income, 0);
  assert.equal(result.expenses, 25000);
});

test('splits fixed and variable income for the monthly summary', () => {
  const result = calculateMonthlyCashFlow([
    { transaction_type: 'income', amount_cents: 700000, amount_behavior: 'fixed' },
    { transaction_type: 'income', amount_cents: 45000, amount_behavior: 'fixed' },
    { transaction_type: 'income', amount_cents: 120000, amount_behavior: 'variable' }
  ], [], [], '2026-11');

  assert.equal(result.income, 865000);
  assert.equal(result.incomeFixed, 745000);
  assert.equal(result.incomeVariable, 120000);
});

// Fatura com vencimento 07/12 (dia <= 15) tem competência em novembro (2026-11).
test('does not add forecast installments when the card already has a statement in that reference month', () => {
  const result = calculateMonthlyCashFlow([{
    transaction_type: 'expense',
    amount_cents: 100000,
    is_forecast: true,
    credit_card_id: 'card-1'
  }], [{
    id: 'statement-1',
    credit_card_id: 'card-1',
    due_date: '2026-12-07',   // vencimento em dezembro
    statement_total_cents: 120000
  }], [], '2026-11');  // mês de competência = novembro

  assert.equal(result.forecastExpenses, 0);
  assert.equal(result.cardExpenses, 120000);
  assert.equal(result.expenses, 120000);

  // Em dezembro (mês do vencimento), a fatura não aparece mais.
  const decResult = calculateMonthlyCashFlow([{
    transaction_type: 'expense', amount_cents: 100000, is_forecast: true, credit_card_id: 'card-1'
  }], [{
    id: 'statement-1', credit_card_id: 'card-1', due_date: '2026-12-07', statement_total_cents: 120000
  }], [], '2026-12');
  assert.equal(decResult.cardExpenses, 0);
  // A previsão ainda conta pois não há fatura com competência em dezembro.
  assert.equal(decResult.forecastExpenses, 100000);
});

test('reads the open statement total from the OFX ledger balance and period start', () => {
  const text = `<OFX><BANKTRANLIST>
    <DTSTART>20260930000000[-3:BRT]</DTSTART>
    <STMTTRN><TRNAMT>-3820.19</TRNAMT><NAME>Compra</NAME></STMTTRN>
  </BANKTRANLIST>
  <LEDGERBAL><BALAMT>-3820.18</BALAMT><DTASOF>20261031000000[-3:BRT]</DTASOF></LEDGERBAL></OFX>`;

  assert.equal(parseCardOfxTotal(text), 382018);
  assert.deepEqual(parseCardOfxPeriod(text), {
    startDate: '2026-09-30',
    totalCents: 382018
  });
  assert.equal(parseCardOfxTotal('<OFX></OFX>'), null);
});

test('financialMonthKey: virada 1 mantém o mês do calendário', () => {
  assert.equal(financialMonthKey('2026-11-05', 1), '2026-11');
  assert.equal(financialMonthKey('2026-11-05'), '2026-11');
  assert.equal(financialMonthKey('2026-11-05', 0), '2026-11');
});

test('financialMonthKey: salário do 5º dia útil pertence ao mês anterior', () => {
  assert.equal(financialMonthKey('2026-11-05', 6), '2026-10');
  assert.equal(financialMonthKey('2026-11-06', 6), '2026-10');
  assert.equal(financialMonthKey('2026-11-07', 6), '2026-11');
  assert.equal(financialMonthKey('2026-11-09', 10), '2026-10');
});

test('financialMonthKey: virada funciona na virada do ano', () => {
  assert.equal(financialMonthKey('2027-01-05', 6), '2026-12');
  assert.equal(financialMonthKey('2027-01-20', 6), '2027-01');
});

test('financialMonthKey: competência manual vence a virada', () => {
  assert.equal(financialMonthKey('2026-10-28', 6, '2026-11-01'), '2026-11');
  assert.equal(financialMonthKey('2026-11-05', 6, '2026-11-01'), '2026-11');
  assert.equal(financialMonthKey('2026-10-28', 6), '2026-10');
});

test('financialMonthKey: datas inválidas não quebram', () => {
  assert.equal(financialMonthKey(null, 6), '');
  assert.equal(financialMonthKey('2026-10', 6), '2026-10');
  assert.equal(financialMonthKey('2026-10-31', 99), '2026-10');
  assert.equal(financialMonthKey('2026-10-31', 'abc'), '2026-10');
});

test('getStatementReferenceMonth: fatura vencendo 07/11 é competência de outubro', () => {
  assert.equal(getStatementReferenceMonth({ due_date: '2026-11-07' }), '2026-10');
  assert.equal(getStatementReferenceMonth({ due_date: '2026-11-20' }), '2026-11');
  assert.equal(getStatementReferenceMonth({ due_date: '2027-01-07' }), '2026-12');
  assert.equal(getStatementReferenceMonth({ due_date: '2026-11-07', reference_month: '2026-09' }), '2026-09');
});
