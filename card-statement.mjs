const CATEGORY_RULES = [
  { match: /\b(padaria|panificadora|padoca|pao)\b/, category: 'Alimentação', subcategory: 'Padaria' },
  { match: /\b(mercado|supermercado|hortifruti|atacadao|assai|carrefour)\b/, category: 'Alimentação', subcategory: 'Feira' },
  { match: /\b(farmacia|drogaria|drogasil|droga raia|pacheco)\b/, category: 'Saúde', subcategory: 'Farmácia' },
  { match: /\b(creche|escola|colegio|faculdade|universidade|curso)\b/, category: 'Família e educação' },
  { match: /\b(posto|combustivel|shell|ipiranga|petrobras)\b/, category: 'Transporte', subcategory: 'Combustível' },
  { match: /\b(netflix|spotify|disney|max|prime video|youtube premium)\b/, category: 'Assinaturas', subcategory: 'Streaming' },
  { match: /\b(conta de agua|saneamento|sabesp)\b/, category: 'Moradia', subcategory: 'Conta de água' },
  { match: /\b(conta de energia|energia eletrica|enel|cpfl|cemig)\b/, category: 'Moradia', subcategory: 'Conta de energia' },
  { match: /\b(ifood|restaurante|lanchonete|pizzaria|burger king|mcdonald)\b/, category: 'Lazer', subcategory: 'Lanches' }
];

export function classifyCardPurchase(title, categories) {
  const normalizedTitle = normalize(title);
  const rule = CATEGORY_RULES.find(candidate => candidate.match.test(normalizedTitle));
  if (!rule) return null;

  const matchingCategories = categories.filter(item =>
    item.transaction_type === 'expense' && normalize(item.category) === normalize(rule.category));
  if (!matchingCategories.length) return null;

  const subcategory = rule.subcategory
    ? matchingCategories.find(item => normalize(item.subcategory) === normalize(rule.subcategory))
    : matchingCategories.find(item => /\b(creche|escola|colegio|curso)\b/.test(normalizedTitle)
      ? normalize(item.subcategory) === 'creche'
      : normalize(item.subcategory) === 'faculdade');
  return {
    category: rule.category,
    subcategory: subcategory?.subcategory ?? null,
    budget_group: subcategory?.budget_group ?? null
  };
}

export function parseCardOfx(text) {
  const transactionTags = [...text.matchAll(/<STMTTRN(?:\s[^>]*)?>/gi)];
  if (!transactionTags.length) {
    throw new Error('Não encontrei transações OFX. Confira se o arquivo contém registros STMTTRN.');
  }

  const rows = transactionTags.map((tag, index) => {
    const start = tag.index + tag[0].length;
    const end = transactionTags[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    const rawDate = readOfxValue(block, 'DTPOSTED') ?? readOfxValue(block, 'DTUSER');
    const rawAmount = readOfxValue(block, 'TRNAMT');
    const name = readOfxValue(block, 'NAME');
    const memo = readOfxValue(block, 'MEMO');
    const title = [name, memo && normalize(memo) !== normalize(name ?? '') ? memo : null]
      .filter(Boolean).join(' · ').trim();
    const purchaseDate = parseOfxDate(rawDate);
    const amount = parseOfxAmount(rawAmount);

    if (!purchaseDate || !title || title.length > 160 || !Number.isSafeInteger(amount) || amount === 0) {
      throw new Error(`A transação OFX ${index + 1} tem data, descrição ou valor inválido.`);
    }

    const installment = title.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
    const installmentNumber = installment ? Number(installment[1]) : null;
    const installmentTotal = installment ? Number(installment[2]) : null;
    if (installment && (
      installmentNumber < 1 || installmentTotal < 2
      || installmentNumber > installmentTotal || installmentTotal > 60
    )) {
      throw new Error(`A transação OFX ${index + 1} contém um marcador de parcela inválido.`);
    }

    return {
      purchase_date: purchaseDate,
      title,
      cardholder_label: '',
      amount_cents: -amount,
      installment_number: installmentNumber,
      installment_total: installmentTotal
    };
  });

  return rows;
}

export function getStatementReferenceMonth(statement) {
  if (statement?.reference_month) return statement.reference_month;
  const rawDate = statement?.due_date || '';
  const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return rawDate.slice(0, 7);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Faturas com vencimento até o dia 15 são referentes às despesas do mês anterior (regime de competência).
  // Exemplo: Vencimento 07/11 -> Despesas de Outubro (2026-10).
  // Exemplo: Vencimento 07/01 -> Despesas de Dezembro (2026-12).
  if (day <= 15) {
    const prevDate = new Date(year, month - 2, 1);
    return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${match[1]}-${match[2]}`;
}

export function calculateMonthlyCashFlow(entries, statements, statementItems, monthKey) {
  const incomeEntries = entries
    .filter(item => item.transaction_type === 'income');
  const income = incomeEntries
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const incomeFixed = incomeEntries
    .filter(item => item.amount_behavior !== 'variable')
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const incomeVariable = income - incomeFixed;

  // Compras no cartão são informação de categoria; o caixa usa o total da
  // fatura do mês de competência, não a soma das compras.
  const regularExpenses = entries.filter(item => item.transaction_type === 'expense'
    && !item.source_item_id
    && !item.is_forecast
    && item.payment_method !== 'credit');
  const expensesFixed = regularExpenses
    .filter(item => item.amount_behavior === 'fixed')
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const expensesVariable = regularExpenses
    .filter(item => item.amount_behavior !== 'fixed')
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);

  const statementCardMonths = new Set(statements
    .filter(statement => getStatementReferenceMonth(statement) === monthKey)
    .map(statement => statement.credit_card_id));
  const forecastExpenses = entries
    .filter(item => item.transaction_type === 'expense'
      && item.is_forecast
      && (!item.credit_card_id || !statementCardMonths.has(item.credit_card_id)))
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const statementExpenses = statements
    .filter(statement => getStatementReferenceMonth(statement) === monthKey)
    .reduce((sum, statement) => {
      if (statement.statement_total_cents != null) {
        return sum + Number(statement.statement_total_cents);
      }
      return sum + statementItems
        .filter(item => item.statement_id === statement.id && !isCardPaymentTitle(item.title))
        .reduce((itemSum, item) => itemSum + Number(item.amount_cents), 0);
    }, 0);

  return {
    income,
    incomeFixed,
    incomeVariable,
    expensesFixed,
    expensesVariable,
    cardExpenses: statementExpenses,
    forecastExpenses,
    expenses: expensesFixed + expensesVariable + statementExpenses + forecastExpenses
  };
}

export function parseCardOfxPeriod(text) {
  const startDate = parseOfxDate(readOfxValue(text, 'DTSTART'));
  const totalCents = parseCardOfxTotal(text);
  return { startDate, totalCents };
}

export function parseCardOfxTotal(text) {
  const ledgerStart = text.search(/<LEDGERBAL(?:\s[^>]*)?>/i);
  if (ledgerStart < 0) return null;
  const balance = readOfxValue(text.slice(ledgerStart), 'BALAMT');
  const cents = parseOfxAmount(balance);
  return Number.isSafeInteger(cents) ? Math.abs(cents) : null;
}

export function parseCardPdfLines(lines, dueDate) {
  const due = new Date(`${dueDate}T12:00:00`);
  if (Number.isNaN(due.valueOf())) throw new Error('Informe um vencimento válido para interpretar as datas do PDF.');
  const rows = [];
  for (const line of lines) {
    const dateMatch = line.match(/\b(\d{2})[/. -](\d{2})(?:[/. -](\d{2,4}))?\b/);
    const amountMatch = line.match(/(?:R\$\s*)?\(?-?\d(?:[\d.]*\d)?[,.]\d{2}\)?\s*$/);
    if (!dateMatch || !amountMatch) continue;

    const description = line.slice(0, amountMatch.index).replace(dateMatch[0], ' ').replace(/\s+/g, ' ').trim();
    if (description.length < 2 || /\b(total|vencimento|limite|melhor dia|pagamento minimo)\b/i.test(normalize(description))) continue;

    const [, dayText, monthText, yearText] = dateMatch;
    const day = Number(dayText);
    const month = Number(monthText);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let year = yearText ? Number(yearText) : due.getFullYear();
    if (yearText?.length === 2) year += 2000;
    if (!yearText && month > due.getMonth() + 1) year -= 1;
    const purchaseDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const cents = parseAmount(amountMatch[0]);
    if (!Number.isSafeInteger(cents) || cents === 0) continue;

    const installment = description.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
    const installmentNumber = installment ? Number(installment[1]) : null;
    const installmentTotal = installment ? Number(installment[2]) : null;
    if (installment && (
      installmentNumber < 1 || installmentTotal < 2
      || installmentNumber > installmentTotal || installmentTotal > 60
    )) continue;

    rows.push({
      purchase_date: purchaseDate,
      title: description,
      cardholder_label: '',
      amount_cents: cents,
      installment_number: installmentNumber,
      installment_total: installmentTotal
    });
  }
  if (!rows.length) {
    throw new Error('Não encontrei compras em texto neste PDF. PDFs digitalizados como imagem precisam ser convertidos em texto antes da importação.');
  }
  return rows;
}

export function parseCardPdfTotal(lines) {
  const totalLabels = /\b(total da fatura|total desta fatura|total a pagar|valor total da fatura)\b/i;
  for (const line of lines) {
    if (!totalLabels.test(normalize(line))) continue;
    const amountMatch = line.match(/(?:R\$\s*)?\(?-?\d(?:[\d.]*\d)?[,.]\d{2}\)?\s*$/);
    if (!amountMatch) continue;
    const amount = parseAmount(amountMatch[0]);
    if (Number.isSafeInteger(amount) && amount >= 0) return amount;
  }
  return null;
}

function readOfxValue(block, tag) {
  const expression = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)(?:</${tag}\\s*>|(?=\\s*<[A-Z][A-Z0-9_]*(?:\\s[^>]*)?>)|$)`,
    'i'
  );
  const value = block.match(expression)?.[1]?.trim();
  return value ? decodeXml(value) : null;
}

function parseOfxDate(value) {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

function parseOfxAmount(value) {
  if (!value || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) return NaN;
  const amount = Number(value);
  const cents = Math.round(Math.abs(amount) * 100) * Math.sign(amount);
  return Number.isSafeInteger(cents) ? cents : NaN;
}

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const numeric = code[1].toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(numeric) && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : entity;
  });
}

function isCardPaymentTitle(title) {
  return /^\s*pagamento(?:\s|$)/i.test(title);
}

function normalize(value) {
  return value.toLocaleLowerCase('pt-BR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseAmount(value) {
  let normalized = value.trim().replace(/[R$\s]/g, '');
  const negativeByParentheses = normalized.startsWith('(') && normalized.endsWith(')');
  if (negativeByParentheses) normalized = normalized.slice(1, -1);
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    normalized = normalized.replace(decimal === ',' ? /\./g : /,/g, '');
    if (decimal === ',') normalized = normalized.replace(',', '.');
  } else if (lastComma >= 0) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return NaN;
  const amount = Number(normalized);
  return Math.round(Math.abs(amount) * 100) * (negativeByParentheses ? -1 : Math.sign(amount));
}
