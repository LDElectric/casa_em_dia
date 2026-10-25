export const BACKUP_SCHEMA_VERSION = 1;

export function buildBackup({
  exportedAt,
  household,
  members,
  financeCategories,
  budgetTargets,
  reserveMovements,
  creditCards,
  cardStatements,
  cardStatementItems,
  recurringItems,
  monthlyControlItems,
  transactions
}) {
  return {
    app: 'casa-em-dia',
    schema_version: BACKUP_SCHEMA_VERSION,
    exported_at: exportedAt,
    household,
    members,
    finance_categories: financeCategories,
    budget_targets: budgetTargets,
    reserve_movements: reserveMovements,
    credit_cards: creditCards,
    card_statements: cardStatements,
    card_statement_items: cardStatementItems,
    recurring_items: recurringItems,
    monthly_control_items: monthlyControlItems,
    transactions
  };
}

export function toCsv(columns, rows, { separator = ';' } = {}) {
  const escape = value => {
    const text = value == null ? '' : String(value);
    return text.includes(separator) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    columns.map(column => escape(column.label)).join(separator),
    ...rows.map(row => columns.map(column => escape(column.value(row))).join(separator))
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function centsToCsv(cents) {
  if (cents == null) return '';
  return (Number(cents) / 100).toFixed(2).replace('.', ',');
}

export function backupFileName(prefix, date = new Date()) {
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}`;
}
