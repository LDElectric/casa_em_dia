import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.SUPABASE_CONFIG;
const authScreen = document.getElementById('auth-screen');
const setupScreen = document.getElementById('household-setup');
const appShell = document.getElementById('app-shell');
const state = {
  user: null,
  membership: null,
  members: [],
  transactions: [],
  recurringItems: [],
  insightsMonthIndex: 5
};

if (!config?.url || !config?.publishableKey) {
  document.getElementById('auth-message').textContent =
    'A configuração pública do Supabase está incompleta.';
} else {
  const supabase = createClient(config.url, config.publishableKey, {
    auth: { flowType: 'pkce', autoRefreshToken: true, persistSession: true }
  });
  startApp().catch(error => {
    console.error('Could not start the app:', error);
    document.getElementById('auth-message').textContent =
      'Não foi possível iniciar. Verifique a conexão e a configuração do Supabase.';
  });

  async function startApp() {
    document.getElementById('auth-form').addEventListener('submit', sendLoginLink);
    document.getElementById('household-form').addEventListener('submit', createHousehold);
    document.getElementById('invite-form').addEventListener('submit', inviteMember);
    document.getElementById('save-transaction').addEventListener('click', saveEntry);
    document.getElementById('open-invite').addEventListener('click', openInviteDialog);
    document.getElementById('close-invite').addEventListener('click', closeInviteDialog);
    document.getElementById('signout').addEventListener('click', signOut);
    document.getElementById('setup-signout').addEventListener('click', signOut);
    document.getElementById('invite-dialog').addEventListener('click', event => {
      if (event.target.id === 'invite-dialog') closeInviteDialog();
    });
    window.addEventListener('insights-month-changed', event => {
      state.insightsMonthIndex = event.detail.index;
      renderFinancialData();
    });

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setMessage('auth-message', 'Não foi possível verificar a sessão. Recarregue a página.');
      console.error('Could not read Supabase session:', error.message);
      return;
    }
    await handleSession(data.session);
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      queueMicrotask(() => {
        handleSession(session).catch(error => {
          console.error('Could not initialize authenticated app:', error);
          showToast('Não foi possível carregar os dados da casa. Tente novamente.');
        });
      });
    });
  }

  async function sendLoginLink(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value.trim().toLowerCase();
    setMessage('auth-message', 'Enviando link de acesso...');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`
      }
    });
    if (error) {
      console.error('Could not send sign-in link:', error.message);
      setMessage('auth-message', 'Não foi possível enviar o link. Confira se você já foi convidado e tente novamente.');
      return;
    }
    setMessage('auth-message', 'Se este e-mail foi convidado, o link de acesso chegará em instantes.');
  }

  async function handleSession(session) {
    if (!session?.user) {
      state.user = null;
      state.membership = null;
      state.members = [];
      authScreen.hidden = false;
      setupScreen.hidden = true;
      appShell.inert = true;
      setMessage('auth-message', '');
      return;
    }

    state.user = session.user;
    authScreen.hidden = false;
    setupScreen.hidden = true;
    appShell.inert = true;
    setMessage('auth-message', 'Verificando o acesso à casa...');
    const { data: membership, error } = await supabase
      .from('household_members')
      .select('household_id, role, email')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) {
      console.error('Could not load household membership:', error.message);
      setMessage('auth-message', 'Não foi possível verificar sua casa. Confira a conexão e a configuração do banco.');
      return;
    }

    if (!membership) {
      state.membership = null;
      authScreen.hidden = true;
      setupScreen.hidden = false;
      appShell.inert = true;
      return;
    }

    state.membership = membership;
    if (await loadHouseholdData()) {
      authScreen.hidden = true;
      setupScreen.hidden = true;
      appShell.inert = false;
    } else {
      setMessage('auth-message', 'Não foi possível carregar os dados da casa. Recarregue a página para tentar novamente.');
    }
  }

  async function createHousehold(event) {
    event.preventDefault();
    const name = document.getElementById('household-name').value.trim();
    if (!name) {
      setMessage('household-message', 'Informe um nome para a casa.');
      return;
    }
    setMessage('household-message', 'Criando sua casa...');
    const { error } = await supabase.rpc('create_household', { household_name: name });
    if (error) {
      console.error('Could not create household:', error.message);
      setMessage('household-message', 'Não foi possível criar a casa. Confira a configuração do banco e tente novamente.');
      return;
    }
    document.getElementById('household-name').value = '';
    await handleSession({ user: state.user });
  }

  async function loadHouseholdData() {
    if (!state.membership || !state.user) return;
    const householdId = state.membership.household_id;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

    const [membersResult, transactionsResult, recurringResult, householdResult] = await Promise.all([
      supabase.from('household_members')
        .select('user_id, email, role')
        .eq('household_id', householdId)
        .order('created_at'),
      supabase.from('transactions')
        .select('id, created_by, title, transaction_type, category, amount_cents, transaction_date')
        .eq('household_id', householdId)
        .gte('transaction_date', localDate(sixMonthsAgo))
        .order('transaction_date', { ascending: false }),
      supabase.from('recurring_items')
        .select('id, title, transaction_type, category, amount_cents, frequency, day_of_month, month_of_year')
        .eq('household_id', householdId)
        .order('title'),
      supabase.from('households')
        .select('name')
        .eq('id', householdId)
        .single()
    ]);

    for (const result of [membersResult, transactionsResult, recurringResult, householdResult]) {
      if (result.error) {
        console.error('Could not load household data:', result.error.message);
        showToast('Não foi possível carregar os dados da casa. Tente atualizar a página.');
        return false;
      }
    }

    state.members = membersResult.data;
    state.transactions = transactionsResult.data;
    state.recurringItems = recurringResult.data;
    document.querySelector('#screen-home .nav-subtitle').textContent =
      `${householdResult.data.name} · ${state.user.email ?? ''}`;
    document.getElementById('settings-household-name').textContent = householdResult.data.name;
    document.getElementById('settings-household-role').textContent =
      state.membership.role === 'owner' ? 'Responsável' : 'Membro';
    document.getElementById('household-member-count').textContent =
      `${state.members.length} ${state.members.length === 1 ? 'membro' : 'membros'} nesta casa.`;
    renderMembers();
    renderRecurringItems();
    renderFinancialData();
    return true;
  }

  function renderMembers() {
    const container = document.getElementById('household-members');
    container.replaceChildren();
    document.getElementById('open-invite').hidden = state.membership.role !== 'owner';

    for (const member of state.members) {
      const row = document.createElement('div');
      row.className = 'settings-item';
      const left = document.createElement('div');
      left.className = 'left';
      const icon = document.createElement('div');
      icon.className = 'icon-box';
      icon.style.background = member.role === 'owner' ? '#007aff' : '#af52de';
      icon.textContent = '👤';
      const email = document.createElement('span');
      email.textContent = member.email;
      const role = document.createElement('span');
      role.className = 'badge';
      role.textContent = member.role === 'owner' ? 'Responsável' : 'Membro';
      left.append(icon, email);
      row.append(left, role);

      if (state.membership.role === 'owner' && member.role === 'member') {
        const remove = document.createElement('button');
        remove.className = 'remove-member';
        remove.type = 'button';
        remove.textContent = 'Remover';
        remove.setAttribute('aria-label', `Remover ${member.email} da casa`);
        remove.addEventListener('click', () => removeMember(member));
        row.append(remove);
      }
      container.append(row);
    }
    if (!state.members.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhum membro cadastrado.';
      container.append(empty);
    }
  }

  async function inviteMember(event) {
    event.preventDefault();
    const email = document.getElementById('invite-email').value.trim().toLowerCase();
    setMessage('invite-message', 'Enviando convite...');
    const { data, error } = await supabase.functions.invoke('manage-household-member', {
      body: { email }
    });
    if (error || data?.error) {
      console.error('Could not invite household member:', error?.message ?? data.error);
      setMessage('invite-message', data?.error ?? 'Não foi possível enviar o convite. Verifique se a função foi publicada.');
      return;
    }
    document.getElementById('invite-email').value = '';
    setMessage('invite-message', 'Convite enviado.');
    await loadHouseholdData();
  }

  async function removeMember(member) {
    if (!window.confirm(`Remover ${member.email} da casa? Essa pessoa perderá o acesso aos dados compartilhados.`)) return;
    const { error } = await supabase
      .from('household_members')
      .delete()
      .eq('user_id', member.user_id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not remove household member:', error.message);
      showToast('Não foi possível remover o membro.');
      return;
    }
    showToast('Membro removido da casa.');
    await loadHouseholdData();
  }

  async function saveEntry() {
    const amount = parseAmount(document.getElementById('transaction-amount').value);
    const title = document.getElementById('transaction-title').value.trim();
    const selectedFrequency = document.querySelector('.freq-btn.active')?.dataset.freq ?? 'once';
    const selectedCategory = document.querySelector('.cat-btn.selected')?.dataset.category;
    const transactionType = document.getElementById('btn-expense').classList.contains('active')
      ? 'expense'
      : 'income';

    if (!state.user || !state.membership) {
      showToast('Entre na sua conta antes de cadastrar.');
      return;
    }
    if (!title || !selectedCategory || !Number.isSafeInteger(amount) || amount <= 0) {
      showToast('Informe uma descrição e um valor válido maior que zero.');
      return;
    }

    const payload = {
      household_id: state.membership.household_id,
      created_by: state.user.id,
      title,
      transaction_type: transactionType,
      category: selectedCategory,
      amount_cents: amount
    };
    document.getElementById('save-transaction').disabled = true;
    document.getElementById('save-message').textContent = 'Salvando...';

    const result = selectedFrequency === 'once'
      ? await supabase.from('transactions').insert({
          ...payload,
          transaction_date: localDate(new Date())
        })
      : await supabase.from('recurring_items').insert({
          ...payload,
          frequency: selectedFrequency,
          day_of_month: new Date().getDate(),
          month_of_year: selectedFrequency === 'yearly'
            ? Number(document.getElementById('transaction-month').value)
            : null
        });
    document.getElementById('save-transaction').disabled = false;

    if (result.error) {
      console.error('Could not save household entry:', result.error.message);
      document.getElementById('save-message').textContent = 'Não foi possível salvar. Tente novamente.';
      return;
    }

    document.getElementById('transaction-amount').value = '';
    document.getElementById('transaction-title').value = '';
    document.getElementById('save-message').textContent = '';
    window.closeSheet();
    showToast(selectedFrequency === 'once' ? 'Lançamento salvo.' : 'Item recorrente salvo.');
    await loadHouseholdData();
  }

  function renderRecurringItems() {
    const targets = {
      income: document.getElementById('recurring-income'),
      monthly: document.getElementById('recurring-monthly'),
      yearly: document.getElementById('recurring-yearly')
    };
    for (const container of Object.values(targets)) container.replaceChildren();

    const groups = {
      income: state.recurringItems.filter(item => item.transaction_type === 'income'),
      monthly: state.recurringItems.filter(item =>
        item.transaction_type === 'expense' && item.frequency === 'monthly'),
      yearly: state.recurringItems.filter(item =>
        item.transaction_type === 'expense' && item.frequency === 'yearly')
    };
    const emptyMessages = {
      income: 'Nenhuma receita fixa cadastrada.',
      monthly: 'Nenhuma despesa mensal cadastrada.',
      yearly: 'Nenhuma despesa anual cadastrada.'
    };

    for (const [group, items] of Object.entries(groups)) {
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = emptyMessages[group];
        targets[group].append(empty);
        continue;
      }
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'list-item';
        const info = document.createElement('div');
        info.className = 'info';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = item.title;
        const subtitle = document.createElement('div');
        subtitle.className = 'subtitle';
        const schedule = item.frequency === 'yearly'
          ? `${new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2020, item.month_of_year - 1, 1))} · dia ${item.day_of_month}`
          : `Todo mês · dia ${item.day_of_month}`;
        subtitle.textContent = `${schedule} · ${formatMoney(item.amount_cents)}`;
        info.append(title, subtitle);
        const remove = document.createElement('button');
        remove.className = 'remove-member';
        remove.type = 'button';
        remove.textContent = 'Remover';
        remove.setAttribute('aria-label', `Remover ${item.title}`);
        remove.addEventListener('click', () => deleteRecurringItem(item));
        row.append(info, remove);
        targets[group].append(row);
      }
    }
  }

  async function deleteRecurringItem(item) {
    const { error } = await supabase
      .from('recurring_items')
      .delete()
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not delete recurring item:', error.message);
      showToast('Não foi possível remover o item.');
      return;
    }
    await loadHouseholdData();
  }

  function renderFinancialData() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentTransactions = state.transactions.filter(item =>
      item.transaction_date.startsWith(currentMonth));
    const income = currentTransactions
      .filter(item => item.transaction_type === 'income')
      .reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const expenses = currentTransactions
      .filter(item => item.transaction_type === 'expense')
      .reduce((sum, item) => sum + Number(item.amount_cents), 0);
    document.getElementById('month-balance').textContent = formatMoney(income - expenses);
    document.getElementById('month-income').textContent = formatMoney(income);
    document.getElementById('month-expenses').textContent = formatMoney(expenses);

    const daysElapsed = now.getDate();
    document.getElementById('saving-rate').textContent =
      `${income ? Math.round(((income - expenses) / income) * 100) : 0}%`;
    document.getElementById('saving-note').textContent =
      income || expenses ? 'Neste mês' : 'Sem lançamentos';
    document.getElementById('daily-average').textContent =
      formatMoney(Math.round(expenses / daysElapsed));
    document.getElementById('daily-average-note').textContent =
      expenses ? `Média dos ${daysElapsed} dias do mês` : 'Sem lançamentos';

    const categoryTotals = new Map();
    for (const item of currentTransactions) {
      if (item.transaction_type === 'expense') {
        categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + Number(item.amount_cents));
      }
    }
    const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    document.getElementById('top-category').textContent = topCategory?.[0] ?? '—';
    document.getElementById('top-category-total').textContent =
      topCategory ? formatMoney(topCategory[1]) : 'Sem lançamentos';

    const yearlyExpenses = state.recurringItems
      .filter(item => item.transaction_type === 'expense' && item.frequency === 'yearly')
      .sort((a, b) => monthDistance(now.getMonth() + 1, a.month_of_year)
        - monthDistance(now.getMonth() + 1, b.month_of_year))[0];
    document.getElementById('next-annual').textContent = yearlyExpenses?.title ?? '—';
    document.getElementById('next-annual-note').textContent = yearlyExpenses
      ? `${monthName(yearlyExpenses.month_of_year)} · ${formatMoney(yearlyExpenses.amount_cents)}`
      : 'Nenhum item cadastrado';

    const selectedMonthDate = new Date(now.getFullYear(), now.getMonth() - (5 - state.insightsMonthIndex), 1);
    const selectedMonthKey = `${selectedMonthDate.getFullYear()}-${String(selectedMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const insightsTransactions = state.transactions.filter(item =>
      item.transaction_date.startsWith(selectedMonthKey));
    const insightIncome = sumType(insightsTransactions, 'income');
    const insightExpenses = sumType(insightsTransactions, 'expense');
    const daysCovered = selectedMonthKey === currentMonth
      ? now.getDate()
      : new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() + 1, 0).getDate();
    const spendingDays = new Set(insightsTransactions
      .filter(item => item.transaction_type === 'expense')
      .map(item => item.transaction_date)).size;
    document.getElementById('insight-balance').textContent = formatMoney(insightIncome - insightExpenses);
    document.getElementById('insight-balance-note').textContent =
      insightsTransactions.length ? 'Receitas menos despesas' : 'Sem lançamentos';
    document.getElementById('insight-saving-rate').textContent =
      `${insightIncome ? Math.round(((insightIncome - insightExpenses) / insightIncome) * 100) : 0}%`;
    document.getElementById('insight-saving-note').textContent =
      insightsTransactions.length ? 'No mês selecionado' : 'Sem lançamentos';
    document.getElementById('insight-daily-average').textContent =
      formatMoney(Math.round(insightExpenses / daysCovered));
    document.getElementById('insight-daily-note').textContent =
      insightExpenses ? `Média em ${daysCovered} dias` : 'Sem lançamentos';
    document.getElementById('insight-no-spend-days').textContent =
      insightsTransactions.length ? String(Math.max(0, daysCovered - spendingDays)) : '—';
    document.getElementById('insight-no-spend-note').textContent =
      insightsTransactions.length ? 'No mês selecionado' : 'Sem lançamentos';

    renderTransactions(document.getElementById('recent-transactions'), currentTransactions.slice(0, 4));
    renderTransactions(document.getElementById('all-transactions'), currentTransactions);
    updateCharts(insightsTransactions);
  }

  function renderTransactions(container, items) {
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhuma movimentação cadastrada.';
      container.append(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'list-item';
      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.textContent = categoryIcons[item.category] ?? '📦';
      icon.style.background = 'var(--accent-soft)';
      icon.style.color = 'var(--accent)';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = item.title;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      const author = state.members.find(member => member.user_id === item.created_by)?.email ?? 'Membro da casa';
      subtitle.textContent = `${formatDate(item.transaction_date)} · ${author} · ${item.category}`;
      info.append(title, subtitle);
      const amount = document.createElement('div');
      amount.className = `amount ${item.transaction_type}`;
      amount.textContent = `${item.transaction_type === 'income' ? '+' : '−'} ${formatMoney(item.amount_cents)}`;
      row.append(icon, info, amount);
      container.append(row);
    }
  }

  function updateCharts(currentTransactions) {
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - 5 + index);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthTransactions = state.transactions.filter(item => item.transaction_date.startsWith(key));
      return {
        income: monthTransactions.filter(item => item.transaction_type === 'income')
          .reduce((sum, item) => sum + Number(item.amount_cents), 0) / 100,
        expenses: monthTransactions.filter(item => item.transaction_type === 'expense')
          .reduce((sum, item) => sum + Number(item.amount_cents), 0) / 100,
        balance: monthTransactions.reduce((sum, item) =>
          sum + (item.transaction_type === 'income' ? 1 : -1) * Number(item.amount_cents), 0) / 100
      };
    });
    const categories = new Map();
    for (const item of currentTransactions) {
      if (item.transaction_type === 'expense') {
        categories.set(item.category, (categories.get(item.category) ?? 0) + Number(item.amount_cents) / 100);
      }
    }
    window.householdChartData = { monthly, categories: [...categories.entries()] };
    window.dispatchEvent(new CustomEvent('household-data-loaded', {
      detail: window.householdChartData
    }));
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Could not sign out:', error.message);
      showToast('Não foi possível sair da conta.');
    }
  }

  function openInviteDialog() {
    setMessage('invite-message', '');
    appShell.inert = true;
    document.getElementById('invite-dialog').hidden = false;
    document.getElementById('invite-email').focus();
  }

  function closeInviteDialog() {
    document.getElementById('invite-dialog').hidden = true;
    appShell.inert = false;
    document.getElementById('open-invite').focus();
  }

  function parseAmount(rawValue) {
    const normalized = rawValue.trim().replace(/\./g, '').replace(',', '.');
    const value = Number(normalized);
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }

  function sumType(transactions, type) {
    return transactions
      .filter(item => item.transaction_type === type)
      .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  }

  function monthDistance(currentMonth, targetMonth) {
    return (targetMonth - currentMonth + 12) % 12;
  }

  function monthName(month) {
    return new Intl.DateTimeFormat('pt-BR', { month: 'long' })
      .format(new Date(2020, month - 1, 1));
  }

  function formatMoney(cents) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(cents / 100);
  }

  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
      .format(new Date(year, month - 1, day));
  }

  function setMessage(id, message) {
    document.getElementById(id).textContent = message;
  }

  function showToast(message) {
    const toast = document.getElementById('app-toast');
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timeout);
    showToast.timeout = window.setTimeout(() => { toast.hidden = true; }, 4000);
  }
}

const categoryIcons = {
  Alimentação: '🛒',
  Moradia: '🏠',
  Transporte: '🚗',
  Cartão: '💳',
  Assinaturas: '📺',
  Contas: '⚡',
  Salário: '💰',
  Outros: '📦'
};

window.addEventListener('household-data-loaded', event => {
  const { monthly, categories } = event.detail;
  if (typeof Chart === 'undefined') return;

  const income = monthly.map(item => item.income);
  const expenses = monthly.map(item => item.expenses);
  const balance = monthly.map(item => item.balance);
  const categoryLabels = categories.map(([name]) => name);
  const categoryData = categories.map(([, value]) => value);

  if (window.chartTrend) {
    window.chartTrend.data.datasets[0].data = income;
    window.chartTrend.data.datasets[1].data = expenses;
    window.chartTrend.update();
  }
  if (window.chartCategories) {
    window.chartCategories.data.labels = categoryLabels.length ? categoryLabels : ['Sem lançamentos'];
    window.chartCategories.data.datasets[0].data = categoryData.length ? categoryData : [0];
    window.chartCategories.update();
  }
  if (window.chartMonthly) {
    window.chartMonthly.data.datasets[0].data = balance;
    window.chartMonthly.update();
  }
});
