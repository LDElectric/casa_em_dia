import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.SUPABASE_CONFIG;
const authScreen = document.getElementById('auth-screen');
const setupScreen = document.getElementById('household-setup');
const appShell = document.getElementById('app-shell');
const initialAuthCallback = (() => {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return query.has('code')
    || query.has('token_hash')
    || ['invite', 'recovery'].includes(query.get('type'))
    || ['invite', 'recovery'].includes(hash.get('type'))
    || hash.has('access_token');
})();
const state = {
  user: null,
  membership: null,
  members: [],
  transactions: [],
  recurringItems: [],
  financeCategories: [],
  budgetTargets: [],
  reserveMovements: [],
  creditCards: [],
  cardStatements: [],
  cardStatementItems: [],
  monthlyControlItems: [],
  controlMonthKey: null,
  pendingCardImport: null,
  pendingHouseholdImport: null,
  editingFinanceCategoryId: null,
  editingBudgetTargetId: null,
  editingCreditCardId: null,
  authLinkFlow: null,
  authCallbackPending: initialAuthCallback,
  passwordSetupPending: false,
  completingPasswordSetup: false,
  sessionRefreshPromise: null,
  householdDataLoadedAt: 0,
  insightsMonthIndex: 5
};

const DEFAULT_FINANCE_CATEGORIES = [
  ['income', 'Trabalho', 'Salário', null],
  ['income', 'Benefícios', 'Auxílio-creche', null],
  ['income', 'Benefícios', 'Vale-alimentação', null],
  ['income', 'Outros', 'Outras receitas', null],
  ['expense', 'Moradia', 'Conta de água', 'fixed'],
  ['expense', 'Moradia', 'Conta de energia', 'fixed'],
  ['expense', 'Serviços', 'Internet', 'fixed'],
  ['expense', 'Assinaturas', 'Streaming', 'fixed'],
  ['expense', 'Família e educação', 'Creche', 'fixed'],
  ['expense', 'Família e educação', 'Faculdade', 'fixed'],
  ['expense', 'Comunicação', 'Recarga de celular', 'fixed'],
  ['expense', 'Profissional', 'Caixinha CREA', 'fixed'],
  ['expense', 'Profissional', 'Caixinha CRT', 'fixed'],
  ['expense', 'Alimentação', 'Feira', 'variable'],
  ['expense', 'Pets', 'Ração dos cachorros', 'fixed'],
  ['expense', 'Transporte', 'Combustível', 'variable'],
  ['expense', 'Alimentação', 'Padaria', 'variable'],
  ['expense', 'Alimentação', 'Água mineral', 'variable'],
  ['expense', 'Alimentação', 'Gás de cozinha', 'variable'],
  ['expense', 'Alimentação', 'Feira - complementos', 'variable'],
  ['expense', 'Lazer', 'Passeios', 'leisure'],
  ['expense', 'Lazer', 'Lanches', 'leisure'],
  ['expense', 'Saúde', 'Medicamentos', 'variable'],
  ['expense', 'Saúde', 'Consultas', 'variable'],
  ['expense', 'Pets', 'Veterinário', 'variable'],
  ['expense', 'Transporte', 'Peças de carro', 'variable'],
  ['expense', 'Transporte', 'Peças de moto', 'variable'],
  ['expense', 'Saúde', 'Farmácia', 'variable'],
  ['expense', 'Outros', 'Outras despesas', 'variable']
];

if (!config?.url || !config?.publishableKey) {
  document.getElementById('auth-status-title').textContent = 'Configuração necessária';
  document.getElementById('auth-status-message').textContent =
    'A configuração pública do Supabase está incompleta.';
  document.getElementById('auth-status-card').hidden = false;
} else {
  const supabase = createClient(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      storage: window.localStorage
    }
  });
  startApp().catch(error => {
    console.error('Could not start the app:', error);
    document.getElementById('auth-message').textContent =
      'Não foi possível iniciar. Verifique a conexão e a configuração do Supabase.';
  });

  async function startApp() {
    document.getElementById('auth-form').addEventListener('submit', signInWithPassword);
    document.getElementById('request-first-access').addEventListener('click', () => showAuthLinkRequest('first-access'));
    document.getElementById('request-password-reset').addEventListener('click', () => showAuthLinkRequest('reset-password'));
    document.getElementById('auth-link-form').addEventListener('submit', requestPasswordSetupLink);
    document.getElementById('back-to-login').addEventListener('click', showLoginCard);
    document.getElementById('password-setup-form').addEventListener('submit', setAccountPassword);
    document.getElementById('password-setup-back').addEventListener('click', cancelPasswordSetup);
    document.getElementById('auth-retry').addEventListener('click', () => refreshSession(true));
    document.getElementById('household-form').addEventListener('submit', createHousehold);
    document.getElementById('invite-form').addEventListener('submit', inviteMember);
    document.getElementById('save-transaction').addEventListener('click', saveEntry);
    document.getElementById('entry-category').addEventListener('change', renderSubcategoryOptions);
    document.getElementById('entry-subcategory').addEventListener('change', setDefaultBudgetGroup);
    document.getElementById('payment-method').addEventListener('change', updatePaymentFields);
    window.addEventListener('entry-type-changed', () => {
      renderEntryCategoryOptions();
      updatePaymentFields();
    });
    document.getElementById('finance-category-form').addEventListener('submit', addFinanceCategory);
    document.getElementById('cancel-finance-category-edit').addEventListener('click', resetFinanceCategoryForm);
    document.getElementById('category-type').addEventListener('change', () => {
      document.getElementById('category-budget-group-wrap').hidden =
        document.getElementById('category-type').value === 'income';
    });
    document.getElementById('budget-target-form').addEventListener('submit', saveBudgetTarget);
    document.getElementById('budget-target-type').addEventListener('change', updateBudgetTargetCardField);
    document.getElementById('cancel-budget-target-edit').addEventListener('click', resetBudgetTargetForm);
    document.getElementById('household-setup-import-form').addEventListener('submit', prepareHouseholdImport);
    document.getElementById('confirm-household-import').addEventListener('click', confirmHouseholdImport);
    document.getElementById('reserve-movement-form').addEventListener('submit', saveReserveMovement);
    document.getElementById('credit-card-form').addEventListener('submit', saveCreditCard);
    document.getElementById('cancel-credit-card-edit').addEventListener('click', resetCreditCardForm);
    const scopeField = document.getElementById('card-statement-scope');
    if (scopeField) scopeField.addEventListener('change', updateCardScopeFields);
    document.getElementById('card-import-form').addEventListener('submit', prepareCardImport);
    document.getElementById('confirm-card-import').addEventListener('click', confirmCardImport);
    document.getElementById('monthly-control-form').addEventListener('submit', addMonthlyControlItem);
    document.getElementById('copy-control-items').addEventListener('click', copyPreviousMonthItems);
    window.addEventListener('control-month-changed', event => {
      state.controlMonthKey = event.detail.monthKey;
      renderMonthlyControl();
      renderFinancialData();
    });
    document.getElementById('statement-csv').addEventListener('change', suggestDueDateFromFile);
    document.getElementById('open-invite').addEventListener('click', openInviteDialog);
    document.getElementById('close-invite').addEventListener('click', closeInviteDialog);
    document.getElementById('signout').addEventListener('click', signOut);
    document.getElementById('setup-signout').addEventListener('click', signOut);
    document.getElementById('invite-dialog').addEventListener('click', event => {
      if (event.target.id === 'invite-dialog') closeInviteDialog();
    });
    updateCardScopeFields();
    const today = new Date();
    state.controlMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    window.addEventListener('insights-month-changed', event => {
      state.insightsMonthIndex = event.detail.index;
      renderFinancialData();
    });

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Could not read Supabase session:', error.message);
      showAuthStatus('Não foi possível verificar sua sessão. Confira a conexão e tente novamente.', true);
      return;
    }
    await handleSession(data.session);
    supabase.auth.onAuthStateChange((event, session) => {
      if (state.completingPasswordSetup || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      if (event === 'PASSWORD_RECOVERY') state.passwordSetupPending = true;
      queueMicrotask(() => {
        handleSession(session).catch(error => {
          console.error('Could not initialize authenticated app:', error);
          showToast('Não foi possível carregar os dados da casa. Tente novamente.');
        });
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshSession();
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted) refreshSession();
    });
    window.addEventListener('online', () => refreshSession(true));
  }

  async function refreshSession(forceDataRefresh = false) {
    if (state.sessionRefreshPromise || state.authCallbackPending || state.passwordSetupPending) return;
    state.sessionRefreshPromise = (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Could not restore Supabase session:', error.message);
        if (state.user && !authScreen.hidden) {
          showAuthStatus('Não foi possível reconectar à sua conta. Confira a internet e tente novamente.', true);
        } else {
          showToast('Não foi possível atualizar sua sessão. Confira a conexão.');
        }
        return;
      }
      const session = data.session;
      if (!session?.user) {
        await handleSession(null);
        return;
      }
      if (state.user?.id !== session.user.id || !state.membership) {
        await handleSession(session);
        return;
      }
      if (!forceDataRefresh && Date.now() - state.householdDataLoadedAt < 60_000) return;
      if (await loadHouseholdData()) {
        authScreen.hidden = true;
        setupScreen.hidden = true;
        appShell.inert = false;
      } else {
        showToast('Sessão mantida. Não foi possível atualizar os dados; tente novamente quando houver conexão.');
      }
    })();
    try {
      await state.sessionRefreshPromise;
    } catch (error) {
      console.error('Could not refresh authenticated app:', error);
      showToast('Não foi possível atualizar os dados da casa.');
    } finally {
      state.sessionRefreshPromise = null;
    }
  }

  function showAuthStatus(message, canRetry = false) {
    authScreen.hidden = false;
    setupScreen.hidden = true;
    appShell.inert = true;
    document.getElementById('auth-status-card').hidden = false;
    document.getElementById('auth-status-title').textContent =
      canRetry ? 'Sem conexão com a casa' : 'Carregando sua casa';
    document.getElementById('auth-status-message').textContent = message;
    document.getElementById('auth-retry').hidden = !canRetry;
    document.getElementById('auth-login-card').hidden = true;
    document.getElementById('auth-link-card').hidden = true;
    document.getElementById('auth-password-card').hidden = true;
  }

  async function signInWithPassword(event) {
    event.preventDefault();
    const email = document.getElementById('auth-email').value.trim().toLowerCase();
    const password = document.getElementById('auth-password').value;
    setMessage('auth-message', 'Verificando acesso...');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('Could not sign in with password:', error.message);
      setMessage('auth-message', 'E-mail ou senha inválidos. Se recebeu um convite, escolha “Primeiro acesso”.');
      return;
    }
    document.getElementById('auth-password').value = '';
  }

  function showAuthLinkRequest(flow) {
    state.authLinkFlow = flow;
    document.getElementById('auth-login-card').hidden = true;
    document.getElementById('auth-link-card').hidden = false;
    document.getElementById('auth-password-card').hidden = true;
    document.getElementById('auth-link-title').textContent = flow === 'first-access'
      ? 'Ative seu convite'
      : 'Redefina sua senha';
    document.getElementById('auth-link-description').textContent = flow === 'first-access'
      ? 'Informe o e-mail que recebeu o convite. Enviaremos um link para você definir sua senha e ativar o acesso.'
      : 'Informe o e-mail da sua conta. Enviaremos um link seguro para criar uma nova senha.';
    document.getElementById('send-auth-link').textContent = flow === 'first-access'
      ? 'Enviar link de ativação'
      : 'Enviar link de redefinição';
    document.getElementById('auth-link-email').value =
      document.getElementById('auth-email').value.trim().toLowerCase();
    setMessage('auth-link-message', '');
    document.getElementById('auth-link-email').focus();
  }

  function showLoginCard() {
    state.authLinkFlow = null;
    document.getElementById('auth-login-card').hidden = false;
    document.getElementById('auth-link-card').hidden = true;
    document.getElementById('auth-password-card').hidden = true;
    const email = document.getElementById('auth-link-email').value.trim().toLowerCase();
    if (email) document.getElementById('auth-email').value = email;
    document.getElementById('auth-password').focus();
  }

  async function requestPasswordSetupLink(event) {
    event.preventDefault();
    const email = document.getElementById('auth-link-email').value.trim().toLowerCase();
    if (!email) {
      setMessage('auth-link-message', 'Informe o e-mail da conta.');
      document.getElementById('auth-link-email').focus();
      return;
    }
    const flow = state.authLinkFlow ?? 'reset-password';
    const button = document.getElementById('send-auth-link');
    button.disabled = true;
    setMessage('auth-link-message', 'Solicitando o link...');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: passwordSetupUrl(flow)
      });
      if (error) {
        console.error('Could not request password setup link:', error.message);
        setMessage('auth-link-message', passwordResetErrorMessage(error));
        return;
      }
      setMessage('auth-link-message', flow === 'first-access'
        ? 'Se este e-mail já foi convidado, enviaremos o link de ativação. Confira sua caixa de entrada e o spam.'
        : 'Se este e-mail estiver cadastrado, enviaremos o link de redefinição. Confira sua caixa de entrada e o spam.');
    } catch (error) {
      console.error('Could not request password setup link:', error);
      setMessage('auth-link-message', 'Não foi possível conectar ao serviço de e-mail. Confira sua conexão e tente novamente.');
    } finally {
      button.disabled = false;
    }
  }

  function passwordResetErrorMessage(error) {
    const message = error.message.toLocaleLowerCase();
    if (error.status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
      return 'Foi solicitado um link recentemente. Aguarde um pouco antes de tentar novamente.';
    }
    if (message.includes('redirect') || message.includes('url') || message.includes('allow list')) {
      return 'O Supabase recusou o endereço de retorno. Confira se https://casa-em-dia-7l4.pages.dev/** está em Authentication → URL Configuration → Redirect URLs.';
    }
    if (message.includes('smtp') || message.includes('email') || message.includes('mail')) {
      return 'O Supabase não conseguiu enviar o e-mail. Confira o SMTP e os limites de envio em Authentication.';
    }
    return 'O Supabase recusou a solicitação. Aguarde um pouco e tente novamente; se persistir, confira o Console do navegador e Authentication → URL Configuration no painel.';
  }

  async function setAccountPassword(event) {
    event.preventDefault();
    const password = document.getElementById('new-password').value;
    const confirmation = document.getElementById('confirm-new-password').value;
    if (password.length < 12) {
      setMessage('password-setup-message', 'A senha precisa ter pelo menos 12 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setMessage('password-setup-message', 'As senhas não conferem.');
      return;
    }
    setMessage('password-setup-message', 'Salvando a senha...');
    state.completingPasswordSetup = true;
    const { data, error } = await supabase.auth.updateUser({ password });
    state.completingPasswordSetup = false;
    if (error) {
      console.error('Could not set account password:', error.message);
      setMessage('password-setup-message', 'Não foi possível salvar. Verifique os requisitos de senha configurados no Supabase.');
      return;
    }
    document.getElementById('password-setup-form').reset();
    state.passwordSetupPending = false;
    state.authCallbackPending = false;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = '';
    cleanUrl.hash = '';
    window.history.replaceState({}, document.title, cleanUrl.toString());
    await handleSession({ user: data.user });
  }

  function passwordSetupUrl(flow) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('mode', flow);
    return url.toString();
  }

  function passwordSetupMode() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const mode = search.get('mode');
    if (mode === 'first-access' || mode === 'invite' || mode === 'reset-password') return mode;
    if (mode === 'set-password') return 'invite';
    if (search.get('type') === 'recovery' || hash.get('type') === 'recovery') return 'reset-password';
    if (search.get('type') === 'invite' || hash.get('type') === 'invite') return 'invite';
    if (initialAuthCallback) return 'invite';
    return 'reset-password';
  }

  function isPasswordSetupFlow() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return state.passwordSetupPending
      || state.authCallbackPending
      || ['first-access', 'invite', 'reset-password', 'set-password'].includes(search.get('mode'))
      || ['invite', 'recovery'].includes(hash.get('type'));
  }

  function renderPasswordSetupCopy() {
    const mode = passwordSetupMode();
    const isFirstAccess = mode === 'first-access' || mode === 'invite';
    document.getElementById('password-setup-title').textContent = isFirstAccess
      ? 'Ative seu acesso'
      : 'Redefina sua senha';
    document.getElementById('password-setup-description').textContent = isFirstAccess
      ? 'Seu convite foi validado. Crie uma senha exclusiva para concluir o primeiro acesso à casa.'
      : 'Crie uma nova senha exclusiva para proteger sua conta.';
  }

  async function cancelPasswordSetup() {
    const previousFlow = state.authLinkFlow;
    state.authLinkFlow = null;
    state.passwordSetupPending = false;
    state.authCallbackPending = false;
    const { error } = await supabase.auth.signOut();
    if (error) {
      state.authLinkFlow = previousFlow;
      console.error('Could not cancel password setup:', error.message);
      setMessage('password-setup-message', 'Não foi possível voltar ao login. Recarregue a página.');
      return;
    }
    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = '';
    cleanUrl.hash = '';
    window.history.replaceState({}, document.title, cleanUrl.toString());
    showLoginCard();
  }

  async function handleSession(session) {
    if (!session?.user) {
      const invalidAuthCallback = state.authCallbackPending;
      state.user = null;
      state.membership = null;
      state.members = [];
      state.pendingHouseholdImport = null;
      state.passwordSetupPending = false;
      state.authCallbackPending = false;
      authScreen.hidden = false;
      setupScreen.hidden = true;
      appShell.inert = true;
      document.getElementById('auth-status-card').hidden = true;
      if (state.authLinkFlow) {
        document.getElementById('auth-login-card').hidden = true;
        document.getElementById('auth-link-card').hidden = false;
        document.getElementById('auth-password-card').hidden = true;
      } else {
        document.getElementById('auth-login-card').hidden = false;
        document.getElementById('auth-link-card').hidden = true;
        document.getElementById('auth-password-card').hidden = true;
      }
      setMessage('auth-message', invalidAuthCallback
        ? 'O convite não pôde ser validado. Abra o link mais recente do e-mail ou solicite um novo link de criação de senha.'
        : '');
      return;
    }

    if (state.user?.id !== session.user.id) state.membership = null;
    state.user = session.user;
    authScreen.hidden = false;
    setupScreen.hidden = true;
    appShell.inert = true;
    showAuthStatus('Abrindo sua casa e carregando os dados...');
    if (isPasswordSetupFlow()) {
      document.getElementById('auth-status-card').hidden = true;
      document.getElementById('auth-login-card').hidden = true;
      document.getElementById('auth-link-card').hidden = true;
      document.getElementById('auth-password-card').hidden = false;
      renderPasswordSetupCopy();
      document.getElementById('new-password').focus();
      return;
    }
    const { data: membership, error } = await supabase
      .from('household_members')
      .select('household_id, role, email')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) {
      console.error('Could not load household membership:', error.message);
      showAuthStatus('Não foi possível verificar sua casa. Confira a conexão e tente novamente.', true);
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
      showAuthStatus('Não foi possível carregar os dados da casa. Sua sessão continua protegida; tente novamente.', true);
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
    if (!state.membership || !state.user) return false;
    const householdId = state.membership.household_id;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

    const [
      membersResult,
      transactionsResult,
      recurringResult,
      householdResult,
      categoriesResult,
      budgetTargetsResult,
      reserveMovementsResult,
      cardsResult,
      statementsResult,
      statementItemsResult,
      monthlyControlResult
    ] = await Promise.all([
      supabase.from('household_members')
        .select('user_id, email, role')
        .eq('household_id', householdId)
        .order('created_at'),
      supabase.from('transactions')
        .select('id, created_by, title, transaction_type, category, subcategory, budget_group, payment_method, credit_card_id, amount_cents, transaction_date')
        .eq('household_id', householdId)
        .gte('transaction_date', localDate(sixMonthsAgo))
        .order('transaction_date', { ascending: false }),
      supabase.from('recurring_items')
        .select('id, title, transaction_type, category, subcategory, budget_group, amount_cents, frequency, day_of_month, month_of_year')
        .eq('household_id', householdId)
        .order('title'),
      supabase.from('households')
        .select('name')
        .eq('id', householdId)
        .single(),
      supabase.from('finance_categories')
        .select('id, transaction_type, category, subcategory, budget_group')
        .eq('household_id', householdId)
        .order('transaction_type')
        .order('category')
        .order('subcategory'),
      supabase.from('budget_targets')
        .select('id, target_type, label, amount_cents, credit_card_id, related_card_label')
        .eq('household_id', householdId)
        .order('target_type')
        .order('label'),
      supabase.from('reserve_movements')
        .select('id, direction, amount_cents, description, movement_date')
        .eq('household_id', householdId)
        .order('movement_date', { ascending: false }),
      supabase.from('credit_cards')
        .select('id, label, provider, titular_name, cardholder_name, card_role, statement_scope, last_four, credit_limit_cents, active')
        .eq('household_id', householdId)
        .order('label'),
      supabase.from('card_statements')
        .select('id, credit_card_id, due_date, status, paid_at, source_filename, imported_at')
        .eq('household_id', householdId)
        .order('due_date', { ascending: false }),
      supabase.from('card_statement_items')
        .select('id, statement_id, source_key, purchase_date, title, cardholder_label, amount_cents, installment_number, installment_total, category, subcategory, budget_group')
        .eq('household_id', householdId)
        .order('purchase_date', { ascending: false }),
      supabase.from('monthly_control_items')
        .select('id, month_start, item_name, transaction_type, control_group, amount_cents')
        .eq('household_id', householdId)
        .order('month_start', { ascending: false })
        .order('control_group')
        .order('item_name')
    ]);

    for (const result of [
      membersResult,
      transactionsResult,
      recurringResult,
      householdResult,
      categoriesResult,
      budgetTargetsResult,
      reserveMovementsResult,
      cardsResult,
      statementsResult,
      statementItemsResult,
      monthlyControlResult
    ]) {
      if (result.error) {
        console.error('Could not load household data:', result.error.message);
        showToast('Não foi possível carregar os dados da casa. Tente atualizar a página.');
        return false;
      }
    }

    let financeCategories = categoriesResult.data;
    if (!financeCategories.length) {
      const defaults = DEFAULT_FINANCE_CATEGORIES.map(([transaction_type, category, subcategory, budget_group]) => ({
        household_id: householdId,
        transaction_type,
        category,
        subcategory,
        budget_group,
        created_by: state.user.id
      }));
      const { error: seedError } = await supabase.from('finance_categories').upsert(defaults, {
        onConflict: 'household_id,transaction_type,category,subcategory',
        ignoreDuplicates: true
      });
      if (seedError) {
        console.error('Could not seed household categories:', seedError.message);
        showToast('Não foi possível preparar as categorias iniciais.');
        return false;
      }
      const { data, error: reloadError } = await supabase.from('finance_categories')
        .select('id, transaction_type, category, subcategory, budget_group')
        .eq('household_id', householdId)
        .order('transaction_type')
        .order('category')
        .order('subcategory');
      if (reloadError) {
        console.error('Could not reload household categories:', reloadError.message);
        showToast('Não foi possível carregar as categorias iniciais.');
        return false;
      }
      financeCategories = data;
    }

    state.members = membersResult.data;
    state.transactions = transactionsResult.data;
    state.recurringItems = recurringResult.data;
    state.financeCategories = financeCategories;
    state.budgetTargets = budgetTargetsResult.data;
    state.reserveMovements = reserveMovementsResult.data;
    state.creditCards = cardsResult.data;
    state.cardStatements = statementsResult.data;
    state.cardStatementItems = statementItemsResult.data;
    state.monthlyControlItems = monthlyControlResult.data;
    document.getElementById('control-household-subtitle').textContent =
      `${householdResult.data.name} · ${state.user.email ?? ''}`;
    document.getElementById('settings-household-name').textContent = householdResult.data.name;
    document.getElementById('settings-household-role').textContent =
      state.membership.role === 'owner' ? 'Responsável' : 'Membro';
    document.getElementById('household-member-count').textContent =
      `${state.members.length} ${state.members.length === 1 ? 'membro' : 'membros'} nesta casa.`;
    renderMembers();
    renderFinanceCategories();
    renderBudgetTargets();
    renderCreditCards();
    renderCardStatements();
    renderCardInstallmentForecast();
    renderRecurringItems();
    renderMonthlyControl();
    renderFinancialData();
    state.householdDataLoadedAt = Date.now();
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

  function renderEntryCategoryOptions() {
    const transactionType = document.getElementById('btn-expense').classList.contains('active')
      ? 'expense'
      : 'income';
    const select = document.getElementById('entry-category');
    const current = select.value;
    const categories = [...new Set(state.financeCategories
      .filter(item => item.transaction_type === transactionType)
      .map(item => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    select.replaceChildren(new Option('Selecione uma categoria', ''));
    for (const category of categories) select.add(new Option(category, category));
    select.value = categories.includes(current) ? current : '';
    renderSubcategoryOptions();
  }

  function renderSubcategoryOptions() {
    const transactionType = document.getElementById('btn-expense').classList.contains('active')
      ? 'expense'
      : 'income';
    const category = document.getElementById('entry-category').value;
    const select = document.getElementById('entry-subcategory');
    const current = select.value;
    const subcategories = state.financeCategories
      .filter(item => item.transaction_type === transactionType && item.category === category)
      .map(item => item.subcategory)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    select.replaceChildren(new Option('Selecione uma subcategoria', ''));
    for (const subcategory of subcategories) select.add(new Option(subcategory, subcategory));
    select.value = subcategories.includes(current) ? current : '';
    setDefaultBudgetGroup();
  }

  function setDefaultBudgetGroup() {
    const category = document.getElementById('entry-category').value;
    const subcategory = document.getElementById('entry-subcategory').value;
    const option = state.financeCategories.find(item =>
      item.transaction_type === 'expense'
      && item.category === category
      && item.subcategory === subcategory);
    if (option?.budget_group) document.getElementById('entry-budget-group').value = option.budget_group;
  }

  function updatePaymentFields() {
    const isExpense = document.getElementById('btn-expense').classList.contains('active');
    const isCredit = isExpense && document.getElementById('payment-method').value === 'credit';
    document.getElementById('entry-credit-card-wrap').hidden = !isCredit;
    const cardSelect = document.getElementById('entry-credit-card');
    const selected = cardSelect.value;
    cardSelect.replaceChildren(new Option('Selecione o cartão', ''));
    for (const card of state.creditCards.filter(item => item.active)) {
      cardSelect.add(new Option(card.label, card.id));
    }
    cardSelect.value = state.creditCards.some(card => card.id === selected && card.active)
      ? selected
      : '';
  }

  function renderFinanceCategories() {
    renderEntryCategoryOptions();
    const container = document.getElementById('finance-category-list');
    container.replaceChildren();
    if (!state.financeCategories.length) {
      appendEmptyState(container, 'Nenhuma categoria cadastrada.');
      return;
    }
    for (const item of state.financeCategories) {
      const row = document.createElement('div');
      row.className = 'list-item';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = `${item.category} · ${item.subcategory}`;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = item.transaction_type === 'income'
        ? 'Receita'
        : budgetGroupLabel(item.budget_group);
      info.append(title, subtitle);
      const remove = document.createElement('button');
      remove.className = 'remove-member';
      remove.type = 'button';
      remove.textContent = 'Remover';
      remove.addEventListener('click', () => removeFinanceCategory(item));
      const edit = document.createElement('button');
      edit.className = 'remove-member';
      edit.type = 'button';
      edit.textContent = 'Editar';
      edit.addEventListener('click', () => editFinanceCategory(item));
      row.append(info, edit, remove);
      container.append(row);
    }
  }

  async function addFinanceCategory(event) {
    event.preventDefault();
    const transactionType = document.getElementById('category-type').value;
    const category = document.getElementById('category-name').value.trim();
    const subcategory = document.getElementById('subcategory-name').value.trim();
    const budgetGroup = transactionType === 'expense'
      ? document.getElementById('category-budget-group').value
      : null;
    if (!category || !subcategory) {
      setMessage('finance-category-message', 'Informe a categoria e a subcategoria.');
      return;
    }
    const payload = {
      transaction_type: transactionType,
      category,
      subcategory,
      budget_group: budgetGroup
    };
    const query = state.editingFinanceCategoryId
      ? supabase.from('finance_categories').update(payload)
          .eq('id', state.editingFinanceCategoryId)
          .eq('household_id', state.membership.household_id)
      : supabase.from('finance_categories').insert({
      household_id: state.membership.household_id,
      ...payload,
      created_by: state.user.id
    });
    const { error } = await query;
    if (error) {
      console.error('Could not add finance category:', error.message);
      setMessage('finance-category-message', 'Não foi possível salvar. Confira se essa combinação já existe.');
      return;
    }
    resetFinanceCategoryForm();
    setMessage('finance-category-message', 'Categoria salva.');
    await loadHouseholdData();
  }

  function editFinanceCategory(item) {
    state.editingFinanceCategoryId = item.id;
    document.getElementById('category-type').value = item.transaction_type;
    document.getElementById('category-name').value = item.category;
    document.getElementById('subcategory-name').value = item.subcategory;
    document.getElementById('category-budget-group-wrap').hidden = item.transaction_type === 'income';
    if (item.budget_group) document.getElementById('category-budget-group').value = item.budget_group;
    document.getElementById('save-finance-category').textContent = 'Salvar alterações';
    document.getElementById('cancel-finance-category-edit').hidden = false;
    document.getElementById('category-name').focus();
  }

  function resetFinanceCategoryForm() {
    state.editingFinanceCategoryId = null;
    document.getElementById('finance-category-form').reset();
    document.getElementById('category-budget-group-wrap').hidden = false;
    document.getElementById('save-finance-category').textContent = 'Adicionar categoria/subcategoria';
    document.getElementById('cancel-finance-category-edit').hidden = true;
  }

  async function removeFinanceCategory(item) {
    if (!window.confirm(`Remover "${item.category} · ${item.subcategory}" das opções futuras? Lançamentos já salvos preservam o texto.`)) return;
    const { error } = await supabase.from('finance_categories')
      .delete()
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not remove finance category:', error.message);
      showToast('Não foi possível remover a categoria.');
      return;
    }
    await loadHouseholdData();
  }

  async function prepareHouseholdImport(event) {
    event.preventDefault();
    const file = document.getElementById('household-import-json').files?.[0];
    const preview = document.getElementById('household-import-preview');
    preview.hidden = true;
    state.pendingHouseholdImport = null;
    document.getElementById('confirm-household-import').disabled = true;
    if (!file || file.size > 2 * 1024 * 1024) {
      setMessage('household-import-message', 'Selecione um JSON válido de até 2 MB.');
      return;
    }

    try {
      const payload = JSON.parse(await file.text());
      validateHouseholdImportPayload(payload);
      state.pendingHouseholdImport = payload;
      renderHouseholdImportPreview(payload);
      document.getElementById('confirm-household-import').disabled = false;
      preview.hidden = false;
      setMessage('household-import-message', 'Confira todos os itens antes de confirmar.');
    } catch (error) {
      console.error('Could not prepare household setup import:', error.message);
      setMessage('household-import-message', error.message || 'Não foi possível ler esse arquivo JSON.');
    }
  }

  function validateHouseholdImportPayload(payload) {
    const validArray = (key, max) => Array.isArray(payload?.[key]) && payload[key].length <= max;
    if (payload?.version !== 1
      || typeof payload.source_name !== 'string'
      || !payload.source_name.trim()
      || payload.source_name.length > 160
      || !/^[a-f0-9]{64}$/.test(payload.source_fingerprint ?? '')
      || !validArray('categories', 300)
      || !validArray('recurring_items', 200)
      || !validArray('budget_targets', 100)
      || !validArray('allocation_notes', 100)
      || !validArray('excluded_invoice_items', 100)) {
      throw new Error('Formato de arquivo incompatível. Gere o JSON novamente pelo conversor incluído no projeto.');
    }
    const validAmount = amount => amount == null
      || (Number.isSafeInteger(amount) && amount > 0);
    for (const item of payload.categories) {
      if (!['income', 'expense'].includes(item.transaction_type)
        || typeof item.category !== 'string' || !item.category.trim() || item.category.length > 60
        || typeof item.subcategory !== 'string' || !item.subcategory.trim() || item.subcategory.length > 60
        || (item.budget_group != null
          && !['fixed', 'variable', 'leisure', 'emergency'].includes(item.budget_group))
        || (item.transaction_type === 'income' && item.budget_group != null)) {
        throw new Error('O arquivo contém uma categoria ou subcategoria inválida.');
      }
    }
    for (const item of payload.recurring_items) {
      if (typeof item.title !== 'string'
        || !item.title.trim() || item.title.length > 120
        || typeof item.category !== 'string'
        || !item.category.trim() || item.category.length > 40
        || typeof item.subcategory !== 'string'
        || !item.subcategory.trim() || item.subcategory.length > 60
        || !['income', 'expense'].includes(item.transaction_type)
        || !validAmount(item.amount_cents)
        || (item.transaction_type === 'income' && item.budget_group != null)
        || !['monthly', 'yearly'].includes(item.frequency)
        || !Number.isInteger(item.day_of_month) || item.day_of_month < 1 || item.day_of_month > 31
        || (item.frequency === 'monthly' && item.month_of_year != null)
        || (item.frequency === 'yearly'
          && (!Number.isInteger(item.month_of_year) || item.month_of_year < 1 || item.month_of_year > 12))) {
        throw new Error('O arquivo contém uma receita ou despesa com dados inválidos.');
      }
    }
    for (const target of payload.budget_targets) {
      if (typeof target.label !== 'string'
        || !target.label.trim() || target.label.length > 100
        || !['monthly_limit', 'daily_limit', 'leisure_limit', 'card_limit',
          'monthly_reserve_target', 'emergency_fund_goal'].includes(target.target_type)
        || !validAmount(target.amount_cents)
        || (target.target_type === 'card_limit'
          && (typeof target.related_card_label !== 'string' || !target.related_card_label.trim()))
        || (target.target_type !== 'card_limit' && target.related_card_label != null)) {
        throw new Error('O arquivo contém um limite ou objetivo com dados inválidos.');
      }
    }
    if (payload.allocation_notes.some(item =>
      typeof item.title !== 'string' || typeof item.description !== 'string'
      || !validAmount(item.amount_cents))) {
      throw new Error('O arquivo contém uma observação da reserva inválida.');
    }
    if (payload.excluded_invoice_items.some(item => typeof item !== 'string')) {
      throw new Error('O arquivo contém uma descrição inválida de fatura.');
    }
  }

  function renderHouseholdImportPreview(payload) {
    const pendingValues = payload.recurring_items.filter(item => item.amount_cents == null).length
      + payload.budget_targets.filter(item => item.amount_cents == null).length;
    const incomeCount = payload.recurring_items.filter(item => item.transaction_type === 'income').length;
    const expenseCount = payload.recurring_items.filter(item => item.transaction_type === 'expense').length;
    document.getElementById('household-import-summary').textContent =
      `${payload.source_name} · ${incomeCount} receitas mensais · ${expenseCount} despesas mensais · `
      + `${payload.categories.length} categorias/subcategorias · ${payload.budget_targets.length} limites/metas · `
      + `${pendingValues} valores pendentes. O conteúdo financeiro permanece nesta prévia até sua confirmação.`;

    const container = document.getElementById('household-import-rows');
    container.replaceChildren();
    const addSection = (title, entries) => {
      const heading = document.createElement('div');
      heading.className = 'section-title';
      heading.textContent = title;
      container.append(heading);
      for (const text of entries) {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.textContent = text;
        container.append(row);
      }
    };
    addSection('Receitas e despesas recorrentes', payload.recurring_items.map(item =>
      `${item.transaction_type === 'income' ? 'Receita' : 'Despesa'} · ${item.title} · `
      + `${item.category} / ${item.subcategory} · `
      + (item.amount_cents == null ? 'valor pendente' : formatMoney(item.amount_cents))));
    addSection('Categorias e subcategorias', payload.categories.map(item =>
      `${item.transaction_type === 'income' ? 'Receita' : 'Despesa'} · ${item.category} / ${item.subcategory}`));
    addSection('Limites e metas', payload.budget_targets.map(item =>
      `${item.label} · ${item.amount_cents == null ? 'valor pendente' : formatMoney(item.amount_cents)}`
      + (item.related_card_label ? ` · associar ao cartão de ${item.related_card_label}` : '')));
    if (payload.allocation_notes.length) {
      addSection('Observações da reserva', payload.allocation_notes.map(item =>
        `${item.title} · ${item.amount_cents == null ? 'valor pendente' : formatMoney(item.amount_cents)} · ${item.description}`));
    }
    if (payload.excluded_invoice_items.length) {
      addSection('Pagamentos de fatura que não serão lançados como despesa', payload.excluded_invoice_items);
    }
  }

  async function confirmHouseholdImport() {
    const payload = state.pendingHouseholdImport;
    if (!payload) return;
    const button = document.getElementById('confirm-household-import');
    button.disabled = true;
    setMessage('household-import-message', 'Enviando após sua confirmação...');
    const { data, error } = await supabase.rpc('apply_household_setup_import', {
      import_payload: {
        ...payload,
        household_id: state.membership.household_id
      }
    });
    if (error) {
      console.error('Could not apply household setup import:', error.message);
      setMessage('household-import-message',
        error.message.includes('já foi importado')
          ? 'Esta planilha já foi importada para a casa.'
          : 'Não foi possível importar. Confira se as duas migrações financeiras foram aplicadas.');
      button.disabled = false;
      return;
    }
    state.pendingHouseholdImport = null;
    document.getElementById('household-import-preview').hidden = true;
    document.getElementById('household-setup-import-form').reset();
    setMessage('household-import-message',
      `Importação concluída: ${data.categories} categorias, ${data.recurring_items} itens recorrentes e ${data.budget_targets} limites/metas.`);
    await loadHouseholdData();
  }

  function renderBudgetTargets() {
    const container = document.getElementById('budget-target-list');
    container.replaceChildren();
    if (!state.budgetTargets.length) {
      appendEmptyState(container, 'Nenhum limite ou meta cadastrado.');
      return;
    }
    for (const target of state.budgetTargets) {
      const row = document.createElement('div');
      row.className = 'list-item';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = target.label;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      const cardNote = target.related_card_label ? ` · associar cartão: ${target.related_card_label}` : '';
      subtitle.textContent = target.amount_cents
        ? `${formatMoney(Number(target.amount_cents))}${cardNote}`
        : `Valor pendente${cardNote}`;
      info.append(title, subtitle);
      const edit = document.createElement('button');
      edit.className = 'remove-member';
      edit.type = 'button';
      edit.textContent = 'Editar';
      edit.addEventListener('click', () => {
        state.editingBudgetTargetId = target.id;
        document.getElementById('budget-target-type').value = target.target_type;
        document.getElementById('budget-target-label').value = target.label;
        document.getElementById('budget-target-amount').value =
          target.amount_cents == null ? '' : (Number(target.amount_cents) / 100).toFixed(2).replace('.', ',');
        updateBudgetTargetCardField();
        document.getElementById('budget-target-card').value = target.credit_card_id ?? '';
        document.getElementById('save-budget-target').textContent = 'Salvar alterações';
        document.getElementById('cancel-budget-target-edit').hidden = false;
        document.getElementById('budget-target-label').focus();
      });
      const remove = document.createElement('button');
      remove.className = 'remove-member';
      remove.type = 'button';
      remove.textContent = 'Remover';
      remove.addEventListener('click', () => removeBudgetTarget(target));
      row.append(info, edit, remove);
      container.append(row);
    }
  }

  async function saveBudgetTarget(event) {
    event.preventDefault();
    const targetType = document.getElementById('budget-target-type').value;
    const label = document.getElementById('budget-target-label').value.trim();
    const amountValue = document.getElementById('budget-target-amount').value.trim();
    const amount = amountValue ? parseAmount(amountValue) : null;
    const creditCardId = targetType === 'card_limit'
      ? document.getElementById('budget-target-card').value
      : null;
    const editingTarget = state.budgetTargets.find(item => item.id === state.editingBudgetTargetId);
    if (!label || (amount !== null && (!Number.isSafeInteger(amount) || amount <= 0))
      || (amount === null && (!editingTarget || editingTarget.amount_cents != null))) {
      setMessage('budget-target-message', 'Informe um nome e um valor maior que zero.');
      return;
    }
    if (targetType === 'card_limit' && !creditCardId) {
      setMessage('budget-target-message', 'Selecione o cartão deste limite.');
      return;
    }
    const payload = {
      target_type: targetType,
      label,
      amount_cents: amount,
      credit_card_id: creditCardId,
      related_card_label: null
    };
    const query = editingTarget
      ? supabase.from('budget_targets').update(payload).eq('id', editingTarget.id)
          .eq('household_id', state.membership.household_id)
      : supabase.from('budget_targets').insert({
          household_id: state.membership.household_id,
          ...payload,
          created_by: state.user.id
        });
    const { error } = await query;
    if (error) {
      console.error('Could not save budget target:', error.message);
      setMessage('budget-target-message', 'Não foi possível salvar o limite ou objetivo.');
      return;
    }
    resetBudgetTargetForm();
    setMessage('budget-target-message', 'Meta/limite salvo.');
    await loadHouseholdData();
  }

  function resetBudgetTargetForm() {
    state.editingBudgetTargetId = null;
    document.getElementById('budget-target-form').reset();
    document.getElementById('save-budget-target').textContent = 'Salvar meta/limite';
    document.getElementById('cancel-budget-target-edit').hidden = true;
    updateBudgetTargetCardField();
  }

  async function removeBudgetTarget(target) {
    if (!window.confirm(`Remover a meta/limite "${target.label}"?`)) return;
    const { error } = await supabase.from('budget_targets').delete()
      .eq('id', target.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not remove budget target:', error.message);
      showToast('Não foi possível remover a meta/limite.');
      return;
    }
    await loadHouseholdData();
  }

  function updateBudgetTargetCardField() {
    const isCardLimit = document.getElementById('budget-target-type').value === 'card_limit';
    const wrap = document.getElementById('budget-target-card-wrap');
    const select = document.getElementById('budget-target-card');
    const previous = select.value;
    wrap.hidden = !isCardLimit;
    select.replaceChildren(new Option('Selecione o cartão', ''));
    for (const card of state.creditCards.filter(item => item.active)) {
      select.add(new Option(card.label, card.id));
    }
    select.value = state.creditCards.some(card => card.id === previous && card.active) ? previous : '';
  }

  async function saveReserveMovement(event) {
    event.preventDefault();
    const direction = document.getElementById('reserve-direction').value;
    const amount = parseAmount(document.getElementById('reserve-amount').value);
    const description = document.getElementById('reserve-description').value.trim();
    const currentBalance = reserveBalance();
    if (!description || !Number.isSafeInteger(amount) || amount <= 0) {
      setMessage('reserve-message', 'Informe uma descrição e um valor maior que zero.');
      return;
    }
    if (direction === 'withdrawal' && amount > currentBalance) {
      setMessage('reserve-message', 'O valor de retirada não pode exceder o saldo da reserva.');
      return;
    }
    const { error } = await supabase.from('reserve_movements').insert({
      household_id: state.membership.household_id,
      created_by: state.user.id,
      direction,
      amount_cents: amount,
      description,
      movement_date: localDate(new Date())
    });
    if (error) {
      console.error('Could not save reserve movement:', error.message);
      setMessage('reserve-message', 'Não foi possível registrar o movimento da reserva.');
      return;
    }
    document.getElementById('reserve-amount').value = '';
    document.getElementById('reserve-description').value = '';
    setMessage('reserve-message', 'Movimento registrado separadamente das despesas.');
    await loadHouseholdData();
  }

  function reserveBalance() {
    return state.reserveMovements.reduce((balance, movement) =>
      balance + (movement.direction === 'deposit' ? 1 : -1) * Number(movement.amount_cents), 0);
  }

  function appendEmptyState(container, message) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = message;
    container.append(empty);
  }

  function budgetGroupLabel(group) {
    return ({
      fixed: 'Fixo mensal',
      variable: 'Variável do dia a dia',
      leisure: 'Lazer',
      emergency: 'Emergencial'
    })[group] ?? 'Sem grupo de orçamento';
  }

  async function saveCreditCard(event) {
    event.preventDefault();
    const label = document.getElementById('card-label').value.trim();
    const provider = document.getElementById('card-provider').value.trim();
    const titularName = document.getElementById('card-titular').value.trim() || label;
    const limitValue = document.getElementById('card-credit-limit').value.trim();
    const limit = limitValue ? parseAmount(limitValue) : null;
    if (!label || !provider || (limitValue && (!Number.isSafeInteger(limit) || limit <= 0))) {
      setMessage('credit-card-message', 'Informe nome e operadora do cartão e, se quiser, o limite do cartão.');
      return;
    }

    const payload = {
      household_id: state.membership.household_id,
      label,
      provider,
      titular_name: titularName,
      cardholder_name: titularName,
      card_role: 'titular',
      statement_scope: 'individual',
      last_four: null,
      credit_limit_cents: limit,
      created_by: state.user.id
    };

    const isEditing = Boolean(state.editingCreditCardId);
    const { error } = isEditing
      ? await supabase.from('credit_cards').update(payload).eq('id', state.editingCreditCardId).eq('household_id', state.membership.household_id)
      : await supabase.from('credit_cards').insert(payload);

    if (error) {
      console.error('Could not save credit card:', error.message);
      setMessage('credit-card-message', isEditing
        ? 'Não foi possível atualizar o cartão. Confira os dados e tente novamente.'
        : 'Não foi possível cadastrar. Verifique se já existe um cartão com esse nome.');
      return;
    }
    event.target.reset();
    resetCreditCardForm();
    setMessage('credit-card-message', isEditing ? 'Cartão atualizado.' : 'Cartão cadastrado.');
    await loadHouseholdData();
  }

  function resetCreditCardForm() {
    state.editingCreditCardId = null;
    document.getElementById('credit-card-form').reset();
    document.getElementById('save-credit-card').textContent = 'Cadastrar cartão';
    document.getElementById('cancel-credit-card-edit').hidden = true;
    updateCardScopeFields();
  }

  function populateCreditCardForm(card) {
    state.editingCreditCardId = card.id;
    document.getElementById('card-label').value = card.label;
    document.getElementById('card-provider').value = card.provider;
    document.getElementById('card-titular').value = card.titular_name || '';
    document.getElementById('card-credit-limit').value = card.credit_limit_cents
      ? (Number(card.credit_limit_cents) / 100).toFixed(2).replace('.', ',')
      : '';
    updateCardScopeFields();
    document.getElementById('save-credit-card').textContent = 'Salvar alterações';
    document.getElementById('cancel-credit-card-edit').hidden = false;
    document.getElementById('card-label').focus();
    window.scrollTo({ top: document.getElementById('credit-card-section').offsetTop - 18, behavior: 'smooth' });
  }

  function renderCreditCards() {
    const container = document.getElementById('credit-card-list');
    const importSelect = document.getElementById('import-card');
    const entrySelect = document.getElementById('entry-credit-card');
    const previousImport = importSelect.value;
    const previousEntry = entrySelect.value;
    container.replaceChildren();
    importSelect.replaceChildren(new Option('Selecione o cartão', ''));
    entrySelect.replaceChildren(new Option('Selecione o cartão', ''));
    const activeCards = state.creditCards.filter(card => card.active);
    for (const card of activeCards) {
      importSelect.add(new Option(
        `${card.label}${card.statement_scope === 'shared' ? ' · fatura compartilhada' : ''}`,
        card.id
      ));
      entrySelect.add(new Option(card.label, card.id));
      const row = document.createElement('div');
      row.className = 'list-item';
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '8px';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = card.label;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      const ownership = card.statement_scope === 'shared'
        ? 'Cartão geral'
        : (card.titular_name ? `Titular: ${card.titular_name}` : 'Cartão individual');
      const limit = card.credit_limit_cents
        ? ` · limite ${formatMoney(Number(card.credit_limit_cents))}`
        : '';
      subtitle.textContent = `${card.provider} · ${ownership}${limit}`;
      info.append(title, subtitle);
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.flexWrap = 'wrap';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'secondary-btn';
      editButton.textContent = 'Editar';
      editButton.addEventListener('click', () => populateCreditCardForm(card));
      const importButton = document.createElement('button');
      importButton.type = 'button';
      importButton.className = 'secondary-btn';
      importButton.textContent = 'Lançar fatura';
      importButton.addEventListener('click', () => {
        document.getElementById('import-card').value = card.id;
        document.getElementById('statement-due-date').value ||= localDate(new Date());
        document.getElementById('card-import-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('statement-csv').focus();
      });
      actions.append(editButton, importButton);
      row.append(info, actions);
      container.append(row);
    }
    importSelect.value = activeCards.some(card => card.id === previousImport) ? previousImport : '';
    entrySelect.value = activeCards.some(card => card.id === previousEntry) ? previousEntry : '';
    if (!activeCards.length) appendEmptyState(container, 'Nenhum cartão cadastrado.');
    updatePaymentFields();
    updateBudgetTargetCardField();
  }

  function updateCardScopeFields() {
    const form = document.getElementById('credit-card-form');
    if (!form) return;
    const scopeField = document.getElementById('card-statement-scope');
    if (scopeField) scopeField.hidden = true;
    const oldFields = ['card-holder-wrap', 'card-role-wrap', 'card-last-four-wrap'];
    oldFields.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.hidden = true;
    });
  }

  async function suggestDueDateFromFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const match = file.name.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (match) {
      const parsed = parseIsoDate(match[1]);
      if (parsed) document.getElementById('statement-due-date').value = match[1];
    }
  }

  async function prepareCardImport(event) {
    event.preventDefault();
    const file = document.getElementById('statement-csv').files?.[0];
    const creditCardId = document.getElementById('import-card').value;
    const dueDate = document.getElementById('statement-due-date').value;
    const preview = document.getElementById('card-import-preview');
    preview.hidden = true;
    state.pendingCardImport = null;
    document.getElementById('confirm-card-import').disabled = true;
    if (!file || !creditCardId || !parseIsoDate(dueDate)) {
      setMessage('card-import-message', 'Selecione o cartão, informe o vencimento e escolha um CSV.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage('card-import-message', 'O CSV excede o limite de 2 MB.');
      return;
    }

    setMessage('card-import-message', 'Lendo o arquivo localmente e preparando a prévia...');
    try {
      const parsedRows = parseCardCsv(await file.text());
      if (!parsedRows.length) throw new Error('O CSV não contém compras para importar.');
      const rowsWithKeys = await addStatementRowKeys(parsedRows);
      const fingerprint = await sha256(rowsWithKeys.map(row => row.source_key).sort().join('\n'));
      const { data: existingStatement, error: statementError } = await supabase
        .from('card_statements')
        .select('id, status, source_fingerprint')
        .eq('household_id', state.membership.household_id)
        .eq('credit_card_id', creditCardId)
        .eq('due_date', dueDate)
        .maybeSingle();
      if (statementError) throw statementError;

      let existingItems = [];
      if (existingStatement) {
        const { data, error } = await supabase
          .from('card_statement_items')
          .select('source_key, cardholder_label, category, subcategory, budget_group')
          .eq('statement_id', existingStatement.id);
        if (error) throw error;
        existingItems = data;
      }
      const categoryBySource = new Map(existingItems.map(item => [item.source_key, item]));
      state.pendingCardImport = {
        creditCardId,
        dueDate,
        fileName: file.name,
        fingerprint,
        existingStatement,
        rows: rowsWithKeys.map(row => {
          const existingItem = categoryBySource.get(row.source_key);
          return {
            ...row,
            cardholder_label: row.cardholder_label || existingItem?.cardholder_label || null,
            ...(existingItem && {
              category: existingItem.category,
              subcategory: existingItem.subcategory,
              budget_group: existingItem.budget_group
            })
          };
        })
      };
      renderCardImportPreview();
      setMessage('card-import-message', '');
      preview.hidden = false;
    } catch (error) {
      console.error('Could not prepare card statement import:', error);
      setMessage('card-import-message', error.message || 'Não foi possível ler esse CSV.');
    }
  }

  function parseCardCsv(text) {
    const records = parseCsvRecords(text.replace(/^\uFEFF/, ''));
    if (records.length < 2) throw new Error('O CSV deve ter cabeçalho e pelo menos uma linha.');
    const headers = records[0].map(header => normalizeCsvHeader(header));
    const dateIndex = headers.indexOf('date');
    const titleIndex = headers.indexOf('title');
    const amountIndex = headers.indexOf('amount');
    const cardholderIndex = headers.findIndex(header =>
      ['cardholder', 'card_holder', 'holder', 'card', 'card_name', 'cartao', 'titular'].includes(header));
    if (dateIndex < 0 || titleIndex < 0 || amountIndex < 0) {
      throw new Error('Formato não reconhecido. O CSV precisa conter date, title e amount.');
    }
    return records.slice(1).filter(row => row.some(value => value.trim())).map((row, index) => {
      const purchaseDate = parseCsvDate(row[dateIndex] ?? '');
      const title = (row[titleIndex] ?? '').trim();
      const amount = parseCsvAmount(row[amountIndex] ?? '');
      if (!purchaseDate || !title || !Number.isSafeInteger(amount) || amount === 0) {
        throw new Error(`A linha ${index + 2} tem data, descrição ou valor inválido.`);
      }
      const installment = title.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
      const installmentNumber = installment ? Number(installment[1]) : null;
      const installmentTotal = installment ? Number(installment[2]) : null;
      if (installment && (
        installmentNumber < 1
        || installmentTotal < 2
        || installmentNumber > installmentTotal
        || installmentTotal > 60
      )) {
        throw new Error(`A linha ${index + 2} contém um marcador de parcela inválido.`);
      }
      return {
        purchase_date: purchaseDate,
        title,
        cardholder_label: cardholderIndex < 0 ? '' : (row[cardholderIndex] ?? '').trim().slice(0, 80),
        amount_cents: amount,
        installment_number: installmentNumber,
        installment_total: installmentTotal
      };
    });
  }

  function normalizeCsvHeader(header) {
    return header.trim().toLocaleLowerCase('pt-BR')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
  }

  function parseCsvRecords(text) {
    const records = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"' && field.length === 0) {
        quoted = true;
      } else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        row.push(field);
        if (row.some(value => value.trim())) records.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }
    if (quoted) throw new Error('O CSV termina com um campo entre aspas incompleto.');
    if (field.length || row.length) {
      row.push(field);
      if (row.some(value => value.trim())) records.push(row);
    }
    return records;
  }

  function parseCsvDate(value) {
    const trimmed = value.trim();
    if (/^20\d{2}-\d{2}-\d{2}$/.test(trimmed)) return parseIsoDate(trimmed) ? trimmed : null;
    const match = trimmed.match(/^(\d{2})\/(\d{2})\/(20\d{2})$/);
    if (!match) return null;
    const [, day, month, year] = match;
    const iso = `${year}-${month}-${day}`;
    return parseIsoDate(iso) ? iso : null;
  }

  function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function parseCsvAmount(value) {
    let normalized = value.trim().replace(/[R$\s]/g, '');
    const negativeByParentheses = normalized.startsWith('(') && normalized.endsWith(')');
    if (negativeByParentheses) normalized = normalized.slice(1, -1);
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      const decimal = lastComma > lastDot ? ',' : '.';
      const thousands = decimal === ',' ? /\./g : /,/g;
      normalized = normalized.replace(thousands, '');
      if (decimal === ',') normalized = normalized.replace(',', '.');
    } else if (lastComma >= 0) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    }
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return NaN;
    const amount = Number(normalized);
    return Number.isFinite(amount)
      ? Math.round(Math.abs(amount) * 100) * (negativeByParentheses ? -1 : Math.sign(amount))
      : NaN;
  }

  async function addStatementRowKeys(rows) {
    const occurrences = new Map();
    return Promise.all(rows.map(async row => {
      const normalized = [
        row.purchase_date,
        row.title.normalize('NFKC').trim().toLocaleLowerCase('pt-BR'),
        row.amount_cents,
        row.installment_number ?? '',
        row.installment_total ?? '',
        row.cardholder_label ?? ''
      ].join('|');
      const occurrence = occurrences.get(normalized) ?? 0;
      occurrences.set(normalized, occurrence + 1);
      return { ...row, source_key: await sha256(`${normalized}|${occurrence}`) };
    }));
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function renderCardImportPreview() {
    const pending = state.pendingCardImport;
    if (!pending) return;
    const selectedCard = state.creditCards.find(card => card.id === pending.creditCardId);
    const total = pending.rows.reduce((sum, row) => sum + row.amount_cents, 0);
    document.getElementById('card-import-summary').textContent =
      `${selectedCard?.label ?? 'Cartão'} · vencimento ${formatDate(pending.dueDate)} · ${pending.rows.length} linhas · total ${formatMoney(total)}. Classifique as compras agora ou depois.`;
    const container = document.getElementById('card-import-rows');
    container.replaceChildren();
    for (const item of pending.rows) {
      const row = document.createElement('div');
      row.className = 'list-item';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = item.title;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      const installment = item.installment_number
        ? ` · Parcela ${item.installment_number}/${item.installment_total}`
        : '';
      subtitle.textContent = `${formatDate(item.purchase_date)} · ${formatMoney(item.amount_cents)}${installment}`;
      const cardholder = document.createElement('input');
      cardholder.className = 'form-input';
      cardholder.maxLength = 80;
      cardholder.autocomplete = 'off';
      cardholder.placeholder = 'Pessoa/cartão adicional (opcional)';
      cardholder.value = item.cardholder_label ?? '';
      cardholder.setAttribute('aria-label', `Pessoa que fez a compra: ${item.title}`);
      cardholder.addEventListener('input', () => {
        item.cardholder_label = cardholder.value.trim().slice(0, 80);
      });
      const category = createCategorySelect(item.category, item.subcategory);
      const group = document.createElement('select');
      group.className = 'form-input';
      for (const [value, label] of [
        ['fixed', 'Fixo mensal'],
        ['variable', 'Variável do dia a dia'],
        ['leisure', 'Lazer'],
        ['emergency', 'Emergencial']
      ]) group.add(new Option(label, value));
      group.value = item.budget_group || 'variable';
      category.categorySelect.addEventListener('change', () => {
        fillSubcategorySelect(category.categorySelect.value, category.subcategorySelect);
      });
      category.subcategorySelect.addEventListener('change', () => {
        item.category = category.categorySelect.value || null;
        item.subcategory = category.subcategorySelect.value || null;
      });
      category.categorySelect.addEventListener('change', () => {
        item.category = category.categorySelect.value || null;
        item.subcategory = null;
      });
      group.addEventListener('change', () => { item.budget_group = group.value; });
      info.append(title, subtitle, cardholder, category.categorySelect, category.subcategorySelect, group);
      row.append(info);
      container.append(row);
    }
    document.getElementById('confirm-card-import').disabled = false;
  }

  function createCategorySelect(selectedCategory, selectedSubcategory) {
    const categorySelect = document.createElement('select');
    categorySelect.className = 'form-input';
    categorySelect.add(new Option('Sem categoria ainda', ''));
    const expenseCategories = [...new Set(state.financeCategories
      .filter(item => item.transaction_type === 'expense')
      .map(item => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const category of expenseCategories) categorySelect.add(new Option(category, category));
    categorySelect.value = selectedCategory || '';

    const subcategorySelect = document.createElement('select');
    subcategorySelect.className = 'form-input';
    fillSubcategorySelect(categorySelect.value, subcategorySelect);
    subcategorySelect.value = selectedSubcategory || '';
    return { categorySelect, subcategorySelect };
  }

  function fillSubcategorySelect(category, select) {
    const current = select.value;
    select.replaceChildren(new Option('Sem subcategoria ainda', ''));
    for (const item of state.financeCategories.filter(categoryItem =>
      categoryItem.transaction_type === 'expense' && categoryItem.category === category)) {
      select.add(new Option(item.subcategory, item.subcategory));
    }
    select.value = [...select.options].some(option => option.value === current) ? current : '';
  }

  async function confirmCardImport() {
    const pending = state.pendingCardImport;
    if (!pending || !pending.rows.length) return;
    const existingStatement = pending.existingStatement;
    if (existingStatement?.status === 'paid'
      && existingStatement.source_fingerprint !== pending.fingerprint
      && !window.confirm('Esta fatura já está marcada como paga. Atualizar as linhas sem reabrir o status de pagamento?')) {
      return;
    }
    if (!window.confirm(
      `Confirmar a atualização da fatura de ${formatDate(pending.dueDate)}? Os dados enviados substituirão as linhas desta fatura; outras faturas não serão alteradas.`
    )) return;

    const confirmButton = document.getElementById('confirm-card-import');
    confirmButton.disabled = true;
    setMessage('card-import-message', 'Salvando a fatura autenticada no Supabase...');
    const { data: statement, error: statementError } = await supabase
      .from('card_statements')
      .upsert({
        household_id: state.membership.household_id,
        credit_card_id: pending.creditCardId,
        due_date: pending.dueDate,
        source_filename: pending.fileName,
        source_fingerprint: pending.fingerprint,
        imported_by: state.user.id,
        imported_at: new Date().toISOString()
      }, { onConflict: 'credit_card_id,due_date' })
      .select('id')
      .single();
    if (statementError) {
      console.error('Could not save card statement:', statementError.message);
      setMessage('card-import-message', 'Não foi possível salvar a fatura. Confira se a migração foi aplicada.');
      confirmButton.disabled = false;
      return;
    }

    const statementItems = pending.rows.map(item => ({
      source_key: item.source_key,
      purchase_date: item.purchase_date,
      title: item.title,
      cardholder_label: item.cardholder_label || null,
      amount_cents: item.amount_cents,
      installment_number: item.installment_number,
      installment_total: item.installment_total,
      category: item.category || null,
      subcategory: item.subcategory || null,
      budget_group: item.category ? item.budget_group || 'variable' : null
    }));
    const { error: itemsError } = await supabase.rpc('replace_card_statement_items', {
      target_statement_id: statement.id,
      statement_items: statementItems
    });
    if (itemsError) {
      console.error('Could not reconcile card statement lines:', itemsError.message);
      setMessage('A fatura foi registrada, mas as linhas não foram reconciliadas. Não tente importar outro mês; recarregue e envie novamente o mesmo arquivo.');
      confirmButton.disabled = false;
      return;
    }
    state.pendingCardImport = null;
    document.getElementById('card-import-preview').hidden = true;
    document.getElementById('card-import-form').reset();
    setMessage('card-import-message', 'Fatura atualizada. As parcelas futuras foram recalculadas.');
    await loadHouseholdData();
  }

  function renderCardStatements() {
    const container = document.getElementById('card-statement-list');
    container.replaceChildren();
    if (!state.cardStatements.length) {
      appendEmptyState(container, 'Nenhuma fatura importada.');
      return;
    }
    for (const statement of state.cardStatements) {
      const card = state.creditCards.find(item => item.id === statement.credit_card_id);
      const items = state.cardStatementItems.filter(item => item.statement_id === statement.id);
      const total = items.reduce((sum, item) => sum + Number(item.amount_cents), 0);
      const row = document.createElement('div');
      row.className = 'list-item';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = `${card?.label ?? 'Cartão'} · ${formatDate(statement.due_date)}`;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      const overdue = statement.status === 'open' && statement.due_date < localDate(new Date());
      subtitle.textContent = `${items.length} compras · ${formatMoney(total)} · ${statement.status === 'paid' ? 'Paga' : overdue ? 'Em aberto — vencida' : 'Em aberto'}`;
      info.append(title, subtitle);
      const action = document.createElement('button');
      action.className = 'remove-member';
      action.type = 'button';
      action.textContent = statement.status === 'paid' ? 'Reabrir' : 'Marcar paga';
      action.addEventListener('click', () => toggleStatementPaid(statement));
      row.append(info, action);
      container.append(row);
      for (const item of items) {
        const detail = document.createElement('div');
        detail.className = 'list-item';
        const detailInfo = document.createElement('div');
        detailInfo.className = 'info';
        const detailTitle = document.createElement('div');
        detailTitle.className = 'title';
        detailTitle.textContent = item.title;
        const detailSubtitle = document.createElement('div');
        detailSubtitle.className = 'subtitle';
        detailSubtitle.textContent = [
          item.cardholder_label,
          item.category ? `${item.category} · ${item.subcategory}` : 'Sem categoria',
          item.installment_number ? `${item.installment_number}/${item.installment_total}` : null
        ].filter(Boolean).join(' · ');
        const category = createCategorySelect(item.category, item.subcategory);
        const group = document.createElement('select');
        group.className = 'form-input';
        for (const [value, label] of [
          ['fixed', 'Fixo mensal'],
          ['variable', 'Variável do dia a dia'],
          ['leisure', 'Lazer'],
          ['emergency', 'Emergencial']
        ]) group.add(new Option(label, value));
        group.value = item.budget_group || 'variable';
        category.categorySelect.addEventListener('change', () => {
          fillSubcategorySelect(category.categorySelect.value, category.subcategorySelect);
        });
        category.subcategorySelect.addEventListener('change', () => {
          if (category.categorySelect.value && category.subcategorySelect.value) {
            updateCardItemClassification(item, category.categorySelect.value, category.subcategorySelect.value, group.value);
          }
        });
        group.addEventListener('change', () => {
          if (item.category && item.subcategory) {
            updateCardItemClassification(item, item.category, item.subcategory, group.value);
          }
        });
        category.categorySelect.addEventListener('change', () => {
          item.category = category.categorySelect.value || null;
          item.subcategory = null;
        });
        category.subcategorySelect.addEventListener('change', () => {
          item.category = category.categorySelect.value || null;
          item.subcategory = category.subcategorySelect.value || null;
        });
        detailInfo.append(detailTitle, detailSubtitle, category.categorySelect, category.subcategorySelect, group);
        detail.append(detailInfo);
        container.append(detail);
      }
    }
  }

  async function updateCardItemClassification(item, category, subcategory, budgetGroup) {
    const { error } = await supabase.from('card_statement_items')
      .update({ category, subcategory, budget_group: budgetGroup })
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not classify card statement item:', error.message);
      showToast('Não foi possível salvar a categoria desta compra.');
      return;
    }
    await loadHouseholdData();
  }

  async function toggleStatementPaid(statement) {
    const nextStatus = statement.status === 'paid' ? 'open' : 'paid';
    const { error } = await supabase.from('card_statements')
      .update({
        status: nextStatus,
        paid_at: nextStatus === 'paid' ? new Date().toISOString() : null
      })
      .eq('id', statement.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not change card statement status:', error.message);
      showToast('Não foi possível atualizar o status da fatura.');
      return;
    }
    await loadHouseholdData();
  }

  function renderCardInstallmentForecast() {
    const container = document.getElementById('card-installment-forecast');
    container.replaceChildren();
    const latestStatements = new Map();
    for (const statement of [...state.cardStatements].sort((a, b) =>
      b.due_date.localeCompare(a.due_date))) {
      if (!latestStatements.has(statement.credit_card_id)) {
        latestStatements.set(statement.credit_card_id, statement);
      }
    }
    const forecast = [];
    for (const statement of latestStatements.values()) {
      const card = state.creditCards.find(item => item.id === statement.credit_card_id);
      const due = new Date(`${statement.due_date}T12:00:00`);
      for (const item of state.cardStatementItems.filter(entry =>
        entry.statement_id === statement.id
        && entry.installment_number
        && entry.installment_total > entry.installment_number)) {
        for (let number = item.installment_number + 1; number <= item.installment_total; number += 1) {
          const forecastDate = new Date(due.getFullYear(), due.getMonth() + number - item.installment_number, due.getDate());
          forecast.push({
            cardLabel: card?.label ?? 'Cartão',
            title: item.title,
            amount: Number(item.amount_cents),
            installment: `${number}/${item.installment_total}`,
            month: `${forecastDate.getFullYear()}-${String(forecastDate.getMonth() + 1).padStart(2, '0')}`,
            dueLabel: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(forecastDate)
          });
        }
      }
    }
    forecast.sort((a, b) => a.month.localeCompare(b.month) || a.cardLabel.localeCompare(b.cardLabel));
    if (!forecast.length) {
      appendEmptyState(container, 'Não há parcelas futuras detectadas nas faturas mais recentes.');
      return;
    }
    for (const item of forecast) {
      const row = document.createElement('div');
      row.className = 'list-item';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = `${item.dueLabel} · ${item.cardLabel}`;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = `${item.title} · parcela ${item.installment}`;
      const amount = document.createElement('div');
      amount.className = 'amount expense';
      amount.textContent = formatMoney(item.amount);
      info.append(title, subtitle);
      row.append(info, amount);
      container.append(row);
    }
  }

  async function saveEntry() {
    const amount = parseAmount(document.getElementById('transaction-amount').value);
    const title = document.getElementById('transaction-title').value.trim();
    const selectedFrequency = document.querySelector('.freq-btn.active')?.dataset.freq ?? 'once';
    const selectedCategory = document.getElementById('entry-category').value;
    const selectedSubcategory = document.getElementById('entry-subcategory').value;
    const transactionType = document.getElementById('btn-expense').classList.contains('active')
      ? 'expense'
      : 'income';
    const budgetGroup = transactionType === 'expense'
      ? document.getElementById('entry-budget-group').value
      : null;
    const paymentMethod = transactionType === 'expense'
      ? document.getElementById('payment-method').value
      : 'other';
    const creditCardId = paymentMethod === 'credit'
      ? document.getElementById('entry-credit-card').value || null
      : null;

    if (!state.user || !state.membership) {
      showToast('Entre na sua conta antes de cadastrar.');
      return;
    }
    if (!title || !selectedCategory || !selectedSubcategory
      || !Number.isSafeInteger(amount) || amount <= 0
      || (paymentMethod === 'credit' && !creditCardId)) {
      showToast('Informe a categoria, subcategoria, cartão (se aplicável) e um valor válido.');
      return;
    }

    const payload = {
      household_id: state.membership.household_id,
      created_by: state.user.id,
      title,
      transaction_type: transactionType,
      category: selectedCategory,
      subcategory: selectedSubcategory,
      budget_group: budgetGroup,
      payment_method: paymentMethod,
      credit_card_id: creditCardId,
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
    document.getElementById('entry-category').value = '';
    document.getElementById('entry-subcategory').value = '';
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
        const classification = `${item.category} · ${item.subcategory}`;
        subtitle.textContent = `${schedule} · ${classification} · ${
          item.amount_cents == null ? 'Valor pendente' : formatMoney(Number(item.amount_cents))
        }`;
        info.append(title, subtitle);
        if (item.amount_cents == null) {
          const amountInput = document.createElement('input');
          amountInput.className = 'form-input';
          amountInput.inputMode = 'decimal';
          amountInput.placeholder = 'Preencha o valor mensal';
          amountInput.setAttribute('aria-label', `Valor de ${item.title}`);
          const saveAmount = document.createElement('button');
          saveAmount.className = 'remove-member';
          saveAmount.type = 'button';
          saveAmount.textContent = 'Salvar valor';
          saveAmount.addEventListener('click', () => fillRecurringAmount(item, amountInput.value));
          info.append(amountInput, saveAmount);
        }
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

  async function fillRecurringAmount(item, rawAmount) {
    const amount = parseAmount(rawAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast('Informe um valor maior que zero.');
      return;
    }
    const { error } = await supabase.from('recurring_items')
      .update({ amount_cents: amount })
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not set recurring item amount:', error.message);
      showToast('Não foi possível salvar o valor.');
      return;
    }
    await loadHouseholdData();
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

  function renderMonthlyControl() {
    const monthStart = state.controlMonthKey;
    if (!monthStart) return;
    const monthKey = monthStart.slice(0, 7);
    const monthDate = new Date(`${monthStart}T12:00:00`);
    const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(monthDate);
    document.getElementById('control-month-title').textContent = monthLabel;
    document.getElementById('control-month-label').textContent = monthLabel;

    const currentRows = state.monthlyControlItems.filter(item => item.month_start === monthStart);
    const groups = {
      income: { list: 'control-income-list', total: 'control-income-total', rows: [] },
      fixed: { list: 'control-fixed-list', total: 'control-fixed-total', rows: [] },
      variable: { list: 'control-variable-list', total: 'control-variable-total', rows: [] },
      additional: { list: 'control-additional-list', total: 'control-additional-total', rows: [] }
    };
    for (const item of currentRows) groups[item.control_group]?.rows.push(item);

    for (const [groupName, group] of Object.entries(groups)) {
      const list = document.getElementById(group.list);
      list.replaceChildren();
      let total = 0;
      if (!group.rows.length) {
        appendEmptyState(list, 'Nenhum item neste grupo. Adicione acima ou traga os nomes do mês anterior.');
      }
      for (const item of group.rows) {
        total += Number(item.amount_cents ?? 0);
        const row = document.createElement('div');
        row.className = 'control-row';
        const name = document.createElement('input');
        name.className = 'control-amount';
        name.style.textAlign = 'left';
        name.value = item.item_name;
        name.maxLength = 120;
        name.setAttribute('aria-label', `Nome do item ${item.item_name}`);
        const amount = document.createElement('input');
        amount.className = 'control-amount';
        amount.inputMode = 'decimal';
        amount.placeholder = 'R$ 0,00';
        amount.value = item.amount_cents == null
          ? ''
          : (Number(item.amount_cents) / 100).toFixed(2).replace('.', ',');
        amount.setAttribute('aria-label', `Valor mensal de ${item.item_name}`);
        const actions = document.createElement('div');
        actions.className = 'control-row-actions';
        const save = document.createElement('button');
        save.className = 'save';
        save.type = 'button';
        save.textContent = 'Salvar';
        save.addEventListener('click', () => updateMonthlyControlItem(item, name.value, amount.value, save));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remover ${item.item_name}`);
        remove.addEventListener('click', () => deleteMonthlyControlItem(item));
        actions.append(save, remove);
        row.append(name, amount, actions);
        list.append(row);
      }
      document.getElementById(group.total).textContent = formatMoney(total);
    }

    const cardList = document.getElementById('control-cards-list');
    cardList.replaceChildren();
    const statements = state.cardStatements.filter(statement => statement.due_date.startsWith(monthKey));
    let cardTotal = 0;
    if (!statements.length) {
      appendEmptyState(cardList, 'As faturas importadas deste mês aparecerão aqui.');
    }
    for (const statement of statements) {
      const card = state.creditCards.find(item => item.id === statement.credit_card_id);
      const items = state.cardStatementItems.filter(item => item.statement_id === statement.id);
      const total = items.reduce((sum, item) => sum + Number(item.amount_cents), 0);
      cardTotal += total;
      const row = document.createElement('div');
      row.className = 'control-card-row';
      const info = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = card?.label ?? 'Cartão';
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = `${items.length} compras · ${formatDate(statement.due_date)} · ${statement.status === 'paid' ? 'Paga' : 'Em aberto'}`;
      info.append(title, subtitle);
      const actions = document.createElement('div');
      actions.style.display = 'grid';
      actions.style.justifyItems = 'end';
      actions.style.gap = '6px';
      const amountLabel = document.createElement('strong');
      amountLabel.textContent = formatMoney(total);
      const update = document.createElement('button');
      update.type = 'button';
      update.className = 'secondary-btn';
      update.textContent = 'Atualizar';
      update.addEventListener('click', () => {
        window.showScreen('recurring');
        window.setTimeout(() => {
          document.getElementById('import-card').value = statement.credit_card_id;
          document.getElementById('card-import-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.getElementById('statement-csv').focus();
        }, 50);
      });
      actions.append(amountLabel, update);
      row.append(info, actions);
      cardList.append(row);
    }
    document.getElementById('control-cards-total').textContent = formatMoney(cardTotal);
    const manualIncome = groups.income.rows.reduce((sum, item) => sum + Number(item.amount_cents ?? 0), 0);
    const manualExpenses = ['fixed', 'variable', 'additional'].reduce((sum, key) =>
      sum + groups[key].rows.reduce((groupSum, item) => groupSum + Number(item.amount_cents ?? 0), 0), 0);
    document.getElementById('month-income').textContent = formatMoney(manualIncome);
    document.getElementById('month-expenses').textContent = formatMoney(manualExpenses + cardTotal);
    document.getElementById('month-balance').textContent = formatMoney(manualIncome - manualExpenses - cardTotal);
    document.getElementById('copy-control-items').disabled = currentRows.length > 0;
    document.getElementById('copy-control-items').textContent = currentRows.length
      ? 'Este mês já tem itens cadastrados'
      : 'Trazer os itens do mês anterior';
  }

  async function addMonthlyControlItem(event) {
    event.preventDefault();
    const itemName = document.getElementById('control-item-name').value.trim();
    const controlGroup = document.getElementById('control-item-group').value;
    const rawAmount = document.getElementById('control-item-amount').value.trim();
    const amountCents = rawAmount ? parseAmount(rawAmount) : null;
    if (!itemName || itemName.length > 120
      || !['income', 'fixed', 'variable', 'additional'].includes(controlGroup)
      || (rawAmount && (!Number.isSafeInteger(amountCents) || amountCents < 0))) {
      setMessage('monthly-control-message', 'Informe o nome e um valor válido (ou deixe o valor em branco).');
      return;
    }
    if (state.monthlyControlItems.some(item =>
      item.month_start === state.controlMonthKey
      && item.control_group === controlGroup
      && item.item_name.trim().toLocaleLowerCase('pt-BR') === itemName.toLocaleLowerCase('pt-BR'))) {
      setMessage('monthly-control-message', 'Esse item já existe neste grupo do mês.');
      return;
    }
    const { error } = await supabase.from('monthly_control_items').insert({
      household_id: state.membership.household_id,
      month_start: state.controlMonthKey,
      item_name: itemName,
      transaction_type: controlGroup === 'income' ? 'income' : 'expense',
      control_group: controlGroup,
      amount_cents: amountCents,
      created_by: state.user.id
    });
    if (error) {
      console.error('Could not add monthly control item:', error.message);
      setMessage('monthly-control-message', 'Não foi possível adicionar o item. Confira se o nome já existe.');
      return;
    }
    event.target.reset();
    setMessage('monthly-control-message', '');
    await loadHouseholdData();
  }

  async function updateMonthlyControlItem(item, itemName, rawAmount, button) {
    const normalizedName = itemName.trim();
    const amountCents = rawAmount.trim() ? parseAmount(rawAmount) : null;
    if (!normalizedName || normalizedName.length > 120
      || (rawAmount.trim() && (!Number.isSafeInteger(amountCents) || amountCents < 0))) {
      showToast('Informe um nome e um valor válido para este item.');
      return;
    }
    const duplicate = state.monthlyControlItems.some(existing =>
      existing.id !== item.id
      && existing.month_start === item.month_start
      && existing.control_group === item.control_group
      && existing.item_name.trim().toLocaleLowerCase('pt-BR') === normalizedName.toLocaleLowerCase('pt-BR'));
    if (duplicate) {
      showToast('Já existe outro item com esse nome neste grupo.');
      return;
    }
    button.disabled = true;
    const { error } = await supabase.from('monthly_control_items')
      .update({ item_name: normalizedName, amount_cents: amountCents, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      button.disabled = false;
      console.error('Could not update monthly control item:', error.message);
      showToast('Não foi possível salvar este item.');
      return;
    }
    showToast('Valor mensal salvo.');
    await loadHouseholdData();
  }

  async function deleteMonthlyControlItem(item) {
    if (!window.confirm(`Remover "${item.item_name}" deste mês?`)) return;
    const { error } = await supabase.from('monthly_control_items')
      .delete()
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not remove monthly control item:', error.message);
      showToast('Não foi possível remover este item.');
      return;
    }
    await loadHouseholdData();
  }

  async function copyPreviousMonthItems() {
    const month = new Date(`${state.controlMonthKey}T12:00:00`);
    const previous = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const previousMonthStart = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-01`;
    let templates = state.monthlyControlItems.filter(item => item.month_start === previousMonthStart);
    if (!templates.length) {
      const monthNumber = month.getMonth() + 1;
      templates = state.recurringItems
        .filter(item => item.frequency === 'monthly'
          || (item.frequency === 'yearly' && item.month_of_year === monthNumber))
        .map(item => ({
          item_name: item.title,
          transaction_type: item.transaction_type,
          control_group: item.transaction_type === 'income'
            ? 'income'
            : item.budget_group === 'fixed' ? 'fixed'
              : item.budget_group === 'emergency' ? 'additional' : 'variable'
        }));
    }
    const existingNames = new Set(state.monthlyControlItems
      .filter(item => item.month_start === state.controlMonthKey)
      .map(item => `${item.control_group}|${item.item_name.trim().toLocaleLowerCase('pt-BR')}`));
    const rows = templates
      .filter(item => !existingNames.has(`${item.control_group}|${item.item_name.trim().toLocaleLowerCase('pt-BR')}`))
      .map(item => ({
        household_id: state.membership.household_id,
        month_start: state.controlMonthKey,
        item_name: item.item_name,
        transaction_type: item.transaction_type,
        control_group: item.control_group,
        amount_cents: null,
        created_by: state.user.id
      }));
    if (!rows.length) {
      showToast(templates.length
        ? 'Não há novos itens para copiar.'
        : 'Não há itens anteriores. Adicione suas receitas e despesas acima.');
      return;
    }
    const { error } = await supabase.from('monthly_control_items').insert(rows);
    if (error) {
      console.error('Could not copy monthly control items:', error.message);
      showToast('Não foi possível copiar os itens do mês anterior.');
      return;
    }
    showToast(`${rows.length} itens copiados; os valores ficaram em branco para preencher.`);
    await loadHouseholdData();
  }

  function renderFinancialData() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const controlMonthKey = state.controlMonthKey?.slice(0, 7) ?? currentMonth;
    const controlEntries = financialEntriesForMonth(controlMonthKey);
    const monthIncome = sumType(controlEntries, 'income');
    const monthExpenses = sumType(controlEntries, 'expense');
    document.getElementById('month-income').textContent = formatMoney(monthIncome);
    document.getElementById('month-expenses').textContent = formatMoney(monthExpenses);
    document.getElementById('month-balance').textContent = formatMoney(monthIncome - monthExpenses);

    const selectedMonthDate = new Date(now.getFullYear(), now.getMonth() - (5 - state.insightsMonthIndex), 1);
    const selectedMonthKey = `${selectedMonthDate.getFullYear()}-${String(selectedMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const insightsTransactions = financialEntriesForMonth(selectedMonthKey);
    const insightIncome = sumType(insightsTransactions, 'income');
    const insightExpenses = sumType(insightsTransactions, 'expense');
    const insightReserveNet = state.reserveMovements
      .filter(item => item.movement_date.startsWith(selectedMonthKey))
      .reduce((sum, item) => sum + (item.direction === 'deposit' ? 1 : -1) * Number(item.amount_cents), 0);
    const daysCovered = selectedMonthKey === currentMonth
      ? now.getDate()
      : new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() + 1, 0).getDate();
    const spendingDays = new Set(insightsTransactions
      .filter(item => item.transaction_type === 'expense')
      .map(item => item.transaction_date)).size;
    document.getElementById('insight-balance').textContent =
      formatMoney(insightIncome - insightExpenses - insightReserveNet);
    document.getElementById('insight-balance-note').textContent =
      insightsTransactions.length || insightReserveNet ? 'Receitas − consumo − aporte líquido à reserva' : 'Sem lançamentos';
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

    const recentEntries = [...state.transactions, ...allCardStatementEntries()]
      .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
    renderTransactions(document.getElementById('all-transactions'), recentEntries);
    updateCharts(insightsTransactions);
  }

  function allCardStatementEntries() {
    return state.cardStatementItems.map(item => {
      const statement = state.cardStatements.find(row => row.id === item.statement_id);
      const card = state.creditCards.find(row => row.id === statement?.credit_card_id);
      return {
        ...item,
        created_by: null,
        transaction_type: 'expense',
        transaction_date: statement?.due_date ?? item.purchase_date,
        display_date: item.purchase_date,
        title: item.title,
        card_label: card?.label ?? 'Cartão',
        payment_method: 'credit'
      };
    });
  }

  function financialEntriesForMonth(monthKey) {
    const monthlyItems = state.monthlyControlItems.filter(item =>
      item.month_start.startsWith(monthKey));
    const transactions = monthlyItems.length
      ? monthlyItems
        .filter(item => Number(item.amount_cents ?? 0) > 0)
        .map(item => ({
          transaction_type: item.transaction_type,
          transaction_date: item.month_start,
          title: item.item_name,
          category: item.item_name,
          subcategory: null,
          budget_group: item.control_group === 'fixed' ? 'fixed'
            : item.control_group === 'additional' ? 'emergency'
              : item.control_group === 'variable' ? 'variable' : null,
          amount_cents: Number(item.amount_cents)
        }))
      : state.transactions.filter(item => item.transaction_date.startsWith(monthKey));
    const cardEntries = allCardStatementEntries().filter(item =>
      item.transaction_date.startsWith(monthKey));
    return [...transactions, ...cardEntries];
  }

  function renderReserveSummary() {
    const balance = reserveBalance();
    const target = state.budgetTargets.find(item => item.target_type === 'emergency_fund_goal');
    const targetAmount = Number(target?.amount_cents ?? 0);
    const progress = targetAmount > 0
      ? Math.min(100, Math.max(0, Math.round(balance / targetAmount * 100)))
      : 0;
    document.getElementById('emergency-reserve-balance').textContent = formatMoney(balance);
    document.getElementById('emergency-reserve-meta').textContent = targetAmount > 0
      ? `Meta: ${formatMoney(targetAmount)} · ${progress}% alcançado`
      : 'Cadastre o objetivo total da reserva em Ajustes.';
    document.getElementById('emergency-reserve-progress').style.width = `${progress}%`;
    document.getElementById('emergency-reserve-note').textContent =
      'Aportes reduzem o saldo livre, mas não são contabilizados como despesa de consumo.';
  }

  function renderBudgetOverview(currentEntries) {
    const container = document.getElementById('budget-overview');
    container.replaceChildren();
    const targets = state.budgetTargets.filter(item =>
      ['monthly_limit', 'daily_limit', 'leisure_limit', 'monthly_reserve_target'].includes(item.target_type));
    if (!targets.length) {
      appendEmptyState(container, 'Cadastre limites em Ajustes para acompanhar as fatias da renda.');
      return;
    }
    const expenseGroups = currentEntries
      .filter(item => item.transaction_type === 'expense')
      .reduce((totals, item) => {
        const group = item.budget_group ?? 'variable';
        totals.set(group, (totals.get(group) ?? 0) + Number(item.amount_cents));
        return totals;
      }, new Map());
    const targetGroup = {
      monthly_limit: null,
      daily_limit: 'variable',
      leisure_limit: 'leisure',
      monthly_reserve_target: 'reserve'
    };
    for (const target of targets) {
      const row = document.createElement('div');
      row.className = 'list-item';
      const info = document.createElement('div');
      info.className = 'info';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = target.label;
      const group = targetGroup[target.target_type];
      const spent = target.target_type === 'monthly_limit'
        ? sumType(currentEntries, 'expense')
        : group === 'reserve'
          ? state.reserveMovements
            .filter(item => item.direction === 'deposit' && item.movement_date.startsWith(localDate(new Date()).slice(0, 7)))
            .reduce((sum, item) => sum + Number(item.amount_cents), 0)
          : expenseGroups.get(group) ?? 0;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = target.amount_cents == null
        ? `Realizado: ${formatMoney(spent)} · limite a definir`
        : `Realizado: ${formatMoney(spent)} de ${formatMoney(Number(target.amount_cents))}`;
      info.append(title, subtitle);
      row.append(info);
      container.append(row);
    }
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
      const dateLabel = formatDate(item.display_date ?? item.transaction_date);
      const cardLabel = item.card_label ? ` · ${item.card_label}` : '';
      const subcategory = item.subcategory ? ` · ${item.subcategory}` : '';
      subtitle.textContent = `${dateLabel} · ${author} · ${item.category ?? 'Sem categoria'}${subcategory}${cardLabel}`;
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
      const monthTransactions = financialEntriesForMonth(key);
      const reserveNet = state.reserveMovements
        .filter(item => item.movement_date.startsWith(key))
        .reduce((sum, item) => sum + (item.direction === 'deposit' ? 1 : -1) * Number(item.amount_cents), 0);
      const income = monthTransactions.filter(item => item.transaction_type === 'income')
        .reduce((sum, item) => sum + Number(item.amount_cents), 0);
      const expenses = monthTransactions.filter(item => item.transaction_type === 'expense')
        .reduce((sum, item) => sum + Number(item.amount_cents), 0);
      return {
        income: income / 100,
        expenses: expenses / 100,
        balance: (income - expenses - reserveNet) / 100
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
