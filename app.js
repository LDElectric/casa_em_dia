import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  calculateMonthlyCashFlow,
  classifyCardPurchase,
  financialMonthKey,
  getStatementReferenceMonth,
  parseCardOfx,
  parseCardOfxPeriod,
  parseCardPdfLines,
  parseCardPdfTotal
} from './card-statement.mjs';
import {
  budgetGroupForControlGroup,
  classifyExpenseGroup,
  controlGroupForBudgetGroup,
  expenseGroupLabel,
  normalizeText
} from './smart-classify.mjs';
import { backupFileName, buildBackup, centsToCsv, toCsv } from './backup.mjs';

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
  transactionsMonthKey: null,
  pendingCardImport: null,
  selectedImportCardId: null,
  pendingEntryCardId: null,
  pendingPdfLibrary: null,
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
  householdCutoffDay: 1,
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
    showAuthStatus(
      'Ocorreu um erro ao abrir os dados da casa. Tente novamente; se persistir, atualize a página.',
      true
    );
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
    document.getElementById('transaction-title').addEventListener('change', suggestEntryBudgetGroup);
    document.getElementById('entry-budget-group').addEventListener('change', () => {
      entryBudgetGroupTouched = true;
    });
    document.getElementById('payment-method').addEventListener('change', updatePaymentFields);
    document.getElementById('entry-variable-amount').addEventListener('change', updateEntryAmountLabel);
    window.addEventListener('entry-type-changed', () => {
      entryBudgetGroupTouched = false;
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
    document.getElementById('save-household-cutoff').addEventListener('click', saveHouseholdCutoff);
    const transactionDialog = document.getElementById('transaction-dialog');
    document.getElementById('transaction-dialog-form').addEventListener('submit', saveTransactionCompetence);
    document.getElementById('transaction-dialog-close').addEventListener('click', closeTransactionDialog);
    transactionDialog.addEventListener('click', event => {
      if (event.target === transactionDialog) closeTransactionDialog();
    });
    transactionDialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
    document.getElementById('household-setup-import-form').addEventListener('submit', prepareHouseholdImport);    document.getElementById('confirm-household-import').addEventListener('click', confirmHouseholdImport);
    document.getElementById('reserve-movement-form').addEventListener('submit', saveReserveMovement);
    document.getElementById('credit-card-form').addEventListener('submit', saveCreditCard);
    document.getElementById('cancel-credit-card-edit').addEventListener('click', resetCreditCardForm);
    document.getElementById('open-card-form').addEventListener('click', () => openCardFormDialog('cards'));
    document.getElementById('entry-add-card').addEventListener('click', () => openCardFormDialog('entry'));
    const cardFormDialog = document.getElementById('card-form-dialog');
    document.getElementById('card-form-dialog-form').addEventListener('submit', event => {
      event.preventDefault();
      saveCardFromDialog('import');
    });
    document.getElementById('card-form-save').addEventListener('click', () => saveCardFromDialog('save'));
    document.getElementById('card-form-dialog-close').addEventListener('click', closeCardFormDialog);
    cardFormDialog.addEventListener('click', event => {
      if (event.target === cardFormDialog) closeCardFormDialog();
    });
    cardFormDialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
    const scopeField = document.getElementById('card-statement-scope');
    if (scopeField) scopeField.addEventListener('change', updateCardScopeFields);
    document.getElementById('card-import-form').addEventListener('submit', prepareCardImport);
    document.getElementById('confirm-card-import').addEventListener('click', confirmCardImport);
    document.getElementById('close-card-import').addEventListener('click', () =>
      document.getElementById('card-import-dialog').close());
    document.querySelectorAll('form[data-control-group]').forEach(form => {
      form.addEventListener('submit', addMonthlyControlItem);
      const variableOption = form.elements.variable_amount?.closest('label');
      const syncVariableOption = () => {
        const repeating = form.elements.repeat_monthly.checked;
        if (!repeating) form.elements.variable_amount.checked = false;
        if (variableOption) variableOption.hidden = !repeating;
      };
      form.elements.repeat_monthly.addEventListener('change', syncVariableOption);
      form.addEventListener('reset', () => window.setTimeout(syncVariableOption, 0));
      syncVariableOption();
    });
    document.querySelectorAll('#quick-add-type .type-btn').forEach(button => {
      button.addEventListener('click', () => {
        quickAddType = button.dataset.type === 'income' ? 'income' : 'expense';
        document.querySelectorAll('#quick-add-type .type-btn')
          .forEach(other => other.classList.toggle('active', other === button));
        document.getElementById('quick-add-hint').textContent = quickAddType === 'income'
          ? 'A receita entra em Receitas deste mês; marque "Fixar e repetir" para os próximos meses.'
          : 'Despesas entram automaticamente em Gastos fixos, variáveis ou adicionais.';
        document.getElementById('monthly-control-message').textContent = '';
      });
    });
    document.getElementById('copy-control-items').addEventListener('click', copyPreviousMonthItems);
    document.getElementById('restore-removed-items').addEventListener('click', restoreRemovedItems);
    const controlItemDialog = document.getElementById('control-item-dialog');
    document.getElementById('control-item-form').addEventListener('submit', saveControlItemAdjustment);
    document.getElementById('control-item-delete').addEventListener('click', deleteControlItemFromDialog);
    document.querySelectorAll('#control-item-dialog [data-close-dialog]').forEach(button =>
      button.addEventListener('click', closeControlItemDialog));
    controlItemDialog.addEventListener('click', event => {
      if (event.target === controlItemDialog) closeControlItemDialog();
    });
    controlItemDialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
    document.querySelectorAll('#control-item-behavior .freq-btn').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('#control-item-behavior .freq-btn')
          .forEach(other => other.classList.toggle('active', other === button));
        updateControlItemDialogNote();
      });
    });
    document.querySelectorAll('#control-item-group .freq-btn').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('#control-item-group .freq-btn')
          .forEach(other => other.classList.toggle('active', other === button));
      });
    });
    document.getElementById('export-backup-json').addEventListener('click', exportHouseholdBackup);
    document.getElementById('export-monthly-csv').addEventListener('click', exportMonthlyItemsCsv);
    document.getElementById('export-transactions-csv').addEventListener('click', exportTransactionsCsv);
    window.addEventListener('control-month-changed', async event => {
      state.controlMonthKey = event.detail.monthKey;
      try {
        window.localStorage.setItem('casa-em-dia-control-month', event.detail.monthKey);
      } catch {
        /* navegador sem armazenamento local */
      }
      const loaded = await loadHouseholdData();
      if (!loaded) showToast('Não foi possível preparar os valores recorrentes deste mês.');
    });
    document.getElementById('statement-csv').addEventListener('change', suggestDueDateFromFile);
    document.getElementById('card-import-dialog').addEventListener('close', () => {
      state.selectedImportCardId = null;
      state.pendingCardImport = null;
      document.getElementById('card-import-form').reset();
      document.getElementById('card-import-preview').hidden = true;
      document.getElementById('confirm-card-import').disabled = true;
    });
    document.getElementById('open-invite').addEventListener('click', openInviteDialog);
    document.getElementById('close-invite').addEventListener('click', closeInviteDialog);
    document.getElementById('signout').addEventListener('click', signOut);
    document.getElementById('setup-signout').addEventListener('click', signOut);
    document.getElementById('invite-dialog').addEventListener('click', event => {
      if (event.target.id === 'invite-dialog') closeInviteDialog();
    });
    updateCardScopeFields();
    const today = new Date();
    const currentMonthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    let savedMonthStart = null;
    try {
      savedMonthStart = window.localStorage.getItem('casa-em-dia-control-month');
    } catch {
      /* navegador sem armazenamento local */
    }
    state.controlMonthKey = /^\d{4}-(0[1-9]|1[0-2])-01$/.test(savedMonthStart ?? '')
      ? savedMonthStart
      : currentMonthStart;
    if (window.syncControlMonth) window.syncControlMonth(state.controlMonthKey);
    state.transactionsMonthKey = state.controlMonthKey;
    window.addEventListener('transactions-month-changed', event => {
      state.transactionsMonthKey = event.detail.monthKey;
      renderFinancialData();
    });
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
          showAuthStatus(
            'Ocorreu um erro ao abrir os dados da casa. Tente novamente; se persistir, atualize a página.',
            true
          );
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
      restoreLastScreen();
    } else {
      showAuthStatus('Não foi possível carregar os dados da casa. Sua sessão continua protegida; tente novamente.', true);
    }
  }

  function restoreLastScreen() {
    let savedScreen = null;
    try {
      savedScreen = window.localStorage.getItem('casa-em-dia-last-screen');
    } catch {
      /* navegador sem armazenamento local */
    }
    if (!savedScreen || !document.getElementById(`screen-${savedScreen}`)) return;
    if (typeof window.showScreen === 'function') window.showScreen(savedScreen);
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

  async function queryMonthlyControlItems(householdId) {
    const result = await supabase.from('monthly_control_items')
      .select('id, month_start, item_name, transaction_type, control_group, amount_cents, recurring_item_id, is_skipped, income_behavior')
      .eq('household_id', householdId)
      .order('month_start', { ascending: false })
      .order('control_group')
      .order('item_name');

    if (result.error && (result.error.code === '42703' || result.error.message?.includes('income_behavior'))) {
      const fallback = await supabase.from('monthly_control_items')
        .select('id, month_start, item_name, transaction_type, control_group, amount_cents, recurring_item_id, is_skipped')
        .eq('household_id', householdId)
        .order('month_start', { ascending: false })
        .order('control_group')
        .order('item_name');
      if (!fallback.error && fallback.data) {
        return {
          data: fallback.data.map(item => ({ ...item, income_behavior: null })),
          error: null
        };
      }
      return fallback;
    }
    return result;
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
      monthlyControlResult,
      ensureResult
    ] = await Promise.all([
      supabase.from('household_members')
        .select('user_id, email, role')
        .eq('household_id', householdId)
        .order('created_at'),
      (async () => {
        const columns = 'id, created_by, title, transaction_type, category, subcategory, budget_group, payment_method, credit_card_id, amount_cents, transaction_date';
        const withCompetence = await supabase.from('transactions')
          .select(`${columns}, competence_month`)
          .eq('household_id', householdId)
          .gte('transaction_date', localDate(sixMonthsAgo))
          .order('transaction_date', { ascending: false });
        if (!withCompetence.error) return withCompetence;
        const fallback = await supabase.from('transactions')
          .select(columns)
          .eq('household_id', householdId)
          .gte('transaction_date', localDate(sixMonthsAgo))
          .order('transaction_date', { ascending: false });
        return fallback.error
          ? fallback
          : { data: fallback.data.map(item => ({ ...item, competence_month: null })), error: null };
      })(),
      supabase.from('recurring_items')
        .select('id, title, transaction_type, category, subcategory, budget_group, amount_cents, amount_behavior, frequency, day_of_month, month_of_year, starts_month, active')
        .eq('household_id', householdId)
        .order('title'),
      (async () => {
        const withCutoff = await supabase.from('households')
          .select('name, finance_month_cutoff_day')
          .eq('id', householdId)
          .single();
        if (!withCutoff.error) return withCutoff;
        const fallback = await supabase.from('households')
          .select('name')
          .eq('id', householdId)
          .single();
        return fallback.error
          ? fallback
          : { data: { ...fallback.data, finance_month_cutoff_day: 1 }, error: null };
      })(),
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
        .select('id, credit_card_id, due_date, status, paid_at, source_filename, imported_at, imported_by, statement_total_cents')
        .eq('household_id', householdId)
        .order('due_date', { ascending: false }),
      supabase.from('card_statement_items')
        .select('id, statement_id, source_key, purchase_date, title, cardholder_label, amount_cents, installment_number, installment_total, category, subcategory, budget_group')
        .eq('household_id', householdId)
        .order('purchase_date', { ascending: false }),
      queryMonthlyControlItems(householdId),
      supabase.rpc('ensure_monthly_control_items', {
        target_month_start: state.controlMonthKey
      })
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
    state.householdCutoffDay = Number(householdResult.data.finance_month_cutoff_day) || 1;
    if (ensureResult.error) {
      console.warn('Could not prepare recurring items for the selected month:', ensureResult.error.message);
    } else if (Number(ensureResult.data ?? 0) > 0) {
      const { data: monthlyItems, error: monthlyItemsError } = await queryMonthlyControlItems(householdId);
      if (!monthlyItemsError && monthlyItems) {
        state.monthlyControlItems = monthlyItems;
      }
    }
    document.getElementById('control-household-subtitle').textContent =
      `${householdResult.data.name} · ${state.user.email ?? ''}`;
    document.getElementById('settings-household-name').textContent = householdResult.data.name;
    const cutoffInput = document.getElementById('household-cutoff-day');
    if (cutoffInput) cutoffInput.value = String(state.householdCutoffDay);
    const cutoffCard = document.getElementById('household-cutoff-card');
    if (cutoffCard) cutoffCard.hidden = state.membership.role !== 'owner';
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

  /**
   * Recarrega apenas os itens de controle mensal e re-renderiza as seções
   * dependentes. Muito mais rápido que loadHouseholdData() para operações
   * de add/edit/delete no quadro de controle.
   */
  async function refreshControlState() {
    const householdId = state.membership?.household_id;
    if (!householdId) return false;
    const { data: monthlyItems, error } = await queryMonthlyControlItems(householdId);
    if (error || !monthlyItems) {
      console.warn('Could not refresh monthly control items:', error?.message);
      showToast('Não foi possível atualizar o controle mensal.');
      return false;
    }
    state.monthlyControlItems = monthlyItems;
    renderMonthlyControl();
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
    setMessage('invite-message', data?.message ?? 'Convite enviado.');
    await loadHouseholdData();
  }

  function monthlyControlGroupForCardItem(budgetGroup) {
    return controlGroupForBudgetGroup(budgetGroup);
  }

  function normalizeControlName(value) {
    return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  }

  function controlGroupForTemplate(template) {
    return template.transaction_type === 'income'
      ? 'income'
      : monthlyControlGroupForCardItem(template.budget_group);
  }

  const CLASSIFICATION_REASONS = {
    category: 'categoria',
    history: 'histórico',
    keywords: 'palavras-chave',
    default: 'padrão'
  };

  let quickAddType = 'expense';

  function controlClassificationHistory() {
    const history = [];
    for (const item of state.monthlyControlItems) {
      if (item.is_skipped || item.transaction_type !== 'expense') continue;
      history.push({ name: item.item_name, group: item.control_group, monthStart: item.month_start });
    }
    for (const template of state.recurringItems) {
      if (template.transaction_type !== 'expense') continue;
      history.push({
        name: template.title,
        group: controlGroupForTemplate(template),
        monthStart: template.starts_month
      });
    }
    for (const transaction of state.transactions) {
      if (transaction.transaction_type !== 'expense' || !transaction.budget_group) continue;
      history.push({
        name: transaction.title,
        group: monthlyControlGroupForCardItem(transaction.budget_group),
        monthStart: transaction.transaction_date
      });
    }
    return history;
  }

  function classifyExpense(itemName, { category, subcategory } = {}) {
    return classifyExpenseGroup({
      itemName,
      category,
      subcategory,
      categories: state.financeCategories.filter(item => item.transaction_type === 'expense'),
      history: controlClassificationHistory()
    });
  }

  function findRecurringTemplate(transactionType, controlGroup, itemName) {
    const normalized = normalizeControlName(itemName);
    return state.recurringItems.find(template =>
      template.frequency === 'monthly'
      && template.transaction_type === transactionType
      && controlGroupForTemplate(template) === controlGroup
      && normalizeControlName(template.title) === normalized);
  }

  function categoryForControlItem(transactionType, budgetGroup, itemName) {
    const normalized = normalizeControlName(itemName);
    const sameGroup = item => transactionType === 'income' || item.budget_group === budgetGroup;
    const matching = state.financeCategories.find(item =>
      item.transaction_type === transactionType
      && sameGroup(item)
      && [item.category, item.subcategory].some(value => normalizeControlName(value) === normalized));
    const fallback = state.financeCategories.find(item =>
      item.transaction_type === transactionType && sameGroup(item))
      ?? state.financeCategories.find(item => item.transaction_type === transactionType);
    return {
      category: matching?.category ?? fallback?.category ?? 'Outros',
      subcategory: matching?.subcategory ?? fallback?.subcategory
        ?? (transactionType === 'income' ? 'Outras receitas' : 'Outras despesas')
    };
  }

  async function deactivateDuplicateTemplates({
    templateId, itemName, transactionType, controlGroup, frequency = 'monthly'
  }) {
    const normalized = normalizeControlName(itemName);
    const duplicates = state.recurringItems.filter(template =>
      template.id !== templateId
      && template.active
      && template.frequency === frequency
      && template.transaction_type === transactionType
      && controlGroupForTemplate(template) === controlGroup
      && normalizeControlName(template.title) === normalized);
    for (const duplicate of duplicates) {
      const { error } = await supabase.from('recurring_items')
        .update({ active: false })
        .eq('id', duplicate.id)
        .eq('household_id', state.membership.household_id);
      if (error) {
        console.warn('Could not pause duplicate recurring item:', error.message);
      }
    }
    return duplicates.length;
  }

  async function saveRecurringTemplate({
    template, itemName, transactionType, controlGroup, amountCents, amountBehavior
  }) {
    await deactivateDuplicateTemplates({
      templateId: template?.id ?? null,
      itemName,
      transactionType,
      controlGroup
    });
    const budgetGroup = budgetGroupForControlGroup(controlGroup);
    const { category, subcategory } = categoryForControlItem(transactionType, budgetGroup, itemName);
    const payload = {
      title: itemName,
      transaction_type: transactionType,
      category,
      subcategory,
      budget_group: budgetGroup,
      amount_cents: amountBehavior === 'fixed' ? amountCents : null,
      amount_behavior: amountBehavior,
      frequency: 'monthly',
      month_of_year: null,
      day_of_month: 1,
      active: true
    };
    if (template) {
      const { error } = await supabase.from('recurring_items')
        .update(payload)
        .eq('id', template.id)
        .eq('household_id', state.membership.household_id);
      return { id: template.id, error, reused: true };
    }
    const { data, error } = await supabase.from('recurring_items')
      .insert({
        ...payload,
        household_id: state.membership.household_id,
        created_by: state.user.id,
        starts_month: state.controlMonthKey
      })
      .select('id')
      .single();
    return { id: data?.id ?? null, error, reused: false };
  }

  function isMissingColumnError(error, column) {
    return Boolean(error) && (
      error.code === '42703'
      || error.code === 'PGRST204'
      || String(error.message ?? '').includes(column)
    );
  }

  function isMissingIncomeBehaviorError(error) {    return Boolean(error) && (
      error.code === '42703'
      || error.code === 'PGRST204'
      || error.message?.includes('income_behavior')
    );
  }

  async function applyMonthlyControlUpdate(payload, buildQuery) {
    let { error } = await buildQuery(supabase.from('monthly_control_items').update(payload));
    if (isMissingIncomeBehaviorError(error)) {
      const fallback = { ...payload };
      delete fallback.income_behavior;
      ({ error } = await buildQuery(supabase.from('monthly_control_items').update(fallback)));
    }
    return error;
  }

  async function insertMonthRow(payload) {
    let { error } = await supabase.from('monthly_control_items').insert(payload);
    if (isMissingIncomeBehaviorError(error)) {
      const fallback = { ...payload };
      delete fallback.income_behavior;
      ({ error } = await supabase.from('monthly_control_items').insert(fallback));
    }
    return error;
  }

  async function linkOrCreateMonthRow({
    existingRow, templateId, itemName, controlGroup, transactionType, amountCents, incomeBehavior
  }) {
    const householdId = state.membership.household_id;
    const rowPayload = {
      item_name: itemName,
      amount_cents: amountCents,
      is_skipped: false,
      recurring_item_id: templateId,
      income_behavior: incomeBehavior,
      updated_at: new Date().toISOString()
    };
    if (controlGroup) rowPayload.control_group = controlGroup;
    if (existingRow) {
      const error = await applyMonthlyControlUpdate(rowPayload, query => query
        .eq('id', existingRow.id)
        .eq('household_id', householdId));
      if (error) return error;
      const { data: restored, error: checkError } = await supabase.from('monthly_control_items')
        .select('id')
        .eq('id', existingRow.id)
        .eq('household_id', householdId)
        .maybeSingle();
      if (checkError) return checkError;
      if (restored) return null;
    }
    const { data: linked, error } = await supabase.from('monthly_control_items')
      .select('id')
      .eq('household_id', householdId)
      .eq('month_start', state.controlMonthKey)
      .eq('recurring_item_id', templateId)
      .maybeSingle();
    if (error) return error;
    if (linked) {
      return applyMonthlyControlUpdate(rowPayload, query => query
        .eq('id', linked.id)
        .eq('household_id', householdId));
    }
    return insertMonthRow({
      household_id: householdId,
      month_start: state.controlMonthKey,
      item_name: itemName,
      transaction_type: transactionType,
      control_group: controlGroup,
      amount_cents: amountCents,
      income_behavior: incomeBehavior,
      recurring_item_id: templateId,
      created_by: state.user.id
    });
  }

  async function restoreRemovedItems() {
    const householdId = state.membership?.household_id;
    if (!householdId) return;
    const removed = state.monthlyControlItems.filter(item =>
      item.month_start === state.controlMonthKey && item.is_skipped);
    if (!removed.length) {
      showToast('Nenhum item removido neste mês.');
      return;
    }
    const { error } = await supabase.from('monthly_control_items')
      .update({ is_skipped: false, updated_at: new Date().toISOString() })
      .eq('household_id', householdId)
      .eq('month_start', state.controlMonthKey)
      .eq('is_skipped', true);
    if (error) {
      console.error('Could not restore removed monthly items:', error.message);
      showToast('Não foi possível restaurar os itens removidos.');
      return;
    }
    showToast(removed.length === 1
      ? 'Item restaurado neste mês.'
      : `${removed.length} itens restaurados neste mês.`);
    await refreshControlState();
  }

  let editingControlItem = null;

  async function pauseRecurringTemplate(templateId, fromMonthStart) {
    const householdId = state.membership.household_id;
    const { error } = await supabase.from('recurring_items')
      .update({ active: false })
      .eq('id', templateId)
      .eq('household_id', householdId);
    if (error) return error;
    const { error: futureError } = await supabase.from('monthly_control_items')
      .delete()
      .eq('recurring_item_id', templateId)
      .gt('month_start', fromMonthStart)
      .eq('household_id', householdId);
    return futureError ?? null;
  }

  function controlItemBehavior(item) {
    const recurring = state.recurringItems.find(template => template.id === item.recurring_item_id);
    if (!recurring?.active) return 'once';
    if (item.transaction_type === 'income') {
      return item.income_behavior ?? recurring.amount_behavior ?? 'variable';
    }
    return recurring.amount_behavior ?? (item.control_group === 'fixed' ? 'fixed' : 'variable');
  }

  function updateControlItemDialogNote() {
    const behavior = document.querySelector('#control-item-behavior .freq-btn.active')?.dataset.behavior ?? 'once';
    const note = document.getElementById('control-item-behavior-note');
    note.textContent = behavior === 'fixed'
      ? 'Repete todo mês com este valor; mudanças valem para este mês e os seguintes.'
      : behavior === 'variable'
        ? 'Repete todo mês, mas o valor é preenchido em cada mês.'
        : 'Lançamento só deste mês; a repetição é encerrada a partir daqui.';
  }

  function openControlItemDialog(item) {
    editingControlItem = item;
    document.getElementById('control-item-dialog-title').textContent =
      item.transaction_type === 'income' ? 'Ajustar receita' : 'Ajustar despesa';
    document.getElementById('control-item-name-input').value = item.item_name;
    document.getElementById('control-item-amount-input').value = item.amount_cents == null
      ? ''
      : (Number(item.amount_cents) / 100).toFixed(2).replace('.', ',');
    const behavior = controlItemBehavior(item);
    document.querySelectorAll('#control-item-behavior .freq-btn').forEach(button => {
      button.classList.toggle('active', button.dataset.behavior === behavior);
    });
    const groupWrap = document.getElementById('control-item-group-wrap');
    const isExpense = item.transaction_type === 'expense';
    if (groupWrap) groupWrap.hidden = !isExpense;
    if (isExpense) {
      const currentGroup = ['fixed', 'variable', 'additional'].includes(item.control_group)
        ? item.control_group
        : 'variable';
      document.querySelectorAll('#control-item-group .freq-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.group === currentGroup);
      });
    }
    const deleteButton = document.getElementById('control-item-delete');
    deleteButton.textContent = item.recurring_item_id ? 'Excluir deste mês' : 'Excluir';
    deleteButton.disabled = false;
    document.getElementById('control-item-save').disabled = false;
    setMessage('control-item-dialog-message', '');
    updateControlItemDialogNote();
    const dialog = document.getElementById('control-item-dialog');
    document.body.classList.add('dialog-open');
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    const amountInput = document.getElementById('control-item-amount-input');
    amountInput.focus({ preventScroll: true });
    amountInput.select();
  }

  function closeControlItemDialog() {
    const dialog = document.getElementById('control-item-dialog');
    document.body.classList.remove('dialog-open');
    editingControlItem = null;
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  async function saveControlItemAdjustment(event) {
    event.preventDefault();
    const item = editingControlItem;
    if (!item) return;
    const name = document.getElementById('control-item-name-input').value.trim();
    const rawAmount = document.getElementById('control-item-amount-input').value.trim();
    const amountCents = rawAmount ? parseAmount(rawAmount) : null;
    const behavior = document.querySelector('#control-item-behavior .freq-btn.active')?.dataset.behavior ?? 'once';
    const selectedGroup = item.transaction_type === 'expense'
      ? document.querySelector('#control-item-group .freq-btn.active')?.dataset.group
      : null;
    const targetGroup = item.transaction_type === 'expense' && selectedGroup
      ? selectedGroup
      : item.control_group;
    if (!name || name.length > 120
      || (rawAmount && (!Number.isSafeInteger(amountCents) || amountCents < 0))
      || (behavior === 'fixed' && (!Number.isSafeInteger(amountCents) || amountCents <= 0))) {
      setMessage('control-item-dialog-message', behavior === 'fixed'
        ? 'Informe um nome e um valor maior que zero para um item fixo.'
        : 'Informe um nome e um valor válido.');
      return;
    }
    const duplicate = state.monthlyControlItems.some(row =>
      row.id !== item.id
      && row.month_start === item.month_start
      && row.control_group === targetGroup
      && normalizeControlName(row.item_name) === normalizeControlName(name));
    if (duplicate) {
      setMessage('control-item-dialog-message', `Já existe outro item com esse nome em ${expenseGroupLabel(targetGroup)} neste mês.`);
      return;
    }
    const saveButton = document.getElementById('control-item-save');
    saveButton.disabled = true;
    setMessage('control-item-dialog-message', '');
    try {
      const householdId = state.membership.household_id;
      const transactionType = item.transaction_type;
      const controlGroup = targetGroup;
      const groupNote = transactionType === 'expense' ? ` em ${expenseGroupLabel(controlGroup)}` : '';
      const recurring = state.recurringItems.find(template => template.id === item.recurring_item_id);

      if (behavior === 'once') {
        if (recurring) {
          const pauseError = await pauseRecurringTemplate(recurring.id, item.month_start);
          if (pauseError) throw pauseError;
        }
        const error = await applyMonthlyControlUpdate(
          {
            item_name: name,
            amount_cents: amountCents,
            control_group: controlGroup,
            is_skipped: false,
            recurring_item_id: null,
            income_behavior: null,
            updated_at: new Date().toISOString()
          },
          query => query.eq('id', item.id).eq('household_id', householdId)
        );
        if (error) throw error;
        showToast(`Item ajustado${groupNote}; a repetição foi encerrada a partir deste mês.`);
      } else {
        const { id: templateId, error: templateError } = await saveRecurringTemplate({
          template: recurring ?? findRecurringTemplate(transactionType, controlGroup, name),
          itemName: name,
          transactionType,
          controlGroup,
          amountCents,
          amountBehavior: behavior
        });
        if (templateError || !templateId) throw templateError ?? new Error('model not saved');
        const { error: ensureError } = await supabase.rpc('ensure_monthly_control_items', {
          target_month_start: state.controlMonthKey
        });
        if (ensureError) {
          console.warn('Could not prepare the month from the recurring template:', ensureError.message);
        }
        const rowError = await linkOrCreateMonthRow({
          existingRow: item,
          templateId,
          itemName: name,
          controlGroup,
          transactionType,
          amountCents,
          incomeBehavior: transactionType === 'income' ? behavior : null
        });
        if (rowError) throw rowError;
        const { error: futureError } = await supabase.from('monthly_control_items')
          .update({
            item_name: name,
            control_group: controlGroup,
            ...(behavior === 'fixed' ? { amount_cents: amountCents } : {}),
            updated_at: new Date().toISOString()
          })
          .eq('recurring_item_id', templateId)
          .gt('month_start', item.month_start)
          .eq('household_id', householdId);
        if (futureError) {
          console.warn('Could not apply the change to future months:', futureError.message);
        }
        showToast(behavior === 'fixed'
          ? `Item fixo salvo${groupNote} para este mês e os próximos.`
          : `Item variável salvo${groupNote}; ajuste o valor a cada mês.`);
      }
      closeControlItemDialog();
      await loadHouseholdData();
    } catch (error) {
      console.error('Could not adjust monthly item:', error?.message ?? error);
      setMessage('control-item-dialog-message', error?.code === '23505'
        ? 'Já existe outro item com esse nome neste grupo do mês.'
        : 'Não foi possível salvar o ajuste. Tente novamente.');
    } finally {
      saveButton.disabled = false;
    }
  }

  async function deleteControlItemFromDialog() {
    const item = editingControlItem;
    if (!item) return;
    const recurring = state.recurringItems.find(template => template.id === item.recurring_item_id);
    const deleteButton = document.getElementById('control-item-delete');
    deleteButton.disabled = true;
    setMessage('control-item-dialog-message', '');
    try {
      const householdId = state.membership.household_id;
      const { error } = recurring
        ? await supabase.from('monthly_control_items')
          .update({ is_skipped: true })
          .eq('id', item.id)
          .eq('household_id', householdId)
        : await supabase.from('monthly_control_items')
          .delete()
          .eq('id', item.id)
          .eq('household_id', householdId);
      if (error) throw error;
      closeControlItemDialog();
      showToast(recurring ? 'Item removido somente deste mês.' : 'Item removido.');
      await refreshControlState();
    } catch (error) {
      console.error('Could not delete monthly item:', error?.message ?? error);
      setMessage('control-item-dialog-message', 'Não foi possível excluir este item.');
    } finally {
      deleteButton.disabled = false;
    }
  }


  async function deleteTransactionEntry(item) {
    if (!item.source_transaction_id) return;
    if (!window.confirm(`Remover "${item.title}" do extrato?`)) return;
    const { error } = await supabase.from('transactions')
      .delete()
      .eq('id', item.source_transaction_id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not delete transaction:', error.message);
      showToast('Não foi possível remover este lançamento.');
      return;
    }
    showToast('Lançamento removido.');
    await loadHouseholdData();
  }

  async function updateCardItemControlGroup(item, controlGroup, select) {
    const budgetGroup = controlGroup === 'fixed'
      ? 'fixed'
      : controlGroup === 'additional' ? 'emergency' : 'variable';
    select.disabled = true;
    const { error } = item.source_transaction_id
      ? await supabase.from('transactions')
        .update({ budget_group: budgetGroup })
        .eq('id', item.source_transaction_id)
        .eq('household_id', state.membership.household_id)
      : await supabase.from('card_statement_items')
        .update({ budget_group: budgetGroup })
        .eq('id', item.source_item_id ?? item.id)
        .eq('household_id', state.membership.household_id);
    if (error) {
      select.disabled = false;
      select.value = monthlyControlGroupForCardItem(item.budget_group);
      console.error('Could not move card statement item:', error.message);
      showToast('Não foi possível mover esta compra para outro grupo.');
      return;
    }
    showToast('Compra movida para outro grupo.');
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
    renderEntryCompetenceOptions();
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

  let entryBudgetGroupTouched = false;

  function suggestEntryBudgetGroup() {
    if (entryBudgetGroupTouched) return;
    const isExpense = document.getElementById('btn-expense').classList.contains('active');
    if (!isExpense) return;
    if (document.getElementById('entry-category').value) return;
    const title = document.getElementById('transaction-title').value.trim();
    if (!title) return;
    const classification = classifyExpense(title);
    const budgetGroup = budgetGroupForControlGroup(classification.group);
    if (budgetGroup) document.getElementById('entry-budget-group').value = budgetGroup;
    const normalized = normalizeControlName(title);
    const suggestion = state.financeCategories.find(item =>
      item.transaction_type === 'expense'
      && item.budget_group === budgetGroup
      && [item.category, item.subcategory]
        .some(value => normalizeControlName(value) === normalized));
    if (!suggestion) return;
    document.getElementById('entry-category').value = suggestion.category;
    renderSubcategoryOptions();
    document.getElementById('entry-subcategory').value = suggestion.subcategory;
    setDefaultBudgetGroup();
  }

  function fillCompetenceOptions(select, { currentValue = '', baseMonthKey = null, span = 2 } = {}) {
    if (!select) return;
    select.replaceChildren(new Option('Automático (virada do mês)', ''));
    const base = baseMonthKey
      ? new Date(`${baseMonthKey}-01T12:00:00`)
      : state.controlMonthKey ? new Date(`${state.controlMonthKey}T12:00:00`) : new Date();
    for (let offset = -span; offset <= span; offset += 1) {
      const date = new Date(base.getFullYear(), base.getMonth() + offset, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
      const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
      select.add(new Option(label, value));
    }
    select.value = currentValue && [...select.options].some(option => option.value === currentValue)
      ? currentValue
      : '';
  }

  function competenceAutomaticNote() {
    return state.householdCutoffDay > 1
      ? `Automático: lançamentos até o dia ${state.householdCutoffDay} do mês seguinte contam no mês anterior.`
      : 'Automático usa o mês da data.';
  }

  function renderEntryCompetenceOptions() {
    const select = document.getElementById('entry-competence');
    if (!select) return;
    fillCompetenceOptions(select, { currentValue: select.value });
    const note = document.getElementById('entry-competence-note');
    if (note) {
      note.textContent = `${competenceAutomaticNote()} Escolha um mês para contas pagas antecipadamente.`;
    }
  }

  let editingTransactionId = null;

  function openTransactionDialog(item) {
    editingTransactionId = item.source_transaction_id ?? null;
    const transaction = state.transactions.find(row => row.id === editingTransactionId);
    if (!transaction) {
      showToast('Não foi possível encontrar este lançamento. Atualize a página.');
      return;
    }
    document.getElementById('transaction-dialog-subtitle').textContent =
      `${transaction.title} · ${formatDate(transaction.transaction_date)} · ${formatMoney(Number(transaction.amount_cents))}`;
    fillCompetenceOptions(document.getElementById('transaction-competence'), {
      currentValue: transaction.competence_month ?? '',
      baseMonthKey: entryFinancialMonthKey(transaction)
    });
    const note = document.getElementById('transaction-competence-note');
    note.textContent = `${competenceAutomaticNote()} O mês escolhido aqui vence a virada, para contas pagas antecipadamente ou atrasadas.`;
    setMessage('transaction-dialog-message', '');
    const dialog = document.getElementById('transaction-dialog');
    document.body.classList.add('dialog-open');
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    window.setTimeout(() => document.getElementById('transaction-competence').focus({ preventScroll: true }), 120);
  }

  function closeTransactionDialog() {
    const dialog = document.getElementById('transaction-dialog');
    document.body.classList.remove('dialog-open');
    editingTransactionId = null;
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  async function saveTransactionCompetence(event) {
    event.preventDefault();
    if (!editingTransactionId) return;
    const value = document.getElementById('transaction-competence').value || null;
    const saveButton = document.getElementById('transaction-dialog-save');
    saveButton.disabled = true;
    setMessage('transaction-dialog-message', 'Salvando...');
    try {
      const { error } = await supabase.from('transactions')
        .update({ competence_month: value })
        .eq('id', editingTransactionId)
        .eq('household_id', state.membership.household_id);
      if (error) throw error;
      closeTransactionDialog();
      showToast(value
        ? `Competência alterada para ${formatMonthKey(value)}.`
        : 'Competência automática restaurada.');
      await loadHouseholdData();
    } catch (error) {
      console.error('Could not update the transaction competence:', error?.message ?? error);
      setMessage('transaction-dialog-message', isMissingColumnError(error, 'competence_month')
        ? 'A migração do mês financeiro precisa ser aplicada no Supabase.'
        : 'Não foi possível salvar a competência. Tente novamente.');
    } finally {
      saveButton.disabled = false;
    }
  }

  async function saveHouseholdCutoff() {
    if (state.membership?.role !== 'owner') {
      setMessage('household-cutoff-message', 'Somente o responsável pela casa pode mudar a virada do mês.');
      return;
    }
    const day = Number(document.getElementById('household-cutoff-day').value);
    if (!Number.isInteger(day) || day < 1 || day > 15) {
      setMessage('household-cutoff-message', 'Escolha um dia entre 1 e 15.');
      return;
    }
    const button = document.getElementById('save-household-cutoff');
    button.disabled = true;
    setMessage('household-cutoff-message', 'Salvando...');
    const { error } = await supabase.from('households')
      .update({ finance_month_cutoff_day: day })
      .eq('id', state.membership.household_id);
    button.disabled = false;
    if (error) {
      console.error('Could not save the financial month cutoff:', error.message);
      setMessage('household-cutoff-message', 'Não foi possível salvar. Confirme se a migração do mês financeiro foi aplicada.');
      return;
    }
    state.householdCutoffDay = day;
    setMessage('household-cutoff-message', day === 1
      ? 'Virada desligada: os lançamentos seguem o mês do calendário.'
      : `Virada salva no dia ${day}. Lançamentos até ${day} do mês seguinte contam no mês anterior.`);
    showToast(day === 1 ? 'Mês do calendário restaurado.' : `Virada do mês ajustada para o dia ${day}.`);
    await loadHouseholdData();
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
    if (state.pendingEntryCardId) {
      if (state.creditCards.some(card => card.id === state.pendingEntryCardId && card.active)) {
        cardSelect.value = state.pendingEntryCardId;
      }
      state.pendingEntryCardId = null;
    }
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

  function cardProviderPrefix(card) {
    return card.provider && normalizeControlName(card.provider) !== normalizeControlName(card.label)
      ? `${card.provider} · `
      : '';
  }

  async function createCreditCard({ label, provider, limitCents }) {
    const { data, error } = await supabase.from('credit_cards')
      .insert({
        household_id: state.membership.household_id,
        label,
        provider: provider || label,
        titular_name: label,
        cardholder_name: label,
        card_role: 'titular',
        statement_scope: 'individual',
        last_four: null,
        credit_limit_cents: limitCents,
        created_by: state.user.id
      })
      .select('id')
      .single();
    return { id: data?.id ?? null, error };
  }

  function suggestedStatementDueDate(card) {
    const latest = state.cardStatements
      .filter(statement => statement.credit_card_id === card?.id)
      .sort((left, right) => right.due_date.localeCompare(left.due_date))[0];
    const [year, month, day] = (latest?.due_date ?? localDate(new Date())).split('-').map(Number);
    const next = new Date(year, month - 1, 1);
    next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(day, lastDay));
    return localDate(next);
  }

  let cardFormOrigin = 'cards';

  function openCardFormDialog(origin = 'cards') {
    cardFormOrigin = origin;
    const fromEntry = origin === 'entry';
    document.getElementById('card-form-dialog-form').reset();
    const saveButton = document.getElementById('card-form-save');
    const importButton = document.getElementById('card-form-save-import');
    importButton.hidden = fromEntry;
    saveButton.className = fromEntry ? 'primary-btn' : 'secondary-btn';
    saveButton.disabled = false;
    importButton.disabled = false;
    setMessage('card-form-dialog-message', fromEntry
      ? 'Só o nome é obrigatório. O cartão já fica selecionado nesta despesa.'
      : 'Só o nome é obrigatório. O limite ajuda a acompanhar o uso do cartão.');
    const dialog = document.getElementById('card-form-dialog');
    document.body.classList.add('dialog-open');
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    window.setTimeout(() => document.getElementById('card-form-label').focus({ preventScroll: true }), 120);
  }

  function closeCardFormDialog() {
    const dialog = document.getElementById('card-form-dialog');
    document.body.classList.remove('dialog-open');
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    if (cardFormOrigin === 'entry') {
      const select = document.getElementById('entry-credit-card');
      if (select) select.focus({ preventScroll: true });
    }
  }

  async function saveCardFromDialog(mode) {
    const label = document.getElementById('card-form-label').value.trim();
    const limitRaw = document.getElementById('card-form-limit').value.trim();
    const limitCents = limitRaw ? parseAmount(limitRaw) : null;
    const provider = document.getElementById('card-form-provider').value.trim();
    if (!label || label.length > 80
      || (limitRaw && (!Number.isSafeInteger(limitCents) || limitCents <= 0))) {
      setMessage('card-form-dialog-message', 'Informe o nome do cartão e, se quiser, um limite válido.');
      return;
    }
    const saveButton = document.getElementById('card-form-save');
    const importButton = document.getElementById('card-form-save-import');
    saveButton.disabled = true;
    importButton.disabled = true;
    setMessage('card-form-dialog-message', 'Salvando cartão...');
    try {
      const { id, error } = await createCreditCard({ label, provider, limitCents });
      if (error || !id) throw error ?? new Error('card not created');
      if (cardFormOrigin === 'entry') state.pendingEntryCardId = id;
      closeCardFormDialog();
      await loadHouseholdData();
      if (mode === 'import') {
        showToast('Cartão cadastrado. Escolha o arquivo da fatura.');
        openCardImport(id);
      } else {
        showToast(cardFormOrigin === 'entry'
          ? 'Cartão cadastrado e selecionado nesta despesa.'
          : 'Cartão cadastrado.');
      }
    } catch (error) {
      console.error('Could not create credit card:', error?.message ?? error);
      setMessage('card-form-dialog-message', error?.code === '23505'
        ? 'Já existe um cartão com esse nome. Use outro nome para diferenciar.'
        : 'Não foi possível cadastrar o cartão. Tente novamente.');
    } finally {
      saveButton.disabled = false;
      importButton.disabled = false;
    }
  }

  async function saveCreditCard(event) {
    event.preventDefault();
    const label = document.getElementById('card-label').value.trim();
    const provider = document.getElementById('card-provider').value.trim() || label;
    const titularName = document.getElementById('card-titular').value.trim() || label;
    const limitValue = document.getElementById('card-credit-limit').value.trim();
    const limit = limitValue ? parseAmount(limitValue) : null;
    if (!label || (limitValue && (!Number.isSafeInteger(limit) || limit <= 0))) {
      setMessage('credit-card-message', 'Informe o nome do cartão e, se quiser, o limite e a operadora.');
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

  function openCardImport(creditCardId = '') {
    window.showScreen('home');
    const group = document.querySelector('.credit-card-group');
    group.open = true;
    const card = state.creditCards.find(item => item.id === creditCardId && item.active);
    if (!card) {
      showToast('Não foi possível encontrar este cartão. Atualize a página e tente novamente.');
      return;
    }
    state.selectedImportCardId = card.id;
    document.getElementById('card-import-card-label').textContent =
      `${card.label} · ${card.provider}`;
    const dialog = document.getElementById('card-import-dialog');
    if (!dialog.open) dialog.showModal();
    document.getElementById('card-import-preview').hidden = true;
    document.getElementById('card-import-form').reset();
    document.getElementById('card-import-message').textContent = '';
    document.getElementById('confirm-card-import').disabled = true;
    document.getElementById('statement-due-date').value = suggestedStatementDueDate(card);
    window.setTimeout(() => document.getElementById('statement-csv').focus({ preventScroll: true }), 200);
  }

  function renderCreditCards() {
    const container = document.getElementById('credit-card-list');
    const entrySelect = document.getElementById('entry-credit-card');
    const previousEntry = entrySelect.value;
    container.replaceChildren();
    entrySelect.replaceChildren(new Option('Selecione o cartão', ''));
    const activeCards = state.creditCards.filter(card => card.active);
    for (const card of activeCards) {
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
      subtitle.textContent = `${cardProviderPrefix(card)}${ownership}${limit}`;
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
      importButton.textContent = 'Importar fatura';
      importButton.addEventListener('click', () => openCardImport(card.id));
      actions.append(editButton, importButton);
      row.append(info, actions);
      container.append(row);
    }
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
    const creditCardId = state.selectedImportCardId;
    const dueDate = document.getElementById('statement-due-date').value;
    const preview = document.getElementById('card-import-preview');
    preview.hidden = true;
    state.pendingCardImport = null;
    document.getElementById('confirm-card-import').disabled = true;
    if (!file || !creditCardId || !parseIsoDate(dueDate)) {
      setMessage('card-import-message', 'Selecione o cartão, informe o vencimento e escolha um CSV, PDF ou OFX.');
      return;
    }
    const isPdf = file.name.toLocaleLowerCase('pt-BR').endsWith('.pdf');
    const isOfx = file.name.toLocaleLowerCase('pt-BR').endsWith('.ofx');
    const fileType = isPdf ? 'PDF' : isOfx ? 'OFX' : 'CSV';
    if (file.size > (isPdf ? 10 : 2) * 1024 * 1024) {
      setMessage('card-import-message', `O ${fileType} excede o limite de ${isPdf ? '10' : '2'} MB.`);
      return;
    }

    setMessage('card-import-message', `Lendo o ${fileType} localmente e preparando a prévia...`);
    try {
      let parsedRows;
      let pdfStatementTotal = null;
      let ofxPeriod = null;
      let totalSource = 'rows';
      if (isPdf) {
        const lines = await extractCardPdfLines(file);
        parsedRows = parseCardPdfLines(lines, dueDate);
        pdfStatementTotal = parseCardPdfTotal(lines);
        if (pdfStatementTotal != null) totalSource = 'pdf';
      } else if (isOfx) {
        const ofxText = await readCardOfxFile(file);
        parsedRows = parseCardOfx(ofxText);
        ofxPeriod = parseCardOfxPeriod(ofxText);
      } else {
        parsedRows = parseCardCsv(await file.text());
      }
      if (!parsedRows.length) throw new Error('O arquivo não contém compras para importar.');
      if (parsedRows.length > 500) throw new Error('A fatura excede o limite de 500 lançamentos.');
      const rowsWithKeys = await addStatementRowKeys(parsedRows);
      const fingerprint = await sha256(rowsWithKeys.map(row => row.source_key).sort().join('\n'));
      const { data: existingStatement, error: statementError } = await supabase
        .from('card_statements')
        .select('id, status, source_fingerprint, statement_total_cents')
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
      const netRowsTotal = rowsWithKeys.reduce((sum, row) => sum + Number(row.amount_cents), 0);
      const previousTotals = new Set(state.cardStatements
        .filter(statement => statement.credit_card_id === creditCardId
          && statement.due_date < dueDate
          && statement.statement_total_cents != null)
        .map(statement => Number(statement.statement_total_cents)));
      const previousPaymentTotal = rowsWithKeys
        .filter(row => isCardPayment(row.title) && previousTotals.has(Math.abs(Number(row.amount_cents))))
        .reduce((sum, row) => sum + Number(row.amount_cents), 0);
      const ofxNetTotal = ofxPeriod?.startDate
        ? rowsWithKeys
          .filter(row => !(isCardPayment(row.title) && row.purchase_date <= ofxPeriod.startDate))
          .reduce((sum, row) => sum + Number(row.amount_cents), 0)
        : null;
      const ofxTotal = ofxPeriod?.totalCents != null
        && ofxNetTotal != null
        && Math.abs(ofxPeriod.totalCents - ofxNetTotal) <= 1
        ? ofxNetTotal
        : ofxPeriod?.totalCents ?? null;
      const fallbackTotal = previousPaymentTotal
        ? netRowsTotal - previousPaymentTotal
        : rowsWithKeys
          .filter(row => !isCardPayment(row.title))
          .reduce((sum, row) => sum + Number(row.amount_cents), 0);
      if (ofxTotal != null) totalSource = 'ofx-balance';
      const statementTotalCents = pdfStatementTotal
        ?? (!isOfx && existingStatement?.source_fingerprint === fingerprint
          ? existingStatement.statement_total_cents
          : null)
        ?? ofxTotal
        ?? fallbackTotal;
      state.pendingCardImport = {
        creditCardId,
        dueDate,
        fileName: file.name,
        fingerprint,
        existingStatement,
        statementTotalCents,
        totalSource,
        rows: rowsWithKeys.map(row => {
          const existingItem = categoryBySource.get(row.source_key);
          const automaticClassification = existingItem
            ? null
            : classifyCardPurchase(row.title, state.financeCategories);
          return {
            ...row,
            classification_source: existingItem ? 'saved' : automaticClassification ? 'automatic' : 'manual',
            cardholder_label: row.cardholder_label || existingItem?.cardholder_label || null,
            ...(automaticClassification && {
              category: automaticClassification.category,
              subcategory: automaticClassification.subcategory,
              budget_group: automaticClassification.budget_group
            }),
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
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error('Could not prepare card statement import:', error);
      setMessage('card-import-message', error.message || 'Não foi possível ler esse arquivo.');
    }
  }

  async function readCardOfxFile(file) {
    const data = await file.arrayBuffer();
    const header = new TextDecoder('ascii').decode(data.slice(0, 1024));
    const declaredCharset = header.match(/(?:^|\r?\n)CHARSET:\s*([^\r\n]+)/i)?.[1]
      ?.trim().toLocaleUpperCase('en-US');
    const encoding = declaredCharset && !/^(UTF-?8|UNICODE)$/.test(declaredCharset)
      ? 'windows-1252'
      : 'utf-8';
    return new TextDecoder(encoding).decode(data);
  }

  async function extractCardPdfLines(file) {
    state.pendingPdfLibrary ??= import('https://esm.sh/pdfjs-dist@4.10.38?bundle');
    let pdfjs;
    try {
      pdfjs = await state.pendingPdfLibrary;
    } catch (error) {
      state.pendingPdfLibrary = null;
      throw new Error(`Não foi possível carregar o leitor de PDF. Confira a conexão e tente novamente: ${error.message}`);
    }
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://esm.sh/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    const document = await pdfjs.getDocument({
      data: await file.arrayBuffer(),
      isEvalSupported: false
    }).promise;
    const lines = [];
    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const rows = new Map();
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const baseline = Math.round(item.transform[5] / 2) * 2;
          const row = rows.get(baseline) ?? [];
          row.push({ x: item.transform[4], text: item.str });
          rows.set(baseline, row);
        }
        lines.push(...[...rows.entries()]
          .sort(([left], [right]) => right - left)
          .map(([, row]) => row.sort((left, right) => left.x - right.x)
            .map(item => item.text).join(' ').replace(/\s+/g, ' ').trim()));
      }
    } finally {
      await document.destroy();
    }
    return lines;
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
    const purchasesTotal = pending.rows
      .filter(row => !isCardPayment(row.title))
      .reduce((sum, row) => sum + Number(row.amount_cents), 0);
    document.getElementById('card-import-summary').textContent =
      `${selectedCard?.label ?? 'Cartão'} · vencimento ${formatDate(pending.dueDate)} · ${pending.rows.length} lançamentos · compras ${formatMoney(purchasesTotal)}.`;
    const statementTotalInput = document.getElementById('statement-total');
    statementTotalInput.value = (Number(pending.statementTotalCents ?? purchasesTotal) / 100).toFixed(2).replace('.', ',');
    const statementTotalNote = document.getElementById('statement-total-note');
    statementTotalInput.oninput = () => {
      pending.statementTotalCents = parseBrazilianAmount(statementTotalInput.value);
      const declaredTotal = pending.statementTotalCents;
      if (!Number.isSafeInteger(declaredTotal)) {
        statementTotalNote.textContent = 'Informe um total válido para continuar.';
        return;
      }
      const difference = declaredTotal - purchasesTotal;
      const estimate = pending.totalSource === 'ofx-balance'
        ? 'Total em aberto sugerido pelo saldo do OFX. '
        : pending.totalSource === 'pdf'
          ? 'Total sugerido pelo PDF. '
          : 'Sugestão calculada pelas compras do arquivo; confira com o total em aberto da fatura. ';
      statementTotalNote.textContent = difference
        ? `${estimate}Diferença de ${formatMoney(difference)} em relação às compras. No resumo do mês, o total em aberto entra como despesa no mês do vencimento; as compras ficam categorizadas para análise sem duplicar a saída.`
        : `${estimate}O total entra como despesa no mês do vencimento; as compras continuam categorizadas para análise sem duplicar a saída.`;
    };
    statementTotalInput.oninput();
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
      const classification = document.createElement('span');
      classification.className = item.category ? 'statement-classification' : 'statement-classification needs-review';
      classification.textContent = !item.category
        ? 'Revisar categoria'
        : item.classification_source === 'automatic'
          ? 'Sugestão automática — confira'
          : item.classification_source === 'saved' ? 'Classificação salva' : 'Classificada';
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
      info.append(title, subtitle, classification, cardholder,
        category.categorySelect, category.subcategorySelect, group);
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
    const statementTotalCents = parseBrazilianAmount(document.getElementById('statement-total').value);
    if (!Number.isSafeInteger(statementTotalCents) || statementTotalCents < 0) {
      setMessage('card-import-message', 'Informe um total válido para a fatura.');
      return;
    }
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
        statement_total_cents: statementTotalCents,
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
    document.getElementById('card-import-dialog').close();
    state.selectedImportCardId = null;
    showToast('Fatura atualizada. As parcelas futuras foram recalculadas.');
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
      const purchasesTotal = items
        .filter(item => !isCardPayment(item.title))
        .reduce((sum, item) => sum + Number(item.amount_cents), 0);
      const total = statement.statement_total_cents == null
        ? purchasesTotal
        : Number(statement.statement_total_cents);
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
      subtitle.textContent = `${items.length} lançamentos · total a pagar ${formatMoney(total)} · compras ${formatMoney(purchasesTotal)} · ${statement.status === 'paid' ? 'Paga' : overdue ? 'Em aberto — vencida' : 'Em aberto'}`;
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
    const forecast = getCardInstallmentForecast();
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
      subtitle.textContent = `${item.title} · parcela ${item.installment_number}/${item.installment_total}`;
      const amount = document.createElement('div');
      amount.className = 'amount expense';
      amount.textContent = formatMoney(item.amount_cents);
      info.append(title, subtitle);
      row.append(info, amount);
      container.append(row);
    }
  }

  function getCardInstallmentForecast() {
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
          const forecastDate = addMonthsClamped(due, number - item.installment_number);
          forecast.push({
            id: `${item.id}-${number}`,
            source_item_id: item.id,
            statement_id: statement.id,
            credit_card_id: statement.credit_card_id,
            cardLabel: card?.label ?? 'Cartão',
            title: item.title,
            amount_cents: Number(item.amount_cents),
            installment_number: number,
            installment_total: item.installment_total,
            budget_group: item.budget_group,
            transaction_type: 'expense',
            payment_method: 'credit',
            is_forecast: true,
            display_date: localDate(forecastDate),
            transaction_date: localDate(forecastDate),
            month: `${forecastDate.getFullYear()}-${String(forecastDate.getMonth() + 1).padStart(2, '0')}`,
            dueLabel: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(forecastDate)
          });
        }
      }
    }
    forecast.sort((a, b) => a.month.localeCompare(b.month) || a.cardLabel.localeCompare(b.cardLabel));
    return forecast;
  }

  function addMonthsClamped(date, months) {
    const targetMonth = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
    targetMonth.setDate(Math.min(date.getDate(), lastDay));
    return targetMonth;
  }

  async function findDuplicateTransaction({ title, amountCents, transactionDate, transactionType }) {
    const normalized = normalizeText(title);
    if (!normalized) return null;
    const { data, error } = await supabase.from('transactions')
      .select('id, title, transaction_type, amount_cents, transaction_date')
      .eq('household_id', state.membership.household_id)
      .eq('transaction_type', transactionType)
      .eq('transaction_date', transactionDate)
      .eq('amount_cents', amountCents);
    if (error) {
      console.warn('Could not check duplicate transactions:', error.message);
      return null;
    }
    return (data ?? []).find(row => normalizeText(row.title) === normalized) ?? null;
  }

  async function saveEntry() {
    const rawAmount = document.getElementById('transaction-amount').value.trim();
    const amount = rawAmount ? parseAmount(rawAmount) : null;
    const title = document.getElementById('transaction-title').value.trim();
    const selectedFrequency = document.querySelector('.freq-btn.active')?.dataset.freq ?? 'once';
    const variableAmount = selectedFrequency !== 'once'
      && document.getElementById('entry-variable-amount').checked;
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
      || (!variableAmount && (!Number.isSafeInteger(amount) || amount <= 0))
      || (variableAmount && amount != null && (!Number.isSafeInteger(amount) || amount < 0))
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
      amount_cents: variableAmount ? null : amount
    };
    const competenceMonth = document.getElementById('entry-competence').value || null;
    if (competenceMonth) payload.competence_month = competenceMonth;
    document.getElementById('save-transaction').disabled = true;
    document.getElementById('save-message').textContent = 'Salvando...';

    let result;
    const currentMonthStart = (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    })();
    const targetMonthStart = state.controlMonthKey ?? currentMonthStart;
    const transactionDate = targetMonthStart === currentMonthStart
      ? localDate(new Date())
      : targetMonthStart;
    if (selectedFrequency === 'once') {
      const duplicate = amount == null
        ? null
        : await findDuplicateTransaction({ title, amountCents: amount, transactionDate, transactionType });
      if (duplicate) {
        const [day, month, year] = transactionDate.split('-').reverse().map(Number);
        const prettyDate = new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day));
        const confirmed = window.confirm(
          `Já existe ${transactionType === 'income' ? 'uma receita' : 'uma despesa'} igual: `
          + `"${duplicate.title}" de ${formatMoney(Number(duplicate.amount_cents))} em ${prettyDate}.`
          + '\n\nLançar de novo?'
        );
        if (!confirmed) {
          document.getElementById('save-transaction').disabled = false;
          document.getElementById('save-message').textContent = 'Lançamento repetido não foi salvo.';
          showToast('Nada foi duplicado.');
          return;
        }
      }
      result = await supabase.from('transactions').insert({
          ...payload,
          transaction_date: transactionDate
        });
      if (result.error && isMissingColumnError(result.error, 'competence_month')) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.competence_month;
        result = await supabase.from('transactions').insert({
          ...fallbackPayload,
          transaction_date: transactionDate
        });
      }
    } else {
      const matchingTemplate = state.recurringItems.find(template =>
        template.transaction_type === transactionType
        && template.frequency === selectedFrequency
        && normalizeControlName(template.title) === normalizeControlName(title));
      await deactivateDuplicateTemplates({
        templateId: matchingTemplate?.id ?? null,
        itemName: title,
        transactionType,
        controlGroup: transactionType === 'income'
          ? 'income'
          : monthlyControlGroupForCardItem(budgetGroup),
        frequency: selectedFrequency
      });
      let templateId = matchingTemplate?.id ?? null;
      if (matchingTemplate) {
        result = await supabase.from('recurring_items')
          .update({
            title: payload.title,
            category: payload.category,
            subcategory: payload.subcategory,
            budget_group: transactionType === 'expense' ? budgetGroup : null,
            amount_cents: variableAmount ? null : amount,
            amount_behavior: variableAmount ? 'variable' : 'fixed',
            month_of_year: selectedFrequency === 'yearly'
              ? Number(document.getElementById('transaction-month').value)
              : null,
            active: true
          })
          .eq('id', matchingTemplate.id)
          .eq('household_id', state.membership.household_id);
      } else {
        result = await supabase.from('recurring_items').insert({
            household_id: payload.household_id,
            created_by: payload.created_by,
            title: payload.title,
            transaction_type: payload.transaction_type,
            category: payload.category,
            subcategory: payload.subcategory,
            budget_group: transactionType === 'expense' ? budgetGroup : null,
            amount_cents: variableAmount ? null : amount,
            amount_behavior: variableAmount ? 'variable' : 'fixed',
            frequency: selectedFrequency,
            starts_month: targetMonthStart,
            day_of_month: new Date().getDate(),
            month_of_year: selectedFrequency === 'yearly'
              ? Number(document.getElementById('transaction-month').value)
              : null
          }).select('id').single();
        templateId = result.data?.id ?? null;
      }
      if (!result.error && templateId) {
        const { error: ensureError } = await supabase.rpc('ensure_monthly_control_items', {
          target_month_start: targetMonthStart
        });
        if (ensureError) {
          result = { error: ensureError };
        } else if (selectedFrequency === 'monthly' && amount != null) {
          const monthError = await applyMonthlyControlUpdate(
            {
              amount_cents: amount,
              ...(transactionType === 'income' && {
                income_behavior: variableAmount ? 'variable' : 'fixed'
              })
            },
            query => query
              .eq('recurring_item_id', templateId)
              .eq('month_start', targetMonthStart)
              .eq('household_id', state.membership.household_id)
          );
          if (monthError) result = { error: monthError };
        }
      }
    }
    document.getElementById('save-transaction').disabled = false;

    if (result.error) {
      console.error('Could not save household entry:', result.error.message);
      document.getElementById('save-message').textContent = result.error.code === '23505'
        ? 'Já existe um item fixo com esse nome. Ajuste o modelo em Fixos.'
        : 'Não foi possível salvar. Tente novamente.';
      return;
    }

    document.getElementById('transaction-amount').value = '';
    document.getElementById('transaction-title').value = '';
    document.getElementById('entry-category').value = '';
    document.getElementById('entry-subcategory').value = '';
    document.getElementById('entry-variable-amount').checked = false;
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
      income: 'Nenhuma receita recorrente cadastrada.',
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
        const amountLabel = item.amount_behavior === 'variable'
          ? 'Valor definido a cada mês'
          : item.amount_cents == null ? 'Valor pendente' : formatMoney(Number(item.amount_cents));
        subtitle.textContent = `${schedule} · ${classification} · ${amountLabel}`;
        info.append(title, subtitle);
        const tags = document.createElement('div');
        tags.className = 'control-row-tags';
        const behavior = document.createElement('span');
        behavior.className = 'recurring-tag';
        const isIncome = item.transaction_type === 'income';
        behavior.textContent = item.amount_behavior === 'variable'
          ? isIncome ? 'Receita variável' : 'Despesa variável'
          : isIncome ? 'Receita fixa' : 'Despesa fixa';
        tags.append(behavior);
        if (!item.active) {
          const paused = document.createElement('span');
          paused.className = 'recurring-tag paused';
          paused.textContent = 'Repetição pausada';
          tags.append(paused);
        }
        info.append(tags);
        if (item.amount_behavior === 'fixed') {
          const amountInput = document.createElement('input');
          amountInput.className = 'form-input';
          amountInput.inputMode = 'decimal';
          amountInput.placeholder = 'Valor mensal';
          amountInput.value = item.amount_cents == null
            ? ''
            : (Number(item.amount_cents) / 100).toFixed(2).replace('.', ',');
          amountInput.setAttribute('aria-label', `Valor mensal de ${item.title}`);
          const saveAmount = document.createElement('button');
          saveAmount.className = 'recurring-amount-save';
          saveAmount.type = 'button';
          saveAmount.textContent = 'Salvar valor';
          saveAmount.addEventListener('click', () => fillRecurringAmount(item, amountInput.value, saveAmount));
          info.append(amountInput, saveAmount);
        }
        const actions = document.createElement('div');
        actions.className = 'recurring-actions';
        const toggleBehavior = document.createElement('button');
        toggleBehavior.className = 'recurring-action';
        toggleBehavior.type = 'button';
        toggleBehavior.textContent = item.amount_behavior === 'variable'
          ? 'Marcar como fixa'
          : 'Marcar como variável';
        toggleBehavior.setAttribute('aria-label', `${toggleBehavior.textContent} ${item.title}`);
        toggleBehavior.addEventListener('click', () => toggleRecurringAmountBehavior(item));
        actions.append(toggleBehavior);
        const toggleActive = document.createElement('button');
        toggleActive.className = 'recurring-action';
        toggleActive.type = 'button';
        toggleActive.textContent = item.active ? 'Pausar repetição' : 'Reativar repetição';
        toggleActive.setAttribute('aria-label', `${toggleActive.textContent} de ${item.title}`);
        toggleActive.addEventListener('click', () => toggleRecurringActive(item));
        actions.append(toggleActive);
        const remove = document.createElement('button');
        remove.className = 'remove-member';
        remove.type = 'button';
        remove.textContent = 'Remover';
        remove.setAttribute('aria-label', `Remover ${item.title}`);
        remove.addEventListener('click', () => deleteRecurringItem(item));
        actions.append(remove);
        row.append(info, actions);
        targets[group].append(row);
      }
    }
  }

  async function toggleRecurringAmountBehavior(item) {
    const nextBehavior = item.amount_behavior === 'variable' ? 'fixed' : 'variable';
    if (nextBehavior === 'fixed' && item.amount_cents == null) {
      showToast('Preencha o valor mensal antes de marcar este item como fixo.');
      return;
    }
    const { error } = await supabase.from('recurring_items')
      .update({ amount_behavior: nextBehavior })
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not change recurring amount behavior:', error.message);
      showToast('Não foi possível alterar a classificação do item.');
      return;
    }
    if (item.transaction_type === 'income') {
      const { error: monthlyError } = await supabase.from('monthly_control_items')
        .update({ income_behavior: nextBehavior })
        .eq('recurring_item_id', item.id)
        .gte('month_start', state.controlMonthKey)
        .eq('household_id', state.membership.household_id);
      if (monthlyError) {
        console.error('Could not update income behavior for monthly items:', monthlyError.message);
        showToast('O modelo foi atualizado, mas os meses seguintes precisam ser recarregados.');
        return;
      }
    }
    showToast(nextBehavior === 'fixed'
      ? 'Item marcado como fixo.'
      : 'Item marcado como variável.');
    await loadHouseholdData();
  }

  async function toggleRecurringActive(item) {
    const nextActive = !item.active;
    if (!nextActive && !window.confirm(`Pausar a repetição de "${item.title}"? Os lançamentos já registrados continuam no histórico.`)) {
      return;
    }
    const { error } = await supabase.from('recurring_items')
      .update({ active: nextActive })
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      console.error('Could not change recurring activation:', error.message);
      showToast('Não foi possível alterar a repetição deste item.');
      return;
    }
    if (!nextActive) {
      const { error: futureError } = await supabase.from('monthly_control_items')
        .delete()
        .eq('recurring_item_id', item.id)
        .gt('month_start', state.controlMonthKey)
        .eq('household_id', state.membership.household_id);
      if (futureError) {
        console.warn('Could not remove future monthly items:', futureError.message);
      }
    }
    showToast(nextActive
      ? 'Repetição reativada; o item volta a aparecer nos próximos meses.'
      : 'Repetição pausada; os meses seguintes deixam de ser gerados.');
    await loadHouseholdData();
  }

  async function fillRecurringAmount(item, rawAmount, button) {
    const amount = parseAmount(rawAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast('Informe um valor maior que zero.');
      return;
    }
    if (button) button.disabled = true;
    const { error } = await supabase.from('recurring_items')
      .update({ amount_cents: amount })
      .eq('id', item.id)
      .eq('household_id', state.membership.household_id);
    if (error) {
      if (button) button.disabled = false;
      console.error('Could not set recurring item amount:', error.message);
      showToast('Não foi possível salvar o valor.');
      return;
    }
    const { error: monthlyError } = await supabase.from('monthly_control_items')
      .update({ amount_cents: amount, updated_at: new Date().toISOString() })
      .eq('recurring_item_id', item.id)
      .gte('month_start', state.controlMonthKey)
      .eq('household_id', state.membership.household_id);
    if (monthlyError) {
      console.warn('Could not update monthly items from the template:', monthlyError.message);
    }
    showToast('Valor mensal atualizado.');
    await loadHouseholdData();
  }

  async function deleteRecurringItem(item) {
    if (!window.confirm(`Remover o modelo "${item.title}"? Os lançamentos já registrados continuam no histórico.`)) {
      return;
    }
    const householdId = state.membership.household_id;
    const { error: futureError } = await supabase.from('monthly_control_items')
      .delete()
      .eq('recurring_item_id', item.id)
      .gt('month_start', state.controlMonthKey)
      .eq('household_id', householdId);
    if (futureError) {
      console.warn('Could not remove future monthly items before deleting the template:', futureError.message);
    }
    const { error } = await supabase
      .from('recurring_items')
      .delete()
      .eq('id', item.id)
      .eq('household_id', householdId);
    if (error) {
      console.error('Could not delete recurring item:', error.message);
      showToast('Não foi possível remover o item.');
      return;
    }
    showToast('Modelo removido.');
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

    const currentRows = state.monthlyControlItems.filter(item =>
      item.month_start === monthStart && !item.is_skipped);
    const groups = {
      income: { list: 'control-income-list', total: 'control-income-total', rows: [] },
      fixed: { list: 'control-fixed-list', total: 'control-fixed-total', rows: [] },
      variable: { list: 'control-variable-list', total: 'control-variable-total', rows: [] },
      additional: { list: 'control-additional-list', total: 'control-additional-total', rows: [] }
    };
    for (const item of currentRows) groups[item.control_group]?.rows.push(item);
    const monthlyEntries = financialEntriesForMonth(monthKey);
    const detailEntries = monthlyEntries.filter(item =>
      item.payment_method === 'credit' || item.source_transaction_id);
    for (const item of detailEntries) {
      const groupKey = item.transaction_type === 'income'
        ? 'income'
        : monthlyControlGroupForCardItem(item.budget_group);
      groups[groupKey].cardRows ??= [];
      groups[groupKey].cardRows.push(item);
    }

    for (const [groupName, group] of Object.entries(groups)) {
      const list = document.getElementById(group.list);
      list.replaceChildren();
      let total = 0;
      if (!group.rows.length && !group.cardRows?.length) {
        appendEmptyState(list, 'Nenhum item neste grupo. Adicione acima ou traga os nomes do mês anterior.');
      }
      for (const item of group.rows) {
        total += Number(item.amount_cents ?? 0);
        const recurring = state.recurringItems.find(template => template.id === item.recurring_item_id);
        const previousDate = new Date(`${monthStart}T12:00:00`);
        previousDate.setMonth(previousDate.getMonth() - 1);
        const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-01`;
        const previousAmount = item.recurring_item_id
          ? state.monthlyControlItems.find(row =>
            row.recurring_item_id === item.recurring_item_id
            && row.month_start === previousMonth
            && !row.is_skipped
            && row.amount_cents != null)?.amount_cents
          : null;
        const behavior = item.transaction_type === 'income'
          ? recurring ? item.income_behavior ?? recurring.amount_behavior ?? 'variable' : 'fixed'
          : recurring?.amount_behavior ?? (item.control_group === 'fixed' ? 'fixed' : 'variable');
        const isVariable = Boolean(recurring) && behavior === 'variable';
        const isRecurring = Boolean(recurring?.active);

        const row = document.createElement('div');
        row.className = 'control-row';
        const description = document.createElement('div');
        description.className = 'control-row-description';
        const name = document.createElement('div');
        name.className = 'control-row-name';
        name.textContent = item.item_name;
        const tags = document.createElement('div');
        tags.className = 'control-row-tags';
        const type = document.createElement('span');
        type.className = 'recurring-tag';
        type.textContent = item.transaction_type === 'income'
          ? isRecurring
            ? isVariable ? 'Receita variável · valor do mês' : 'Receita fixa · repete mensalmente'
            : 'Receita avulsa deste mês'
          : isRecurring
            ? isVariable ? 'Variável · preencher a cada mês' : 'Fixo · repete mensalmente'
            : 'Lançamento único';
        tags.append(type);
        description.append(name, tags);
        if (isVariable && previousAmount != null) {
          const estimate = document.createElement('span');
          estimate.className = 'control-previous-amount';
          estimate.textContent = `Último valor: ${formatMoney(Number(previousAmount))}`;
          description.append(estimate);
        }
        const value = document.createElement('strong');
        value.className = 'control-row-value';
        if (item.amount_cents == null) {
          value.classList.add('pending');
          value.textContent = 'Definir';
        } else {
          value.textContent = formatMoney(Number(item.amount_cents));
        }
        const actions = document.createElement('div');
        actions.className = 'control-row-actions';
        const adjust = document.createElement('button');
        adjust.type = 'button';
        adjust.className = 'control-row-adjust';
        adjust.textContent = 'Ajustar';
        adjust.setAttribute('aria-label', `Ajustar ${item.item_name}`);
        adjust.addEventListener('click', () => openControlItemDialog(item));
        actions.append(adjust);
        row.append(description, value, actions);
        list.append(row);
      }
      for (const item of group.cardRows ?? []) {
        total += Number(item.amount_cents);
        const row = document.createElement('div');
        row.className = 'control-card-item';
        const info = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = item.title;
        const subtitle = document.createElement('div');
        subtitle.className = 'subtitle';
        const installment = item.installment_number
          ? ` · Parcela ${item.installment_number}/${item.installment_total}`
          : '';
        const forecast = item.is_forecast ? ' · Prevista' : '';
        const origin = item.card_label ?? item.category;
        const competenceTag = item.competence_month
          ? ` · competência ${formatMonthKey(item.competence_month)}`
          : '';
        subtitle.textContent =
          `${origin ?? 'Lançamento'} · ${formatDate(item.display_date ?? item.transaction_date)}${installment}${forecast}${competenceTag}`;
        info.append(title, subtitle);
        const actions = document.createElement('div');
        actions.className = 'control-card-item-actions';
        const amount = document.createElement('strong');
        amount.textContent = formatMoney(item.amount_cents);
        actions.append(amount);
        if (item.transaction_type === 'expense') {
          const move = document.createElement('select');
          move.className = 'form-input';
          move.setAttribute('aria-label', `Grupo de ${item.title}`);
          for (const [value, label] of [
            ['fixed', 'Fixo'],
            ['variable', 'Variável'],
            ['additional', 'Adicional']
          ]) move.add(new Option(label, value));
          move.value = monthlyControlGroupForCardItem(item.budget_group);
          move.addEventListener('change', () =>
            updateCardItemControlGroup(item, move.value, move));
          actions.append(move);
        }
        if (item.source_transaction_id) {
          const monthButton = document.createElement('button');
          monthButton.type = 'button';
          monthButton.className = 'control-row-month';
          monthButton.textContent = 'Mês';
          monthButton.setAttribute('aria-label', `Mudar o mês de competência de ${item.title}`);
          monthButton.addEventListener('click', () => openTransactionDialog(item));
          actions.append(monthButton);
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'control-row-remove';
          remove.textContent = '×';
          remove.setAttribute('aria-label', `Remover ${item.title} do extrato`);
          remove.addEventListener('click', () => deleteTransactionEntry(item));
          actions.append(remove);
        }
        row.append(info, actions);
        list.append(row);
      }
      document.getElementById(group.total).textContent = formatMoney(total);
    }

    const cardList = document.getElementById('control-cards-list');
    cardList.replaceChildren();
    const statements = state.cardStatements.filter(statement => statement.due_date.startsWith(monthKey));
    const activeCards = state.creditCards.filter(card => card.active);
    const cardsWithStatements = new Set(statements.map(statement => statement.credit_card_id));
    const cardsToShow = [
      ...activeCards,
      ...state.creditCards.filter(card => !card.active && cardsWithStatements.has(card.id))
    ];
    let cardTotal = 0;
    if (!cardsToShow.length) {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'primary-btn card-list-cta';
      cta.textContent = 'Cadastrar meu primeiro cartão';
      cta.addEventListener('click', () => openCardFormDialog('cards'));
      cardList.append(cta);
    }
    for (const card of cardsToShow) {
      const cardStatements = statements.filter(statement => statement.credit_card_id === card.id);
      const purchasesTotal = cardStatements.reduce((sum, statement) =>
        sum + state.cardStatementItems
          .filter(item => item.statement_id === statement.id && !isCardPayment(item.title))
          .reduce((itemSum, item) => itemSum + Number(item.amount_cents), 0), 0);
      const statementTotal = cardStatements.reduce((sum, statement) =>
        sum + (statement.statement_total_cents == null
          ? state.cardStatementItems
            .filter(item => item.statement_id === statement.id && !isCardPayment(item.title))
            .reduce((itemSum, item) => itemSum + Number(item.amount_cents), 0)
          : Number(statement.statement_total_cents)), 0);
      cardTotal += statementTotal;
      const row = document.createElement('div');
      row.className = 'payment-card-tile';
      const info = document.createElement('div');
      info.className = 'payment-card-info';
      const identity = document.createElement('div');
      identity.className = 'payment-card-identity';
      const icon = document.createElement('span');
      icon.className = 'payment-card-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '💳';
      const details = document.createElement('div');
      details.className = 'payment-card-details';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = card.label;
      const subtitle = document.createElement('div');
      subtitle.className = 'subtitle';
      subtitle.textContent = `${cardProviderPrefix(card)}${card.titular_name || 'Cartão cadastrado'}`;
      if (card.credit_limit_cents) {
        subtitle.textContent += ` · limite ${formatMoney(Number(card.credit_limit_cents))}`;
      }
      details.append(title, subtitle);
      identity.append(icon, details);
      info.append(identity);
      if (cardStatements.length) {
        const statementInfo = document.createElement('div');
        statementInfo.className = 'payment-card-statement';
        const amount = document.createElement('strong');
        amount.textContent = formatMoney(statementTotal);
        const label = document.createElement('span');
        const referenceMonth = getStatementReferenceMonth(cardStatements[0]);
        label.textContent = cardStatements.length === 1
          ? `Fatura de ${formatMonthKey(referenceMonth)} · vence ${formatDate(cardStatements[0].due_date)} · compras classificadas ${formatMoney(purchasesTotal)}`
          : `${cardStatements.length} faturas neste mês · compras classificadas ${formatMoney(purchasesTotal)}`;
        statementInfo.append(amount, label);
        info.append(statementInfo);
      } else {
        const statementInfo = document.createElement('div');
        statementInfo.className = 'payment-card-statement empty';
        statementInfo.textContent = 'Nenhuma fatura importada neste mês';
        info.append(statementInfo);
      }
      const actions = document.createElement('div');
      actions.className = 'payment-card-actions';
      const importButton = document.createElement('button');
      importButton.type = 'button';
      importButton.className = 'payment-card-import';
      importButton.textContent = cardStatements.length ? 'Atualizar fatura' : 'Importar fatura';
      importButton.setAttribute('aria-label', `${cardStatements.length ? 'Atualizar' : 'Importar'} fatura de ${card.label}`);
      importButton.addEventListener('click', () => openCardImport(card.id));
      const historyButton = document.createElement('button');
      historyButton.type = 'button';
      historyButton.className = 'payment-card-history';
      historyButton.textContent = 'Histórico';
      historyButton.addEventListener('click', () => {
        window.showScreen('recurring');
        window.setTimeout(() => {
          document.getElementById('card-statement-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      });
      const expenseButton = document.createElement('button');
      expenseButton.type = 'button';
      expenseButton.className = 'payment-card-history';
      expenseButton.textContent = '+ Lançar compra';
      expenseButton.setAttribute('aria-label', `Lançar uma compra no ${card.label}`);
      expenseButton.addEventListener('click', () => window.openSheet('card', card.id));
      actions.append(importButton, expenseButton, historyButton);
      row.append(info, actions);
      cardList.append(row);
    }
    document.getElementById('control-cards-total').textContent = formatMoney(cardTotal);
    const summary = renderMonthlySummary(monthKey);
    renderIncomeCommitment(summary);
    renderUpcomingStatementBanner(monthKey);
    renderSpendingBreakdown(monthKey);
    renderFutureForecast(monthKey);
    const copyButton = document.getElementById('copy-control-items');
    copyButton.disabled = false;
    copyButton.textContent = 'Trazer os itens que faltam do mês anterior';
    const removedRows = state.monthlyControlItems.filter(item =>
      item.month_start === monthStart && item.is_skipped);
    const restoreButton = document.getElementById('restore-removed-items');
    restoreButton.hidden = removedRows.length === 0;
    restoreButton.textContent = removedRows.length === 1
      ? 'Restaurar 1 item removido deste mês'
      : `Restaurar ${removedRows.length} itens removidos deste mês`;
  }

  function renderMonthlySummary(monthKey) {
    const entries = financialEntriesForMonth(monthKey);
    const summary = calculateMonthlyCashFlow(
      entries,
      state.cardStatements,
      state.cardStatementItems,
      monthKey
    );
    document.getElementById('month-income').textContent = formatMoney(summary.income);
    document.getElementById('month-expenses').textContent = formatMoney(summary.expenses);
    document.getElementById('month-balance').textContent = formatMoney(summary.income - summary.expenses);

    const incomeDetail = document.getElementById('month-income-detail');
    if (incomeDetail) {
      const money = value => formatMoney(value).replace(/ /g, '\u00A0');
      incomeDetail.textContent =
        `Fixa\u00A0${money(summary.incomeFixed)} · Variável\u00A0${money(summary.incomeVariable)}`;
    }
    const expenseDetail = document.getElementById('month-expenses-detail');
    if (expenseDetail) {
      const money = value => formatMoney(value).replace(/ /g, '\u00A0');
      expenseDetail.textContent = [
        `Fixos\u00A0${money(summary.expensesFixed)}`,
        `Variáveis\u00A0${money(summary.expensesVariable)}`,
        `Faturas\u00A0${money(summary.cardExpenses)}`,
        `Parcelas futuras\u00A0${money(summary.forecastExpenses)}`
      ].join(' · ');
    }
    const balanceDetail = document.getElementById('month-balance-detail');
    if (balanceDetail) {
      balanceDetail.textContent = summary.income - summary.expenses >= 0
        ? 'Sobra prevista no mês'
        : 'Falta prevista no mês';
    }
    return summary;
  }

  function renderUpcomingStatementBanner(currentMonthKey) {
    const banner = document.getElementById('upcoming-statement-banner');
    if (!banner) return;
    const statements = state.cardStatements
      .filter(s => s.status !== 'paid')
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    if (!statements.length) {
      banner.hidden = true;
      return;
    }
    const currentPrefix = currentMonthKey.slice(0, 7);
    const statementInMonth = statements.find(s => s.due_date.startsWith(currentPrefix));
    const nextStatement = statementInMonth
      || statements.find(s => s.due_date >= localDate(new Date()))
      || statements[0];
    if (!nextStatement) {
      banner.hidden = true;
      return;
    }
    const card = state.creditCards.find(c => c.id === nextStatement.credit_card_id);
    const cardLabel = card?.label ?? 'Cartão';
    const amount = nextStatement.statement_total_cents != null
      ? Number(nextStatement.statement_total_cents)
      : state.cardStatementItems
        .filter(i => i.statement_id === nextStatement.id && !isCardPayment(i.title))
        .reduce((sum, i) => sum + Number(i.amount_cents), 0);

    const statementMonth = nextStatement.due_date.slice(0, 7);
    const [, , dueMonth, dueDay] = nextStatement.due_date.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? [];
    const formattedDate = `${dueDay}/${dueMonth}`;
    const titleEl = document.getElementById('statement-banner-title');
    const subtitleEl = document.getElementById('statement-banner-subtitle');
    const btnEl = document.getElementById('statement-banner-btn');

    if (statementMonth === currentPrefix) {
      titleEl.textContent = `Fatura ${cardLabel} · ${formatMoney(amount)}`;
      subtitleEl.textContent = `Vence dia ${formattedDate} · Valor a pagar contabilizado neste mês`;
      if (btnEl) btnEl.style.display = 'none';
    } else {
      const targetMonthDate = new Date(`${statementMonth}-01T12:00:00`);
      const targetMonthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(targetMonthDate);
      titleEl.textContent = `Fatura ${cardLabel} em aberto · ${formatMoney(amount)}`;
      subtitleEl.textContent = `Vence dia ${formattedDate} · Sai da receita de ${targetMonthName}`;
      if (btnEl) {
        btnEl.style.display = '';
        btnEl.textContent = `Ver em ${targetMonthName} ›`;
        btnEl.onclick = () => {
          if (window.setControlMonthKey) window.setControlMonthKey(`${statementMonth}-01`);
        };
      }
    }
    banner.hidden = false;
  }

  function renderIncomeCommitment(summary) {
    const card = document.getElementById('income-commitment-card');
    if (!card) return;
    const pctEl = document.getElementById('income-commitment-percentage');
    const fillEl = document.getElementById('income-commitment-bar-fill');
    const detailEl = document.getElementById('income-commitment-detail');
    const freeEl = document.getElementById('income-commitment-free');

    if (summary.income <= 0 && summary.expenses <= 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    if (summary.income > 0) {
      const percentage = Math.round((summary.expenses / summary.income) * 100);
      pctEl.textContent = `${percentage}%`;
      fillEl.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
      fillEl.className = 'income-commitment-bar-fill ' + (percentage <= 70 ? 'safe' : percentage <= 90 ? 'moderate' : 'danger');
      detailEl.textContent = `${formatMoney(summary.expenses)} de custos previstos`;
      const balance = summary.income - summary.expenses;
      if (balance >= 0) {
        freeEl.textContent = `${formatMoney(balance)} livre`;
        freeEl.className = 'free-badge';
      } else {
        freeEl.textContent = `Falta ${formatMoney(Math.abs(balance))}`;
        freeEl.className = 'free-badge negative';
      }
    } else {
      pctEl.textContent = '100%+';
      fillEl.style.width = '100%';
      fillEl.className = 'income-commitment-bar-fill danger';
      detailEl.textContent = `${formatMoney(summary.expenses)} de custos sem receita cadastrada`;
      freeEl.textContent = `Falta ${formatMoney(summary.expenses)}`;
      freeEl.className = 'free-badge negative';
    }
  }

  function renderSpendingBreakdown(monthKey) {
    const list = document.getElementById('spending-breakdown-list');
    const monthTag = document.getElementById('breakdown-month-tag');
    if (!list) return;
    const monthDate = new Date(`${monthKey}-01T12:00:00`);
    if (monthTag) {
      monthTag.textContent = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(monthDate);
    }
    const entries = financialEntriesForMonth(monthKey).filter(item => item.transaction_type === 'expense');
    if (!entries.length) {
      list.innerHTML = '<div class="empty-state">Nenhum gasto ou compra registrado neste mês.</div>';
      return;
    }
    const categoryTotals = new Map();
    for (const item of entries) {
      const cat = item.category || 'Outros';
      const cur = categoryTotals.get(cat) || { total: 0, count: 0 };
      cur.total += Number(item.amount_cents || 0);
      cur.count += 1;
      categoryTotals.set(cat, cur);
    }
    const sorted = [...categoryTotals.entries()].sort((a, b) => b[1].total - a[1].total);
    const maxTotal = sorted[0]?.[1].total || 1;
    const totalExpenses = sorted.reduce((sum, [, data]) => sum + data.total, 0) || 1;

    list.replaceChildren();
    for (const [category, data] of sorted) {
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      const top = document.createElement('div');
      top.className = 'breakdown-row-top';
      const name = document.createElement('div');
      name.className = 'breakdown-cat-name';
      const icon = categoryIcons[category] ?? '📦';
      name.innerHTML = `<span>${icon}</span> <span>${category}</span> <span class="breakdown-cat-count">(${data.count} ${data.count === 1 ? 'item' : 'itens'})</span>`;
      const values = document.createElement('div');
      values.className = 'breakdown-cat-values';
      const pct = Math.round((data.total / totalExpenses) * 100);
      values.innerHTML = `${formatMoney(data.total)} <span class="breakdown-cat-pct">${pct}%</span>`;
      top.append(name, values);

      const barBg = document.createElement('div');
      barBg.className = 'breakdown-bar-bg';
      const barFill = document.createElement('div');
      barFill.className = 'breakdown-bar-fill';
      const fillWidth = Math.max(4, Math.round((data.total / maxTotal) * 100));
      barFill.style.width = `${fillWidth}%`;
      barBg.append(barFill);

      row.append(top, barBg);
      list.append(row);
    }
  }

  function renderFutureForecast(currentMonthKey) {
    const container = document.getElementById('forecast-timeline-list');
    if (!container) return;
    const baseDate = new Date();
    baseDate.setDate(1);
    const months = Array.from({ length: 4 }, (_, i) => {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    container.replaceChildren();
    for (const mKey of months) {
      const entries = financialEntriesForMonth(mKey);
      const summary = calculateMonthlyCashFlow(entries, state.cardStatements, state.cardStatementItems, mKey);
      const monthDate = new Date(`${mKey}-01T12:00:00`);
      const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(monthDate);
      const balance = summary.income - summary.expenses;

      const card = document.createElement('div');
      card.className = 'forecast-month-card';
      if (mKey === currentMonthKey) {
        card.style.borderColor = 'var(--accent)';
      }
      card.addEventListener('click', () => {
        if (window.setControlMonthKey) window.setControlMonthKey(`${mKey}-01`);
      });

      const info = document.createElement('div');
      info.className = 'forecast-month-info';
      const title = document.createElement('div');
      title.className = 'forecast-month-name';
      title.textContent = monthName;
      const meta = document.createElement('div');
      meta.className = 'forecast-month-meta';
      const cardNote = summary.cardExpenses > 0 ? ` · Fatura ${formatMoney(summary.cardExpenses)}` : '';
      const forecastNote = summary.forecastExpenses > 0 ? ` · Parcelas futuras ${formatMoney(summary.forecastExpenses)}` : '';
      meta.textContent = `Receita ${formatMoney(summary.income)} · Custos ${formatMoney(summary.expenses)}${cardNote}${forecastNote}`;
      info.append(title, meta);

      const balanceDiv = document.createElement('div');
      balanceDiv.className = 'forecast-month-balance';
      const val = document.createElement('strong');
      val.textContent = formatMoney(balance);
      const tag = document.createElement('span');
      tag.className = 'forecast-tag ' + (balance >= 0 ? 'surplus' : 'deficit');
      tag.textContent = balance >= 0 ? 'Sobra' : 'Falta';
      balanceDiv.append(val, tag);

      card.append(info, balanceDiv);
      container.append(card);
    }
  }

  async function addMonthlyControlItem(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const itemName = form.elements.item_name.value.trim();
    const groupInput = form.dataset.controlGroup;
    const autoClassify = groupInput === 'auto';
    const rawAmount = form.elements.amount.value.trim();
    const amountCents = rawAmount ? parseAmount(rawAmount) : null;
    const repeatMonthly = form.elements.repeat_monthly.checked;
    const variableAmount = repeatMonthly && Boolean(form.elements.variable_amount?.checked);
    if (!itemName || itemName.length > 120
      || (!autoClassify && !['income', 'fixed', 'variable', 'additional'].includes(groupInput))
      || (rawAmount && (!Number.isSafeInteger(amountCents) || amountCents < 0))
      || (repeatMonthly && !variableAmount && (!Number.isSafeInteger(amountCents) || amountCents <= 0))) {
      reportControlMessage('Informe o nome e um valor válido (ou deixe o valor em branco).');
      return;
    }
    const transactionType = autoClassify
      ? quickAddType
      : groupInput === 'income' ? 'income' : 'expense';
    const classification = autoClassify && transactionType === 'expense' ? classifyExpense(itemName) : null;
    const controlGroup = autoClassify
      ? (transactionType === 'income' ? 'income' : classification.group)
      : groupInput;
    const groupLabel = transactionType === 'income' ? 'Receitas' : expenseGroupLabel(controlGroup);
    const reasonLabel = CLASSIFICATION_REASONS[classification?.reason] ?? '';
    if (submitButton) submitButton.disabled = true;
    setMessage('monthly-control-message', '');
    try {
      const { data: monthRows, error: rowsError } = await supabase.from('monthly_control_items')
        .select('id, item_name, is_skipped, recurring_item_id')
        .eq('household_id', state.membership.household_id)
        .eq('month_start', state.controlMonthKey)
        .eq('control_group', controlGroup);
      if (rowsError) throw rowsError;
      const normalized = normalizeControlName(itemName);
      const existingRow = (monthRows ?? []).find(row => normalizeControlName(row.item_name) === normalized);

      if (existingRow && !existingRow.is_skipped) {
        reportControlMessage(`Esse item já existe em ${groupLabel} neste mês. Edite o valor na lista abaixo.`);
        return;
      }

      if (repeatMonthly) {
        const amountBehavior = variableAmount ? 'variable' : 'fixed';
        const { id: templateId, error: templateError } = await saveRecurringTemplate({
          template: findRecurringTemplate(transactionType, controlGroup, itemName),
          itemName,
          transactionType,
          controlGroup,
          amountCents,
          amountBehavior
        });
        if (templateError || !templateId) throw templateError ?? new Error('model not created');
        const { error: ensureError } = await supabase.rpc('ensure_monthly_control_items', {
          target_month_start: state.controlMonthKey
        });
        if (ensureError) {
          console.warn('Could not prepare the month from the recurring template:', ensureError.message);
        }
        const rowError = await linkOrCreateMonthRow({
          existingRow,
          templateId,
          itemName,
          controlGroup,
          transactionType,
          amountCents,
          incomeBehavior: transactionType === 'income' ? amountBehavior : null
        });
        if (rowError) throw rowError;
        form.reset();
        setMessage('monthly-control-message', existingRow
          ? `Item restaurado em ${groupLabel}${reasonLabel ? ` (${reasonLabel})` : ''} e fixado para os próximos meses.`
          : `Item fixo salvo em ${groupLabel}${reasonLabel ? ` (${reasonLabel})` : ''}; ele aparecerá automaticamente nos próximos meses.`);
        showToast(existingRow
          ? `Item restaurado em ${groupLabel} e fixado para os próximos meses.`
          : `Item fixo salvo em ${groupLabel}; ele aparecerá nos próximos meses.`);
        await loadHouseholdData();
        return;
      }

      let error;
      if (existingRow) {
        error = await applyMonthlyControlUpdate(
          {
            item_name: itemName,
            amount_cents: amountCents,
            is_skipped: false,
            recurring_item_id: null,
            income_behavior: null,
            updated_at: new Date().toISOString()
          },
          query => query
            .eq('id', existingRow.id)
            .eq('household_id', state.membership.household_id)
        );
      } else {
        error = await insertMonthRow({
          household_id: state.membership.household_id,
          month_start: state.controlMonthKey,
          item_name: itemName,
          transaction_type: transactionType,
          control_group: controlGroup,
          amount_cents: amountCents,
          income_behavior: null,
          created_by: state.user.id
        });
      }
      if (error) throw error;
      form.reset();
      setMessage('monthly-control-message', existingRow
        ? `Item restaurado em ${groupLabel}${reasonLabel ? ` (${reasonLabel})` : ''}.`
        : `Item adicionado em ${groupLabel}${reasonLabel ? ` (${reasonLabel})` : ''}.`);
      showToast(existingRow
        ? `Item restaurado em ${groupLabel}.`
        : `Item adicionado em ${groupLabel}.`);
      await refreshControlState();
    } catch (error) {
      console.error('Could not add monthly control item:', error?.message ?? error);
      const recurringConflict = String(error?.message ?? '').includes('recurring_items');
      reportControlMessage(error?.code === '23505'
        ? recurringConflict
          ? 'Já existe um item fixo com esse nome. Ajuste o modelo em Fixos.'
          : 'Já existe um item com esse nome neste grupo do mês.'
        : 'Não foi possível adicionar o item. Tente novamente.');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  function reportControlMessage(message) {
    setMessage('monthly-control-message', message);
    if (message) showToast(message);
  }

  const PAYMENT_METHOD_LABELS = {
    cash: 'Dinheiro',
    debit: 'Débito',
    credit: 'Cartão de crédito',
    transfer: 'Transferência/Pix',
    other: 'Outro'
  };

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function fetchAllHouseholdTransactions() {
    const columns = 'id, created_by, title, transaction_type, category, subcategory, budget_group, payment_method, credit_card_id, amount_cents, transaction_date, created_at';
    const attempt = select => supabase.from('transactions')
      .select(select)
      .eq('household_id', state.membership.household_id)
      .order('transaction_date', { ascending: false });
    const withCompetence = await attempt(`${columns}, competence_month`);
    if (!withCompetence.error) return withCompetence.data ?? [];
    const fallback = await attempt(columns);
    if (fallback.error) throw fallback.error;
    return (fallback.data ?? []).map(item => ({ ...item, competence_month: null }));
  }

  async function exportHouseholdBackup() {
    const householdId = state.membership?.household_id;
    if (!householdId) return;
    const button = document.getElementById('export-backup-json');
    button.disabled = true;
    setMessage('backup-message', 'Preparando o backup...');
    try {
      const transactions = await fetchAllHouseholdTransactions();
      const backup = buildBackup({
        exportedAt: new Date().toISOString(),
        household: {
          id: householdId,
          name: document.getElementById('settings-household-name').textContent.trim() || null
        },
        members: state.members.map(member => ({
          user_id: member.user_id,
          email: member.email,
          role: member.role
        })),
        financeCategories: state.financeCategories,
        budgetTargets: state.budgetTargets,
        reserveMovements: state.reserveMovements,
        creditCards: state.creditCards,
        cardStatements: state.cardStatements,
        cardStatementItems: state.cardStatementItems,
        recurringItems: state.recurringItems,
        monthlyControlItems: state.monthlyControlItems,
        transactions
      });
      downloadFile(
        `${backupFileName('casa-em-dia-backup')}.json`,
        JSON.stringify(backup, null, 2),
        'application/json'
      );
      setMessage('backup-message',
        `Backup gerado com ${transactions.length} lançamentos do extrato e ${state.monthlyControlItems.length} itens mensais.`);
      showToast('Backup completo baixado.');
    } catch (error) {
      console.error('Could not build the household backup:', error?.message ?? error);
      setMessage('backup-message', 'Não foi possível gerar o backup. Tente novamente.');
    } finally {
      button.disabled = false;
    }
  }

  function controlBehaviorCsvLabel(row) {
    const template = state.recurringItems.find(item => item.id === row.recurring_item_id);
    if (!template) return 'Sem repetição';
    if (!template.active) return 'Repetição encerrada';
    const behavior = row.transaction_type === 'income'
      ? row.income_behavior ?? template.amount_behavior
      : template.amount_behavior;
    return behavior === 'fixed' ? 'Fixa' : 'Variável';
  }

  function exportMonthlyItemsCsv() {
    const rows = [...state.monthlyControlItems].sort((left, right) =>
      left.month_start.localeCompare(right.month_start)
      || left.control_group.localeCompare(right.control_group)
      || left.item_name.localeCompare(right.item_name, 'pt-BR'));
    if (!rows.length) {
      setMessage('backup-message', 'Nenhum lançamento mensal para exportar.');
      return;
    }
    const columns = [
      { label: 'Mês', value: row => row.month_start.slice(0, 7) },
      { label: 'Tipo', value: row => row.transaction_type === 'income' ? 'Receita' : 'Despesa' },
      {
        label: 'Grupo',
        value: row => row.transaction_type === 'income' ? 'Receitas' : expenseGroupLabel(row.control_group)
      },
      { label: 'Item', value: row => row.item_name },
      { label: 'Valor (R$)', value: row => centsToCsv(row.amount_cents) },
      { label: 'Repetição', value: controlBehaviorCsvLabel },
      { label: 'Removido do mês', value: row => row.is_skipped ? 'Sim' : 'Não' }
    ];
    downloadFile(
      `${backupFileName('casa-em-dia-lancamentos')}.csv`,
      toCsv(columns, rows),
      'text/csv;charset=utf-8'
    );
    setMessage('backup-message', `${rows.length} lançamentos mensais exportados.`);
    showToast('CSV dos lançamentos mensais baixado.');
  }

  async function exportTransactionsCsv() {
    const button = document.getElementById('export-transactions-csv');
    button.disabled = true;
    setMessage('backup-message', 'Preparando o extrato...');
    try {
      const transactions = await fetchAllHouseholdTransactions();
      if (!transactions.length) {
        setMessage('backup-message', 'Nenhum lançamento de extrato para exportar.');
        return;
      }
      const columns = [
        { label: 'Data', value: row => row.transaction_date },
        { label: 'Descrição', value: row => row.title },
        { label: 'Tipo', value: row => row.transaction_type === 'income' ? 'Receita' : 'Despesa' },
        { label: 'Categoria', value: row => row.category },
        { label: 'Subcategoria', value: row => row.subcategory },
        { label: 'Forma de pagamento', value: row => PAYMENT_METHOD_LABELS[row.payment_method] ?? row.payment_method },
        { label: 'Valor (R$)', value: row => centsToCsv(row.amount_cents) }
      ];
      downloadFile(
        `${backupFileName('casa-em-dia-extrato')}.csv`,
        toCsv(columns, transactions),
        'text/csv;charset=utf-8'
      );
      setMessage('backup-message', `${transactions.length} lançamentos do extrato exportados.`);
      showToast('CSV do extrato baixado.');
    } catch (error) {
      console.error('Could not export the transaction list:', error?.message ?? error);
      setMessage('backup-message', 'Não foi possível exportar o extrato. Tente novamente.');
    } finally {
      button.disabled = false;
    }
  }

  async function copyPreviousMonthItems() {
    const month = new Date(`${state.controlMonthKey}T12:00:00`);
    const previous = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const previousMonthStart = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}-01`;
    let templates = state.monthlyControlItems.filter(item =>
      item.month_start === previousMonthStart && !item.is_skipped && !item.recurring_item_id);
    if (!templates.length) {
      const monthNumber = month.getMonth() + 1;
      templates = state.recurringItems
        .filter(item => item.active
          && (item.frequency === 'monthly'
            || (item.frequency === 'yearly' && item.month_of_year === monthNumber)))
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
        income_behavior: null,
        created_by: state.user.id
      }));
    if (!rows.length) {
      showToast(templates.length
        ? 'Não há novos itens para copiar.'
        : 'Não há itens anteriores. Adicione suas receitas e despesas acima.');
      return;
    }
    let { error } = await supabase.from('monthly_control_items').insert(rows);
    if (error && (error.code === '42703' || error.message?.includes('income_behavior'))) {
      const fallbackRows = rows.map(({ income_behavior, ...rest }) => rest);
      ({ error } = await supabase.from('monthly_control_items').insert(fallbackRows));
    }
    if (error) {
      console.error('Could not copy monthly control items:', error.message);
      showToast('Não foi possível copiar os itens do mês anterior.');
      return;
    }
    showToast(`${rows.length} itens copiados; os valores ficaram em branco para preencher.`);
    await refreshControlState();
  }

  function renderFinancialData() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const controlMonthKey = state.controlMonthKey?.slice(0, 7) ?? currentMonth;
    renderMonthlySummary(controlMonthKey);

    const selectedMonthDate = new Date(now.getFullYear(), now.getMonth() - (5 - state.insightsMonthIndex), 1);
    const selectedMonthKey = `${selectedMonthDate.getFullYear()}-${String(selectedMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const insightsTransactions = financialEntriesForMonth(selectedMonthKey);
    const insightSummary = calculateMonthlyCashFlow(
      insightsTransactions,
      state.cardStatements,
      state.cardStatementItems,
      selectedMonthKey
    );
    const insightIncome = insightSummary.income;
    const insightExpenses = insightSummary.expenses;
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

    const statementMonthKey = state.transactionsMonthKey ?? state.controlMonthKey?.slice(0, 7) ?? currentMonth;
    const statementMonthDate = new Date(`${statementMonthKey.slice(0, 7)}-01T12:00:00`);
    document.getElementById('transaction-month-label').textContent =
      new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(statementMonthDate);
    const recentEntries = [...state.transactions, ...allCardStatementEntries()]
      .filter(item => (item.display_date ?? item.transaction_date).startsWith(statementMonthKey.slice(0, 7)))
      .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
    renderTransactions(document.getElementById('all-transactions'), recentEntries);
    updateCharts(insightsTransactions);
  }

  function allCardStatementEntries() {
    return state.cardStatementItems.filter(item => !isCardPayment(item.title)).map(item => {
      const statement = state.cardStatements.find(row => row.id === item.statement_id);
      const card = state.creditCards.find(row => row.id === statement?.credit_card_id);
      // Usa o mês de COMPETÊNCIA da fatura (não o mês do vencimento).
      // Ex.: fatura com vencimento 07/11 → competência outubro (2026-10).
      const referenceMonth = statement
        ? getStatementReferenceMonth(statement)
        : item.purchase_date.slice(0, 7);
      return {
        ...item,
        source_item_id: item.id,
        statement_id: statement?.id,
        statement_due_date: statement?.due_date,
        due_month: referenceMonth,
        created_by: statement?.imported_by ?? null,
        transaction_type: 'expense',
        transaction_date: item.purchase_date,
        display_date: item.purchase_date,
        title: item.title,
        card_label: card?.label ?? 'Cartão',
        payment_method: 'credit',
        is_forecast: false
      };
    });
  }

  function isCardPayment(title) {
    return /^\s*pagamento(?:\s|$)/i.test(title);
  }

  function formatMonthKey(monthKey) {
    const [year, month] = String(monthKey ?? '').split('-').map(Number);
    if (!year || !month) return String(monthKey ?? '');
    return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' })
      .format(new Date(year, month - 1, 1));
  }

  function isCardPaymentTransaction(item) {
    if (item.transaction_type !== 'expense') return false;
    const title = String(item.title ?? '');
    return /fatura/i.test(title) && /^\s*pagamento/i.test(title);
  }

  function entryFinancialMonthKey(item) {
    return financialMonthKey(item.transaction_date, state.householdCutoffDay, item.competence_month ?? null);
  }

  function financialEntriesForMonth(monthKey) {
    const monthlyItems = state.monthlyControlItems.filter(item =>
      item.month_start.startsWith(monthKey) && !item.is_skipped);
    const representedTransactions = new Set(monthlyItems.map(item =>
      `${item.transaction_type}|${item.item_name.trim().toLocaleLowerCase('pt-BR')}`));
    const monthlyEntries = monthlyItems
      .filter(item => Number(item.amount_cents ?? 0) > 0)
      .map(item => {
        const recurring = state.recurringItems.find(template => template.id === item.recurring_item_id);
        const amountBehavior = item.transaction_type === 'income'
          ? item.income_behavior ?? recurring?.amount_behavior ?? 'variable'
          : recurring?.amount_behavior ?? (item.control_group === 'fixed' ? 'fixed' : 'variable');
        return {
          control_item_id: item.id,
          recurring_item_id: item.recurring_item_id,
          transaction_type: item.transaction_type,
          transaction_date: item.month_start,
          display_date: item.month_start,
          title: item.item_name,
          category: recurring?.category ?? item.item_name,
          subcategory: recurring?.subcategory ?? null,
          budget_group: recurring?.budget_group ?? (item.control_group === 'fixed' ? 'fixed'
            : item.control_group === 'additional' ? 'emergency'
              : item.control_group === 'variable' ? 'variable' : null),
          amount_behavior: amountBehavior,
          amount_cents: Number(item.amount_cents)
        };
      });
    const transactionEntries = state.transactions
      .filter(item => !isCardPaymentTransaction(item))
      .filter(item => entryFinancialMonthKey(item) === monthKey)
      .filter(item => !representedTransactions.has(
        `${item.transaction_type}|${item.title.trim().toLocaleLowerCase('pt-BR')}`))
      .map(item => ({
        ...item,
        source_transaction_id: item.id,
        display_date: item.transaction_date,
        amount_behavior: item.transaction_type === 'income'
          ? 'variable'
          : item.budget_group === 'fixed' ? 'fixed' : 'variable'
      }));
    const transactions = [...monthlyEntries, ...transactionEntries];
    // Filtra compras de cartão pelo mês de COMPETÊNCIA da fatura.
    const cardEntries = allCardStatementEntries().filter(item =>
      (item.due_month ?? item.transaction_date.slice(0, 7)) === monthKey);
    // Para previsão de parcelas: exclui cartões que já têm fatura de competência neste mês.
    const statementCardMonths = new Set(state.cardStatements
      .filter(statement => getStatementReferenceMonth(statement) === monthKey)
      .map(statement => statement.credit_card_id));
    const forecastEntries = getCardInstallmentForecast().filter(item =>
      item.month === monthKey
      && !statementCardMonths.has(item.credit_card_id));
    return [...transactions, ...cardEntries, ...forecastEntries];
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
      empty.textContent = 'Nenhuma movimentação neste mês.';
      container.append(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'list-item transaction-row';
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
      const member = state.members.find(person => person.user_id === item.created_by);
      const author = member ? memberDisplayName(member.email)
        : item.card_label ? 'Importado da fatura' : 'Membro da casa';
      const dateLabel = formatDate(item.display_date ?? item.transaction_date);
      const cardLabel = item.card_label ? ` · ${item.card_label}` : '';
      const subcategory = item.subcategory ? ` · ${item.subcategory}` : '';
      const competenceLabel = item.competence_month
        ? ` · competência ${formatMonthKey(item.competence_month)}`
        : '';
      const cardPaymentLabel = isCardPaymentTransaction(item) ? ' · pagamento de fatura (fora do resumo)' : '';
      subtitle.textContent = `${dateLabel} · ${item.category ?? 'Sem categoria'}${subcategory}${cardLabel}${competenceLabel}${cardPaymentLabel}`;
      info.append(title, subtitle);
      const avatar = document.createElement('div');
      avatar.className = 'transaction-avatar';
      avatar.setAttribute('role', 'img');
      avatar.setAttribute('aria-label', `Responsável: ${author}`);
      avatar.title = author;
      if (member) {
        avatar.classList.add(member.role === 'owner' ? 'owner' : 'member');
        avatar.textContent = memberInitials(author);
      } else if (item.card_label) {
        avatar.classList.add('imported');
        avatar.textContent = 'IMP';
      } else {
        avatar.classList.add('member');
        avatar.textContent = '?';
      }
      const attribution = document.createElement('div');
      attribution.className = 'transaction-attribution';
      const authorName = document.createElement('span');
      authorName.className = 'transaction-author-name';
      authorName.textContent = author;
      attribution.append(avatar, authorName);
      const amount = document.createElement('div');
      amount.className = `amount ${item.transaction_type}`;
      amount.textContent = `${item.transaction_type === 'income' ? '+' : '−'} ${formatMoney(item.amount_cents)}`;
      row.append(icon, info, attribution, amount);
      container.append(row);
    }
  }

  function memberDisplayName(email) {
    const localPart = email.split('@', 1)[0];
    const name = localPart.split(/[._-]+/).filter(Boolean)
      .map(part => part[0].toLocaleUpperCase('pt-BR') + part.slice(1)).join(' ');
    return name || email;
  }

  function memberInitials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2)
      .map(part => Array.from(part)[0].toLocaleUpperCase('pt-BR')).join('');
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
      const { income, expenses } = calculateMonthlyCashFlow(
        monthTransactions,
        state.cardStatements,
        state.cardStatementItems,
        key
      );
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

  function parseBrazilianAmount(rawValue) {
    let normalized = rawValue.trim().replace(/[R$\s]/g, '');
    if (!normalized) return NaN;
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      normalized = normalized.replace(decimalSeparator === ',' ? /\./g : /,/g, '');
      if (decimalSeparator === ',') normalized = normalized.replace(',', '.');
    } else if (lastComma >= 0) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else if (lastDot >= 0 && !/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
      if ((normalized.match(/\./g) ?? []).length > 1) return NaN;
    } else {
      normalized = normalized.replace(/\./g, '');
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return NaN;
    const amount = Number(normalized);
    return Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : NaN;
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
