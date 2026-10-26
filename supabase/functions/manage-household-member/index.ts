import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request: Request) => {
  const requestOrigin = request.headers.get("Origin");
  const preflightHeaders = {
    "Access-Control-Allow-Origin": requestOrigin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appSiteUrl = Deno.env.get("APP_SITE_URL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appSiteUrl) {
    console.error("Missing required Edge Function environment variables.");
    return jsonResponse({ error: "A função de convites não está configurada." }, 500, preflightHeaders);
  }

  let appOrigin: string;
  try {
    appOrigin = new URL(appSiteUrl).origin;
  } catch {
    console.error("APP_SITE_URL is not a valid URL.");
    return jsonResponse({ error: "A URL do app não está configurada corretamente." }, 500, preflightHeaders);
  }
  const inviteRedirect = new URL(
    "casa-em-dia.html",
    appSiteUrl.endsWith("/") ? appSiteUrl : `${appSiteUrl}/`
  );
  inviteRedirect.searchParams.set("mode", "set-password");
  if (requestOrigin && requestOrigin !== appOrigin) {
    return new Response(JSON.stringify({ error: "Origem não permitida." }), { status: 403 });
  }
  const corsHeaders = {
    "Access-Control-Allow-Origin": requestOrigin ?? appOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, corsHeaders);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão inválida. Entre novamente." }, 401, corsHeaders);
  }

  const token = authorization.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResult, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userResult.user) {
    return jsonResponse({ error: "Sessão inválida. Entre novamente." }, 401, corsHeaders);
  }

  let payload: { email?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "O corpo da solicitação precisa ser JSON válido." }, 400, corsHeaders);
  }

  if (typeof payload.email !== "string" || payload.email.length > 254) {
    return jsonResponse({ error: "Informe um endereço de e-mail válido." }, 400, corsHeaders);
  }
  const email = payload.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Informe um endereço de e-mail válido." }, 400, corsHeaders);
  }
  if (email === userResult.user.email?.toLowerCase()) {
    return jsonResponse({ error: "Este e-mail já pertence à sua conta." }, 400, corsHeaders);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: owner, error: ownerError } = await adminClient
    .from("household_members")
    .select("household_id")
    .eq("user_id", userResult.user.id)
    .eq("role", "owner")
    .maybeSingle();
  if (ownerError) {
    console.error("Could not verify household owner:", ownerError.message);
    return jsonResponse({ error: "Não foi possível validar as permissões da conta." }, 500, corsHeaders);
  }
  if (!owner) {
    return jsonResponse({ error: "Somente o responsável pela casa pode convidar membros." }, 403, corsHeaders);
  }

  const { data: existingMember, error: existingMemberError } = await adminClient
    .from("household_members")
    .select("user_id")
    .eq("household_id", owner.household_id)
    .eq("email", email)
    .maybeSingle();
  if (existingMemberError) {
    console.error("Could not check existing household membership:", existingMemberError.message);
    return jsonResponse({ error: "Não foi possível verificar os membros da casa." }, 500, corsHeaders);
  }
  if (existingMember) {
    return jsonResponse({ error: "Este e-mail já pertence à casa." }, 409, corsHeaders);
  }

  const existingAccount = await findUserByEmail(adminClient, email);
  if (existingAccount.error) {
    console.error("Could not list auth users:", existingAccount.error.message);
    return jsonResponse({ error: "Não foi possível verificar se este e-mail já tem conta." }, 500, corsHeaders);
  }

  if (existingAccount.user) {
    const { data: linkedElsewhere, error: linkedElsewhereError } = await adminClient
      .from("household_members")
      .select("household_id")
      .eq("user_id", existingAccount.user.id)
      .maybeSingle();
    if (linkedElsewhereError) {
      console.error("Could not check the existing account household:", linkedElsewhereError.message);
      return jsonResponse({ error: "Não foi possível verificar a casa desta conta." }, 500, corsHeaders);
    }
    if (linkedElsewhere) {
      return jsonResponse({
        error: "Esta conta já está vinculada a outra casa. Cada conta participa de uma casa por vez; peça para a pessoa sair da outra casa antes de entrar nesta.",
      }, 409, corsHeaders);
    }
    const { error: linkError } = await adminClient
      .from("household_members")
      .insert({
        user_id: existingAccount.user.id,
        household_id: owner.household_id,
        email,
        role: "member",
        invited_by: userResult.user.id,
      });
    if (linkError) {
      console.error("Could not link the existing account to the household:", linkError.message);
      return jsonResponse({ error: "Não foi possível vincular esta conta à casa." }, 500, corsHeaders);
    }
    return jsonResponse({
      message: "Conta existente vinculada à casa. Peça para entrar com a senha desta conta; se não lembrar, use \"Esqueci minha senha\".",
    }, 200, corsHeaders);
  }

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: inviteRedirect.toString() }
  );
  if (inviteError || !invited.user) {
    console.error("Supabase Auth invitation failed:", inviteError?.message ?? "No invited user.");
    return jsonResponse({
      error: "O Supabase não conseguiu enviar o convite. Verifique se o e-mail já tem conta e se o envio de e-mails está configurado.",
    }, 400, corsHeaders);
  }

  const { error: membershipError } = await adminClient
    .from("household_members")
    .insert({
      user_id: invited.user.id,
      household_id: owner.household_id,
      email,
      role: "member",
      invited_by: userResult.user.id,
    });
  if (membershipError) {
    console.error("Could not add invited user to household:", membershipError.message);
    return jsonResponse({
      error: "O convite foi enviado, mas não foi possível vincular a conta à casa. Verifique a gestão de membros antes de reenviar.",
    }, 500, corsHeaders);
  }

  return jsonResponse({ message: "Convite enviado." }, 200, corsHeaders);
});

function jsonResponse(body: Record<string, string>, status: number, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function findUserByEmail(adminClient: SupabaseClient, email: string) {
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) return { user: null, error };
    const user = data.users.find(candidate => candidate.email?.toLowerCase() === email);
    if (user) return { user, error: null };
    if (data.users.length < perPage) break;
  }
  return { user: null, error: null };
}
