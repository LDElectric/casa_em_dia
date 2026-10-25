const GROUP_PRIORITY = ['fixed', 'additional', 'variable'];

export const EXPENSE_GROUP_LABELS = {
  fixed: 'Gastos fixos',
  variable: 'Gastos variáveis',
  additional: 'Gastos adicionais'
};

const KEYWORDS = {
  fixed: [
    'aluguel', 'condominio', 'iptu', 'financiamento', 'prestacao', 'seguro',
    'plano de saude', 'mensalidade', 'escola', 'colegio', 'creche', 'faculdade',
    'curso', 'ensino', 'aposentadoria', 'previdencia',
    'luz', 'energia', 'energia eletrica', 'agua', 'conta de agua', 'gas encanado',
    'internet', 'banda larga', 'telefone', 'celular', 'recarga', 'plano de celular',
    'tv', 'streaming', 'netflix', 'spotify', 'disney', 'youtube premium', 'assinatura',
    'academia', 'faxina', 'diarista', 'empregada', 'jardineiro', 'racao',
    'caixinha crea', 'caixinha crt'
  ],
  variable: [
    'mercado', 'supermercado', 'hipermercado', 'atacadao', 'feira', 'hortifruti',
    'padaria', 'acougue', 'peixaria', 'lanchonete', 'restaurante', 'pizzaria',
    'cafe', 'bar', 'ifood', 'rappi', 'delivery', 'almoco', 'jantar',
    'combustivel', 'gasolina', 'etanol', 'diesel', 'posto', 'uber', 'taxi',
    'onibus', 'metro', 'pedagio', 'estacionamento', 'passagem',
    'farmacia', 'drogaria', 'remedio', 'medicamento', 'consulta', 'exame',
    'dentista', 'medico', 'fisioterapia', 'laboratorio',
    'roupa', 'calcado', 'sapato', 'presente', 'brinquedo', 'livraria', 'papelaria',
    'eletronico', 'informatica', 'peca', 'pecas', 'pneu', 'oleo',
    'agua mineral', 'gas de cozinha', 'botijao', 'petshop', 'veterinario',
    'banho e tosa', 'lazer', 'cinema', 'passeio', 'viagem', 'jogo', 'corte de cabelo',
    'salao de beleza', 'cosmetico', 'higiene'
  ],
  additional: [
    'emergencia', 'urgencia', 'imprevisto', 'conserto', 'reparo', 'manutencao',
    'multa', 'taxa', 'imposto', 'ipva', 'licenciamento', 'mudanca',
    'hospital', 'cirurgia', 'internacao', 'obra', 'reforma'
  ]
};

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function controlGroupForBudgetGroup(budgetGroup) {
  if (budgetGroup === 'fixed') return 'fixed';
  if (budgetGroup === 'emergency') return 'additional';
  return 'variable';
}

export function budgetGroupForControlGroup(controlGroup) {
  if (controlGroup === 'fixed') return 'fixed';
  if (controlGroup === 'additional') return 'emergency';
  if (controlGroup === 'variable') return 'variable';
  return null;
}

export function expenseGroupLabel(controlGroup) {
  return EXPENSE_GROUP_LABELS[controlGroup] ?? EXPENSE_GROUP_LABELS.variable;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchedKeywords(text, keywords) {
  if (!text) return [];
  return keywords.filter(keyword => {
    const pattern = new RegExp(`(^| )${escapeRegExp(keyword)}( |$)`);
    return pattern.test(text);
  });
}

/**
 * Classifica uma despesa em Gastos fixos, variáveis ou adicionais.
 * A ordem de confiança é: categoria informada, histórico do usuário,
 * nome igual a uma categoria, palavras-chave e, por fim, variável.
 */
export function classifyExpenseGroup({ itemName, category, subcategory, categories = [], history = [] }) {
  const name = normalizeText(itemName);
  const providedCategory = normalizeText(category);
  const providedSubcategory = normalizeText(subcategory);

  if ((providedCategory || providedSubcategory) && categories.length) {
    const fromCategory = categories.find(item =>
      item.budget_group
      && (!providedCategory || normalizeText(item.category) === providedCategory)
      && (!providedSubcategory || normalizeText(item.subcategory) === providedSubcategory));
    if (fromCategory) {
      return { group: controlGroupForBudgetGroup(fromCategory.budget_group), reason: 'category' };
    }
  }

  if (name) {
    const fromHistory = history
      .filter(entry => entry.group && normalizeText(entry.name) === name)
      .sort((left, right) => String(right.monthStart ?? '').localeCompare(String(left.monthStart ?? '')))[0];
    if (fromHistory) return { group: fromHistory.group, reason: 'history' };

    const sameName = categories.find(item =>
      item.budget_group
      && (normalizeText(item.category) === name || normalizeText(item.subcategory) === name));
    if (sameName) {
      return { group: controlGroupForBudgetGroup(sameName.budget_group), reason: 'category' };
    }
  }

  const scores = { fixed: 0, additional: 0, variable: 0 };
  for (const group of GROUP_PRIORITY) {
    for (const keyword of matchedKeywords(name, KEYWORDS[group])) {
      scores[group] += keyword.length;
    }
  }
  const best = GROUP_PRIORITY
    .map(group => [group, scores[group]])
    .sort((left, right) => right[1] - left[1])[0];
  if (best && best[1] > 0) {
    return { group: best[0], reason: 'keywords' };
  }

  return { group: 'variable', reason: 'default' };
}
