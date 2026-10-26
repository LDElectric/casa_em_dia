/**
 * Classificação baseada na DESCRIÇÃO de cada linha da fatura (o nome do
 * estabelecimento, com o complemento/memo quando existe). O texto é
 * normalizado (minúsculas e sem acentos) e comparado com estes contextos.
 *
 * Regras:
 * - a primeira regra que casar vence, por isso as mais específicas vêm antes;
 * - radicais como `farma`, `pharma`, `padari` e `panific` casam dentro da
 *   palavra, então "Redepharma", "Farma Central" e "Panificadora Estrela"
 *   entram na categoria certa;
 * - palavras curtas e ambíguas (posto, obra, café, pneu) exigem palavra
 *   inteira para não classificar "cobrança" como imprevisto;
 * - `group` é o plano B quando a casa ainda não cadastrou a subcategoria.
 *
 * Nada aqui adivinha o ramo pelo valor: é sempre o texto do lançamento.
 */
const MERCHANT_RULES = [
  { match: /\b(netflix|spotify|disney|hbo|prime video|paramount|apple tv|globoplay|deezer|youtube|crunchyroll|chatgpt|openai|icloud|adobe|microsoft 365|office 365|canva|duolingo)\b|amazon ?prime|primebr|google (one|play|cloud|workspace|ai|gemini)|google one|google play|google ?g1|gemini/, category: 'Assinaturas', subcategory: 'Streaming', group: 'fixed' },
  // Marketplaces e lojas online não são mercado de bairro.
  { match: /mercado ?livre|mercadolivre|mercado ?pago|mercadopago|shopee|aliexpress|shein|temu|amazon ?mktplc|amazon marketplace|\bamazon\b|\bamzn\b|magalu|magazine luiza|americanas|submarino|netshoes|centauro|decathlon|\brenner\b|riachuelo|\bzara\b|\bcea\b|\bmarisa\b|casas bahia|pontofrio|fast shop/, category: 'Outros', subcategory: 'Compras online', group: 'variable' },
  { match: /\b(banda larga|fibra|vivo fibra|claro net|oi fibra|algar|internet)\b/, category: 'Serviços', subcategory: 'Internet', group: 'fixed' },
  { match: /\b(recarga|recarregue|tim|vivo|claro|nextel)\b/, category: 'Comunicação', subcategory: 'Recarga de celular', group: 'fixed' },
  { match: /sabesp|copasa|sanepar|cedae|embasa|cagece|saneament|conta de agua|\baguas\b/, category: 'Moradia', subcategory: 'Conta de água', group: 'fixed' },
  { match: /enel|cpfl|cemig|equatorial|coelba|celpe|energisa|energia eletrica|conta de luz/, category: 'Moradia', subcategory: 'Conta de energia', group: 'fixed' },
  { match: /\b(comgas|gas encanado|gas natural)\b/, category: 'Moradia', subcategory: null, group: 'fixed' },
  { match: /\b(aluguel|condominio|iptu|imobiliaria)\b/, category: 'Moradia', subcategory: null, group: 'fixed' },
  // Rede de supermercado é decidida antes da farmácia: "Supermercado Pague Menos" é mercado.
  // Só nomes que dizem o ramo ou marcas com segmento claro. Termos genéricos
  // como "varejão" ficam de fora: podem ser farmácia, mercado ou loja.
  { match: /supermerc|hipermerc|minimerc|atacad|assai|carrefour|guanabara|prezunic|zona sul|mamboo|sonda|bistek|angeloni|condor|makro|sam ?s club|walmart|bretas|pao de acucar/, category: 'Alimentação', subcategory: 'Mercado', group: 'variable' },
  { match: /farma|pharma|drogari|drogasil|droga raia|droga sao paulo|pacheco|pague menos|nissei|panvel/, category: 'Saúde', subcategory: 'Farmácia', group: 'variable' },
  { match: /clinic|laborator|diagnostic|\bexame|\bconsulta|dentist|odonto|\bmedic|hospital|fisioterap|psicolog|terapia/, category: 'Saúde', subcategory: 'Consultas', group: 'variable' },
  { match: /academia|smart ?fit|bluefit|selfit|\bmfit\b|pilates|crossfit|personal trainer|wellhub|gympass|totalpass|queima diaria/, category: 'Saúde', subcategory: null, group: 'fixed' },
  { match: /padari|panific|padoca|confeitar|pao de mel|pao quente|doceria|\bbolos\b/, category: 'Alimentação', subcategory: 'Padaria', group: 'variable' },
  { match: /acoug|frigorific|peixari|pescad|casa de carn|\bcarnes\b|suino|bovino/, category: 'Alimentação', subcategory: 'Açougue', group: 'variable' },
  { match: /hortifrut|sacolao|quitanda|\bfeira\b|\bhorta\b|frutas|verduras|legumes/, category: 'Alimentação', subcategory: 'Feira', group: 'variable' },
  { match: /mercado|mercadinho/, category: 'Alimentação', subcategory: 'Mercado', group: 'variable' },
  { match: /ifood|rappi|uber ?eats|delivery|restaurant|lanchonet|pizzari|\bpizza|hamburguer|hamburgu|burger|burguer|mcdonald|subway|habibs|giraffas|outback|sushi|churrascar|cafeteria|\bcafe\b|sorveter|acai|tapio|pastel|esfiha|marmita|\blanche\b|salgado|hot ?dog/, category: 'Lazer', subcategory: 'Lanches', group: 'leisure' },
  // "Posto de saúde" não é posto de combustível.
  { match: /(^| )posto(?! de saude)|combustiv|gasolina|etanol|alcool|diesel|shell|ipiranga|petrobras|bandeirante/, category: 'Transporte', subcategory: 'Combustível', group: 'variable' },
  { match: /\bmotos\b|motocicleta|motopecas|moto ?pecas/, category: 'Transporte', subcategory: 'Peças de moto', group: 'variable' },
  { match: /oficin|auto ?center|autocenter|mecanic|borrachar|\bpneus?\b|alinhament|balanceament|\brevisa|concessionari|auto ?pecas|autopecas|retific|lubrificant|\boleo\b/, category: 'Transporte', subcategory: 'Oficina', group: 'variable' },
  { match: /uber ?rides|uber ?trip|uber ?do ?brasil|\buber\b|99 ?(app|pop|food|taxi)|cabify|\btaxi|onibus|\bmetro\b|bilhete unico|pedagio|estacionament|sem parar|veloe|conectcar/, category: 'Transporte', subcategory: null, group: 'variable' },
  { match: /creche|bercario|escola|colegio|educacao infantil|maternal/, category: 'Família e educação', subcategory: 'Creche', group: 'fixed' },
  { match: /faculdade|universidade|\bunip\b|estacio|anhanguera|uninove|unicesumar|graduacao|pos graduacao/, category: 'Família e educação', subcategory: 'Faculdade', group: 'fixed' },
  { match: /\b(curso|cursos|idiomas|ingles|espanhol|alura|udemy|coursera|hotmart)\b/, category: 'Família e educação', subcategory: null, group: 'variable' },
  { match: /petshop|pet shop|petz|cobasi|veterinari|banho e tosa|racao/, category: 'Pets', subcategory: null, group: 'variable' },
  { match: /cinema|cinemark|cinepolis|teatro|\bshow\b|ingresso|museu|parque|zoologic|playstation|xbox|\bsteam\b|hotel|pousada|resort|airbnb|booking|passagem aerea|latam|gol linhas|azul linhas/, category: 'Lazer', subcategory: 'Passeios', group: 'leisure' },
  { match: /madeireir|ferragem|material de construc|leroy merlin|construshow|cassol/, category: 'Outros', subcategory: null, group: 'variable' },
  { match: /\b(conserto|reparo|manutencao|reforma|obra|encanador|eletricista|chaveiro|dedetizadora|vidraceiro|serralheria)\b/, category: 'Outros', subcategory: null, group: 'emergency' }
];

const FALLBACK_CLASSIFICATION = {
  category: 'Outros',
  subcategory: null,
  budget_group: 'variable',
  matched: false
};

/**
 * Classifica uma compra da fatura em categoria/subcategoria legíveis.
 * Nunca devolve categoria vazia: sem correspondência, o lançamento vai para
 * "Outros" com `matched: false` para a tela de importação pedir revisão.
 */
export function classifyCardPurchase(title, categories = []) {
  const normalizedTitle = normalize(String(title ?? ''));
  const expenseCategories = (categories ?? []).filter(item => item?.transaction_type === 'expense');
  const rule = MERCHANT_RULES.find(candidate => candidate.match.test(normalizedTitle));
  if (!rule) return { ...FALLBACK_CLASSIFICATION };

  const wantedCategory = normalize(rule.category);
  const sameCategory = expenseCategories.filter(item => normalize(item.category) === wantedCategory);
  const exact = rule.subcategory
    ? sameCategory.find(item => normalize(item.subcategory) === normalize(rule.subcategory))
    : null;
  if (exact) {
    return {
      category: exact.category,
      subcategory: exact.subcategory,
      budget_group: exact.budget_group ?? rule.group,
      matched: true
    };
  }
  // Sem a subcategoria cadastrada, mantém o contexto do estabelecimento e usa
  // o nome canônico da categoria quando a casa já possui essa categoria.
  return {
    category: sameCategory[0]?.category ?? rule.category,
    subcategory: rule.subcategory ?? null,
    budget_group: rule.group,
    matched: true
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

/**
 * Mês financeiro de um lançamento do extrato.
 * Com a virada no dia N, o que acontece até o dia N do mês seguinte pertence ao
 * mês anterior — é o caso do salário que cai no 5º dia útil pagando as contas do
 * mês que acabou. Virada 1 desliga a regra (mês do calendário).
 * Um `competence_month` explícito sempre vence, para contas pagas antecipadamente.
 */
export function financialMonthKey(dateString, cutoffDay = 1, competenceMonth = null) {
  if (competenceMonth) return String(competenceMonth).slice(0, 7);
  const match = String(dateString ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(dateString ?? '').slice(0, 7);
  const cutoff = Number(cutoffDay);
  if (!Number.isFinite(cutoff) || cutoff <= 1) return `${match[1]}-${match[2]}`;
  const day = Number(match[3]);
  if (day > Math.min(cutoff, 28)) return `${match[1]}-${match[2]}`;
  const previous = new Date(Number(match[1]), Number(match[2]) - 2, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
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
