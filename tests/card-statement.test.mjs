import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMonthlyCashFlow,
  classifyCardPurchase,
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

test('counts statement totals in the due month without adding imported purchases twice', () => {
  const result = calculateMonthlyCashFlow([
    { transaction_type: 'income', amount_cents: 850000, amount_behavior: 'fixed' },
    { transaction_type: 'expense', amount_cents: 100000, amount_behavior: 'fixed' },
    { transaction_type: 'expense', amount_cents: 200000, payment_method: 'credit' },
    { transaction_type: 'expense', amount_cents: 350000, source_item_id: 'item-1' },
    { transaction_type: 'expense', amount_cents: 40000, is_forecast: true }
  ], [{
    id: 'statement-1',
    due_date: '2026-11-07',
    statement_total_cents: 350000
  }], [{
    id: 'item-1',
    statement_id: 'statement-1',
    title: 'Compra',
    amount_cents: 350000
  }], '2026-11');

  assert.equal(result.income, 850000);
  assert.equal(result.incomeFixed, 850000);
  assert.equal(result.incomeVariable, 0);
  assert.equal(result.expensesFixed, 100000);
  assert.equal(result.expensesVariable, 0);
  assert.equal(result.cardExpenses, 350000);
  assert.equal(result.forecastExpenses, 40000);
  assert.equal(result.expenses, 490000);
});

test('falls back to statement purchase rows when an invoice has no declared total', () => {
  const result = calculateMonthlyCashFlow([], [{
    id: 'statement-1',
    due_date: '2026-11-07',
    statement_total_cents: null
  }], [
    { statement_id: 'statement-1', title: 'Compra', amount_cents: 25000 },
    { statement_id: 'statement-1', title: 'Pagamento recebido', amount_cents: -25000 }
  ], '2026-11');

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

test('does not add forecast installments when the card already has a statement in that month', () => {
  const result = calculateMonthlyCashFlow([{
    transaction_type: 'expense',
    amount_cents: 100000,
    is_forecast: true,
    credit_card_id: 'card-1'
  }], [{
    id: 'statement-1',
    credit_card_id: 'card-1',
    due_date: '2026-12-07',
    statement_total_cents: 120000
  }], [], '2026-12');

  assert.equal(result.forecastExpenses, 0);
  assert.equal(result.cardExpenses, 120000);
  assert.equal(result.expenses, 120000);
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
