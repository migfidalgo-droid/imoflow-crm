(() => {
  if (typeof configureRemoteClient === "function") return;

  const CLOUD_STATE_ID = "main";
  const CLOUD_FILE_BUCKET = "imoflow-files";
  let cloudClient = null;
  let cloudUser = null;
  let cloudSaveTimer = null;
  let cloudWriteInFlight = false;
  let cloudLastUpdatedAt = "";
  let cloudSubscription = null;
  let cloudSessionStartedFor = "";
  let cloudProfile = null;
  let cloudUsers = [];
  let cloudRenderBase = null;
  let cloudRenderWrapped = false;
  let cloudViewObserver = null;

  const CLOUD_ROLES = [
    "Admin",
    "Broker",
    "Coordenadora de Agência",
    "Consultor Imobiliário",
    "Diretor de Agência",
    "Recrutador",
    "Gestor de Marketing",
    "Cliente",
  ];
  const CLOUD_USER_MANAGERS = ["Admin", "Broker", "Coordenadora de Agência"];
  const CLOUD_WRITE_ROLES = ["Admin", "Broker", "Coordenadora de Agência", "Consultor Imobiliário", "Diretor de Agência"];
  const CLOUD_ROLE_VIEWS = {
    Admin: ["dashboard", "contacts", "properties", "processes", "tasks", "communications", "automation", "reports", "portal", "users"],
    Broker: ["dashboard", "contacts", "properties", "processes", "tasks", "communications", "automation", "reports", "portal", "users"],
    "Coordenadora de Agência": ["dashboard", "contacts", "properties", "processes", "tasks", "communications", "automation", "reports", "portal", "users"],
    "Diretor de Agência": ["dashboard", "contacts", "properties", "processes", "tasks", "communications", "automation", "reports", "portal"],
    "Consultor Imobiliário": ["dashboard", "contacts", "properties", "processes", "tasks", "communications", "reports", "portal"],
    Recrutador: ["dashboard", "contacts", "tasks", "communications", "reports"],
    "Gestor de Marketing": ["dashboard", "properties", "communications", "automation", "reports"],
    Cliente: ["portal"],
  };

  const localSaveData = saveData;
  const localSaveQuickTodos = saveQuickTodos;
  const localPutStoredFile = putStoredFile;
  const localGetStoredFile = getStoredFile;
  const localDeleteStoredFile = deleteStoredFile;

  const cloudStyles = document.createElement("style");
  cloudStyles.textContent = `
    .is-hidden{display:none!important}.app-shell.is-auth-locked{display:none}
    .auth-gate{min-height:100vh;display:grid;place-items:center;padding:24px;background:#0b3158}
    .auth-panel{width:min(100%,440px);display:grid;gap:24px;padding:28px;border-top:4px solid #e31b23;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.28)}
    .auth-brand{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px;background:#113f70;color:#fff}
    .auth-brand div{display:grid;gap:3px;text-align:right}.auth-brand strong{font-size:22px}.auth-brand span{font-size:12px;opacity:.8}
    .auth-logo{width:148px;max-height:64px;object-fit:contain;object-position:left center}.auth-panel h1{margin:4px 0 8px;font-size:28px}
    .auth-form{display:grid;gap:10px}.auth-form button{margin-top:6px}.auth-message{min-height:20px;margin:4px 0 0;color:#24613a;font-size:13px}.auth-message.is-error{color:#b42318}
    .account-controls{display:flex;align-items:center;gap:10px}.account-email{max-width:190px;overflow:hidden;color:#536170;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
    .sync-indicator{color:#24613a;font-size:12px;font-weight:700}.sync-indicator.is-syncing,.sync-indicator.is-pending{color:#986a00}.sync-indicator.is-error{color:#b42318}
    .user-greeting{margin-bottom:18px;padding:18px 20px;border-left:4px solid #e31b23;background:#fff;box-shadow:0 8px 24px rgba(11,49,88,.08)}
    .user-greeting h2{margin:0 0 4px;font-size:22px}.user-greeting p{margin:0;color:#687286}.user-role-label{font-size:12px;font-weight:700;color:#0b3b75}
    .user-list{display:grid;gap:10px}.user-row{display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(180px,1fr) minmax(140px,.8fr) auto;gap:14px;align-items:center;padding:14px;border:1px solid #d7deea;background:#fff}
    .user-row strong,.user-row span{display:block}.user-row small{color:#687286}.user-row-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
    .user-access-modal{position:fixed;inset:0;z-index:1000;display:none;place-items:center;padding:20px}.user-access-modal.is-open{display:grid}.user-access-backdrop{position:absolute;inset:0;background:rgba(5,25,50,.68)}
    .user-access-panel{position:relative;width:min(100%,720px);max-height:calc(100vh - 40px);overflow:auto;padding:22px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.3)}
    .user-access-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.user-access-header h2{margin:4px 0 0}.user-access-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .user-access-form label{display:grid;gap:6px}.user-access-form .full{grid-column:1/-1}.user-access-form footer{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
    .access-denied{width:min(100%,520px);margin:auto;padding:28px;border-top:4px solid #e31b23;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.24);text-align:center}
    .cloud-readonly [data-action="new"],.cloud-readonly [data-action="edit"],.cloud-readonly [data-action="delete"],.cloud-readonly [data-action="cancel"],.cloud-readonly [data-action="accept"],.cloud-readonly [data-action="counter"],.cloud-readonly [data-action="reject"]{display:none!important}
    @media(max-width:850px){.user-row{grid-template-columns:1fr}.user-row-actions{justify-content:flex-start}.user-access-form{grid-template-columns:1fr}.user-access-form .full{grid-column:auto}.account-email,.sync-indicator{display:none}}
  `;
  document.head.appendChild(cloudStyles);

  function cloudConfigureClient() {
    if (!window.supabase?.createClient || !window.IMOFLOW_SUPABASE_URL || !window.IMOFLOW_SUPABASE_ANON_KEY) return null;
    return window.supabase.createClient(window.IMOFLOW_SUPABASE_URL, window.IMOFLOW_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  function cloudEnsureAuthInterface() {
    if (document.getElementById("authGate")) return;
    const gate = document.createElement("section");
    gate.id = "authGate";
    gate.className = "auth-gate";
    gate.innerHTML = `
      <div class="auth-panel">
        <div class="auth-brand">
          <img class="auth-logo" alt="RE/MAX Power Benavente">
          <div><strong>ImoFlow</strong><span>CRM Imobiliária</span></div>
        </div>
        <div>
          <p class="eyebrow">Dados centralizados</p>
          <h1>Entrar no ImoFlow</h1>
          <p class="muted">Utilize a sua conta para aceder aos mesmos dados em qualquer dispositivo.</p>
        </div>
        <form id="authForm" class="auth-form">
          <label for="authEmail">E-mail</label>
          <input id="authEmail" name="email" type="email" autocomplete="email" required>
          <label for="authPassword">Palavra-passe</label>
          <input id="authPassword" name="password" type="password" autocomplete="current-password" minlength="6" required>
          <button class="primary-button" type="submit">Entrar</button>
          <p class="auth-message" id="authMessage" role="status"></p>
        </form>
      </div>`;
    document.body.prepend(gate);
    const logo = gate.querySelector(".auth-logo");
    const logoSource = document.querySelector(".brand-agency-logo")?.src || window.IMOFLOW_LOGO_WHITE_DATA;
    if (logo && logoSource) logo.src = logoSource;
    gate.querySelector("#authForm").addEventListener("submit", async event => {
      event.preventDefault();
      await cloudHandleAuth("signin");
    });
  }

  function cloudSetAuthMessage(message, isError = false) {
    const target = document.getElementById("authMessage");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("is-error", isError);
  }

  async function cloudHandleAuth(action) {
    const form = document.getElementById("authForm");
    const email = form?.email?.value?.trim();
    const password = form?.password?.value || "";
    if (!email || !password) return;
    cloudSetAuthMessage(action === "signup" ? "A criar conta..." : "A entrar...");
    const result = await cloudClient.auth.signInWithPassword({ email, password });
    if (result.error) {
      cloudSetAuthMessage(result.error.message, true);
      return;
    }
    await cloudStartSession(result.data.session);
  }

  function cloudCanManageUsers() { return CLOUD_USER_MANAGERS.includes(cloudProfile?.role); }
  function cloudCanWrite() { return CLOUD_WRITE_ROLES.includes(cloudProfile?.role); }
  function cloudAllowedViews() { return CLOUD_ROLE_VIEWS[cloudProfile?.role] || []; }
  function cloudProfileIsActive(profile) {
    if (!profile || profile.status !== "active") return false;
    return !profile.blocked_until || new Date(profile.blocked_until) <= new Date();
  }
  function cloudFullName(profile = cloudProfile) {
    const name = `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim();
    return name || profile?.email || "Utilizador";
  }
  function cloudGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 20) return "Boa tarde";
    return "Boa noite";
  }
  function cloudEscape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  function cloudRoleOptions(selected = "") {
    return CLOUD_ROLES.map(role => `<option value="${cloudEscape(role)}" ${role === selected ? "selected" : ""}>${cloudEscape(role)}</option>`).join("");
  }

  async function cloudLoadProfile() {
    const { data, error } = await cloudClient.from("user_profiles").select("*").eq("id", cloudUser.id).maybeSingle();
    if (error) throw error;
    cloudProfile = data || null;
    return cloudProfile;
  }

  function cloudShowAccessDenied(message) {
    document.querySelector(".app-shell")?.classList.add("is-auth-locked");
    const gate = document.getElementById("authGate");
    if (!gate) return;
    gate.classList.remove("is-hidden");
    gate.innerHTML = `<div class="access-denied"><p class="eyebrow">Acesso indisponível</p><h1>Não é possível abrir o ImoFlow</h1><p class="muted">${cloudEscape(message)}</p><button class="primary-button" id="deniedSignOutBtn" type="button">Voltar ao início</button></div>`;
    gate.querySelector("#deniedSignOutBtn")?.addEventListener("click", async () => { await cloudClient.auth.signOut(); window.location.reload(); });
  }

  function cloudEnsureUserModal() {
    if (document.getElementById("userAccessModal")) return;
    const modal = document.createElement("div");
    modal.id = "userAccessModal";
    modal.className = "user-access-modal";
    modal.innerHTML = `<div class="user-access-backdrop" data-close-user-access></div><section class="user-access-panel" role="dialog" aria-modal="true"><header class="user-access-header"><div><p class="eyebrow" id="userAccessEyebrow">Acesso</p><h2 id="userAccessTitle">Novo utilizador</h2></div><button class="icon-button" data-close-user-access type="button" aria-label="Fechar">x</button></header><form class="user-access-form" id="userAccessForm"></form></section>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", event => { if (event.target.matches("[data-close-user-access]")) cloudCloseUserModal(); });
  }
  function cloudCloseUserModal() {
    const modal = document.getElementById("userAccessModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.querySelector("#userAccessForm").innerHTML = "";
  }
  function cloudOpenUserForm(profile = null) {
    cloudEnsureUserModal();
    const modal = document.getElementById("userAccessModal");
    const form = modal.querySelector("#userAccessForm");
    const isEdit = Boolean(profile);
    modal.querySelector("#userAccessEyebrow").textContent = isEdit ? "Editar acesso" : "Novo acesso";
    modal.querySelector("#userAccessTitle").textContent = isEdit ? cloudFullName(profile) : "Novo utilizador";
    form.innerHTML = `<label>Nome<input name="firstName" type="text" value="${cloudEscape(profile?.first_name || "")}" required></label><label>Apelido<input name="lastName" type="text" value="${cloudEscape(profile?.last_name || "")}" required></label><label>Telefone<input name="phone" type="tel" value="${cloudEscape(profile?.phone || "")}"></label><label>E-mail<input name="email" type="email" value="${cloudEscape(profile?.email || "")}" ${isEdit ? "readonly" : ""} required></label><label>Tipo de acesso<select name="role" required>${cloudRoleOptions(profile?.role || "Consultor Imobiliário")}</select></label><label>Função na empresa<input name="companyFunction" type="text" value="${cloudEscape(profile?.company_function || "")}" required></label>${isEdit ? `<label class="full">Bloqueio temporário até<input name="blockedUntil" type="datetime-local" value="${profile?.blocked_until ? new Date(profile.blocked_until).toISOString().slice(0, 16) : ""}"></label>` : `<label class="full">Palavra-passe inicial<input name="password" type="password" minlength="8" required></label>`}<footer><button class="secondary-button" data-close-user-access type="button">Cancelar</button><button class="primary-button" type="submit">${isEdit ? "Guardar alterações" : "Criar acesso"}</button></footer>`;
    form.addEventListener("submit", event => { event.preventDefault(); if (isEdit) cloudUpdateUser(profile.id, form); else cloudCreateUser(form); });
    modal.classList.add("is-open");
  }
  function cloudOpenPasswordForm() {
    cloudEnsureUserModal();
    const modal = document.getElementById("userAccessModal");
    const form = modal.querySelector("#userAccessForm");
    modal.querySelector("#userAccessEyebrow").textContent = "Segurança";
    modal.querySelector("#userAccessTitle").textContent = "Alterar palavra-passe";
    form.innerHTML = `<label class="full">Nova palavra-passe<input name="password" type="password" minlength="8" required></label><label class="full">Confirmar palavra-passe<input name="passwordConfirm" type="password" minlength="8" required></label><footer><button class="secondary-button" data-close-user-access type="button">Cancelar</button><button class="primary-button" type="submit">Alterar palavra-passe</button></footer>`;
    form.addEventListener("submit", async event => { event.preventDefault(); const password = form.password.value; if (password !== form.passwordConfirm.value) return toast("As palavras-passe não coincidem."); const { error } = await cloudClient.auth.updateUser({ password }); if (error) return toast("Não foi possível alterar a palavra-passe."); cloudCloseUserModal(); toast("Palavra-passe alterada."); });
    modal.classList.add("is-open");
  }

  async function cloudCreateUser(form) {
    const email = form.email.value.trim().toLowerCase();
    const invite = { email, first_name: form.firstName.value.trim(), last_name: form.lastName.value.trim(), phone: form.phone.value.trim(), role: form.role.value, company_function: form.companyFunction.value.trim(), created_by: cloudUser.id };
    const { error: inviteError } = await cloudClient.from("access_invites").upsert(invite);
    if (inviteError) return toast("Não foi possível preparar o novo acesso.");
    const signupClient = window.supabase.createClient(window.IMOFLOW_SUPABASE_URL, window.IMOFLOW_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await signupClient.auth.signUp({ email, password: form.password.value, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
    if (error) { await cloudClient.from("access_invites").delete().eq("email", email); return toast(`Não foi possível criar o acesso: ${error.message}`); }
    cloudCloseUserModal(); toast("Acesso criado. O utilizador deve confirmar o e-mail."); await cloudLoadUsers();
  }
  async function cloudUpdateUser(id, form) {
    const blockedUntil = form.blockedUntil.value ? new Date(form.blockedUntil.value).toISOString() : null;
    const { error } = await cloudClient.from("user_profiles").update({ first_name: form.firstName.value.trim(), last_name: form.lastName.value.trim(), phone: form.phone.value.trim(), role: form.role.value, company_function: form.companyFunction.value.trim(), blocked_until: blockedUntil, status: "active", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast("Não foi possível guardar as alterações.");
    cloudCloseUserModal(); toast("Utilizador atualizado."); await cloudLoadUsers();
  }
  async function cloudToggleUserBlock(profile) {
    if (profile.id === cloudUser.id) return toast("Não pode bloquear o seu próprio acesso.");
    const isBlocked = profile.status === "blocked" || (profile.blocked_until && new Date(profile.blocked_until) > new Date());
    const { error } = await cloudClient.from("user_profiles").update({ status: isBlocked ? "active" : "blocked", blocked_until: null, updated_at: new Date().toISOString() }).eq("id", profile.id);
    if (error) return toast("Não foi possível alterar o acesso.");
    toast(isBlocked ? "Acesso desbloqueado." : "Acesso bloqueado."); await cloudLoadUsers();
  }
  async function cloudDeleteUser(profile) {
    if (profile.id === cloudUser.id) return toast("Não pode eliminar o seu próprio acesso.");
    if (!window.confirm(`Deseja mesmo eliminar o acesso de ${cloudFullName(profile)}?`)) return;
    const { error } = await cloudClient.from("user_profiles").update({ status: "deleted", blocked_until: null, updated_at: new Date().toISOString() }).eq("id", profile.id);
    if (error) return toast("Não foi possível eliminar o utilizador.");
    toast("Utilizador eliminado."); await cloudLoadUsers();
  }
  async function cloudLoadUsers() {
    if (!cloudCanManageUsers()) return;
    const { data, error } = await cloudClient.from("user_profiles").select("*").order("first_name").order("last_name");
    if (error) return toast("Não foi possível carregar os utilizadores.");
    cloudUsers = data || [];
    if (state.view === "users") cloudRenderUsers();
  }
  function cloudUserStatus(profile) {
    if (profile.status === "deleted") return "Eliminado";
    if (profile.status === "blocked") return "Bloqueado";
    if (profile.blocked_until && new Date(profile.blocked_until) > new Date()) return `Bloqueado até ${new Date(profile.blocked_until).toLocaleString("pt-PT")}`;
    return "Ativo";
  }
  function cloudRenderUsers() {
    els.pageTitle.textContent = "Utilizadores";
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("is-active", button.dataset.view === "users"));
    const topbarActions = els.quickAddBtn?.closest(".topbar-actions");
    if (topbarActions) topbarActions.hidden = false;
    [els.globalSearch?.closest(".search-field"), els.exportDataBtn, els.importDataBtn, els.quickAddBtn].forEach(element => { if (element) element.hidden = true; });
    els.mainContent.innerHTML = `<section class="panel"><header class="panel-header"><div><h2>Gestão de utilizadores</h2><p class="muted">Crie acessos e controle as permissões da equipa.</p></div><button class="primary-button" id="newUserAccessBtn" type="button">Novo utilizador</button></header><div class="panel-body user-list">${cloudUsers.length ? cloudUsers.map(profile => `<article class="user-row"><div><strong>${cloudEscape(cloudFullName(profile))}</strong><small>${cloudEscape(profile.email)}</small></div><div><span>${cloudEscape(profile.role)}</span><small>${cloudEscape(profile.company_function || "Sem função indicada")}</small></div><div><span>${cloudEscape(cloudUserStatus(profile))}</span><small>${cloudEscape(profile.phone || "Sem telefone")}</small></div><div class="user-row-actions"><button class="secondary-button" data-cloud-user-edit="${profile.id}" type="button">Editar</button><button class="secondary-button" data-cloud-user-block="${profile.id}" type="button">${cloudUserStatus(profile) === "Ativo" ? "Bloquear" : "Desbloquear"}</button><button class="danger-button" data-cloud-user-delete="${profile.id}" type="button">Eliminar</button></div></article>`).join("") : '<div class="empty-state">Sem utilizadores.</div>'}</div></section>`;
    document.getElementById("newUserAccessBtn")?.addEventListener("click", () => cloudOpenUserForm());
    document.querySelectorAll("[data-cloud-user-edit]").forEach(button => button.addEventListener("click", () => cloudOpenUserForm(cloudUsers.find(user => user.id === button.dataset.cloudUserEdit))));
    document.querySelectorAll("[data-cloud-user-block]").forEach(button => button.addEventListener("click", () => cloudToggleUserBlock(cloudUsers.find(user => user.id === button.dataset.cloudUserBlock))));
    document.querySelectorAll("[data-cloud-user-delete]").forEach(button => button.addEventListener("click", () => cloudDeleteUser(cloudUsers.find(user => user.id === button.dataset.cloudUserDelete))));
  }

  function cloudDecorateCurrentView() {
    if (state.view !== "dashboard" || !cloudProfile || document.querySelector(".user-greeting")) return;
    els.mainContent.insertAdjacentHTML("afterbegin", `<section class="user-greeting"><h2>${cloudGreeting()}, ${cloudEscape(cloudProfile.first_name || cloudFullName())}</h2><p><span class="user-role-label">${cloudEscape(cloudProfile.role)}</span>${cloudProfile.company_function ? ` · ${cloudEscape(cloudProfile.company_function)}` : ""}</p></section>`);
  }
  function cloudObserveViews() {
    if (cloudViewObserver || !els.mainContent) return;
    cloudViewObserver = new MutationObserver(() => {
      if (state.view === "users" && !document.getElementById("newUserAccessBtn")) { cloudRenderUsers(); return; }
      cloudDecorateCurrentView();
    });
    cloudViewObserver.observe(els.mainContent, { childList: true });
  }
  function cloudWrapRender() {
    if (cloudRenderWrapped) return;
    cloudRenderBase = render;
    render = function cloudPermissionRender() {
      const allowed = cloudAllowedViews();
      if (!allowed.includes(state.view)) state.view = allowed[0] || "portal";
      if (state.view === "users") { cloudRenderUsers(); return; }
      cloudRenderBase(); cloudDecorateCurrentView();
    };
    cloudRenderWrapped = true;
  }
  function cloudApplyNavigation() {
    const allowed = cloudAllowedViews();
    document.body.classList.toggle("cloud-readonly", !cloudCanWrite());
    document.querySelectorAll(".nav-item").forEach(button => { button.hidden = !allowed.includes(button.dataset.view); });
    if (cloudCanManageUsers() && !document.querySelector('[data-view="users"]')) {
      const button = document.createElement("button");
      button.className = "nav-item"; button.dataset.view = "users"; button.type = "button"; button.textContent = "Utilizadores";
      button.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); state.view = "users"; cloudRenderUsers(); }, { capture: true });
      document.getElementById("navList")?.append(button);
    }
  }
  function cloudSetSignedInInterface(session) {
    document.getElementById("authGate")?.classList.add("is-hidden");
    document.querySelector(".app-shell")?.classList.remove("is-auth-locked");
    const footer = document.querySelector(".sidebar-footer");
    if (footer) footer.innerHTML = `<span class="status-dot"></span><span>Dados online</span>`;
    if (document.getElementById("accountControls")) return;
    const controls = document.createElement("div"); controls.id = "accountControls"; controls.className = "account-controls";
    controls.innerHTML = `<span class="sync-indicator" id="syncIndicator">Sincronizado</span><span class="account-email">${cloudEscape(cloudFullName())} · ${cloudEscape(cloudProfile?.role || "")}</span><button class="ghost-button" id="changePasswordBtn" type="button">Palavra-passe</button><button class="ghost-button" id="signOutBtn" type="button">Sair</button>`;
    document.querySelector(".topbar-actions")?.append(controls);
    controls.querySelector("#changePasswordBtn").addEventListener("click", cloudOpenPasswordForm);
    controls.querySelector("#signOutBtn").addEventListener("click", async () => { await cloudClient.auth.signOut(); window.location.reload(); });
  }
  function cloudSetSync(message, stateName = "") {
    const indicator = document.getElementById("syncIndicator"); if (!indicator) return; indicator.textContent = message; indicator.className = `sync-indicator ${stateName}`.trim();
  }
  function cloudNormalizeTodos(value) {
    if (!Array.isArray(value)) return [];
    const today = localDateKey();
    return value.map(item => { const date = item.date || today; const done = Boolean(item.done); const rolledDate = !done && date < today ? today : date; return { id: item.id || uid(), text: String(item.text || ""), done, date: rolledDate, createdAt: item.createdAt || now(), updatedAt: rolledDate !== date ? now() : item.updatedAt || item.createdAt || now() }; }).filter(item => item.text.trim());
  }

  async function cloudStartSession(session) {
    if (!session?.user || cloudSessionStartedFor === session.user.id) return;
    cloudSessionStartedFor = session.user.id; cloudUser = session.user;
    try { await cloudLoadProfile(); } catch { cloudSessionStartedFor = ""; cloudShowAccessDenied("Não foi possível validar o seu perfil de acesso."); return; }
    if (!cloudProfileIsActive(cloudProfile)) { cloudShowAccessDenied("O seu acesso está bloqueado ou ainda não foi autorizado."); return; }
    cloudWrapRender(); cloudApplyNavigation(); cloudObserveViews(); cloudSetSignedInInterface(session);
    if (cloudCanManageUsers()) await cloudLoadUsers();
    if (cloudProfile.role === "Cliente") { state.data = normalizeData({}); state.quickTodos = []; state.view = "portal"; render(); cloudSetSync("Acesso cliente"); return; }
    cloudSetSync("A sincronizar...", "is-syncing");
    const { data: remoteState, error } = await cloudClient.from("crm_state").select("data, quick_todos, updated_at").eq("id", CLOUD_STATE_ID).maybeSingle();
    if (error) { cloudSetSync("Erro de sincronização", "is-error"); toast("Não foi possível carregar os dados online."); return; }
    if (remoteState?.data && Object.keys(remoteState.data).length) { state.data = normalizeData(remoteState.data); state.quickTodos = cloudNormalizeTodos(remoteState.quick_todos || []); cloudLastUpdatedAt = remoteState.updated_at || ""; localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); localStorage.setItem(QUICK_TODOS_KEY, JSON.stringify(state.quickTodos)); } else await cloudPersistState();
    cloudSubscribe(); render(); cloudSetSync("Sincronizado"); cloudMigrateKnownLocalFiles().catch(() => {});
  }
  async function cloudPersistState() {
    if (!cloudClient || !cloudUser || cloudWriteInFlight || !cloudCanWrite()) return;
    cloudWriteInFlight = true; cloudSetSync("A guardar...", "is-syncing"); const updatedAt = now();
    const { data, error } = await cloudClient.from("crm_state").upsert({ id: CLOUD_STATE_ID, data: state.data, quick_todos: state.quickTodos, updated_at: updatedAt, updated_by: cloudUser.id }).select("updated_at").single();
    cloudWriteInFlight = false;
    if (error) { cloudSetSync("Erro ao guardar", "is-error"); toast("Não foi possível guardar os dados online."); return; }
    cloudLastUpdatedAt = data?.updated_at || updatedAt; cloudSetSync("Sincronizado");
  }
  function cloudScheduleSave() { if (!cloudClient || !cloudUser) return; clearTimeout(cloudSaveTimer); cloudSetSync("Alterações por guardar", "is-pending"); cloudSaveTimer = setTimeout(cloudPersistState, 650); }
  function cloudSubscribe() {
    if (!cloudClient || cloudSubscription) return;
    cloudSubscription = cloudClient.channel("imoflow-shared-state").on("postgres_changes", { event: "*", schema: "public", table: "crm_state", filter: `id=eq.${CLOUD_STATE_ID}` }, payload => { const next = payload.new; if (!next?.data || next.updated_at === cloudLastUpdatedAt || cloudWriteInFlight) return; cloudLastUpdatedAt = next.updated_at || ""; state.data = normalizeData(next.data); state.quickTodos = cloudNormalizeTodos(next.quick_todos || []); localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); localStorage.setItem(QUICK_TODOS_KEY, JSON.stringify(state.quickTodos)); render(); cloudSetSync("Sincronizado"); toast("Dados atualizados noutro dispositivo."); }).subscribe();
  }
  saveData = function cloudSaveData() { const result = localSaveData(); if (cloudCanWrite()) cloudScheduleSave(); return result; };
  saveQuickTodos = function cloudSaveTodos() { localSaveQuickTodos(); if (cloudCanWrite()) cloudScheduleSave(); };

  function cloudFilePath(key) { return String(key).replace(/[^a-zA-Z0-9._/-]/g, "_"); }
  putStoredFile = async function cloudPutStoredFile(key, file) { if (!cloudCanWrite()) throw new Error("Sem permissão para carregar ficheiros."); if (!cloudClient || !cloudUser) return localPutStoredFile(key, file); const { error } = await cloudClient.storage.from(CLOUD_FILE_BUCKET).upload(cloudFilePath(key), file, { upsert: true, contentType: file.type || "application/octet-stream" }); if (error) throw error; return true; };
  getStoredFile = async function cloudGetStoredFile(key) { if (cloudClient && cloudUser) { const path = cloudFilePath(key); const { data, error } = await cloudClient.storage.from(CLOUD_FILE_BUCKET).download(path); if (!error && data) return { key, blob: data, name: path.split("/").pop() || "documento", type: data.type }; } const local = await localGetStoredFile(key); if (local && cloudClient && cloudUser) putStoredFile(key, local.blob).catch(() => {}); return local; };
  deleteStoredFile = async function cloudDeleteStoredFile(key) { if (!cloudCanWrite()) throw new Error("Sem permissão para eliminar ficheiros."); if (cloudClient && cloudUser) await cloudClient.storage.from(CLOUD_FILE_BUCKET).remove([cloudFilePath(key)]); return localDeleteStoredFile(key); };
  function cloudKnownFileKeys() { const keys = []; state.data.properties.forEach(property => { if (property.photoStored) keys.push(`photo:${property.id}`); (property.activities || []).forEach(activity => { if (activity.proposalFileStored) keys.push(activityFileKey(property.id, activity.id, "proposal")); if (activity.reportFileStored) keys.push(activityFileKey(property.id, activity.id, "report")); }); }); state.data.documents.forEach(document => { if (document.fileStored) keys.push(`document:${document.id}`); }); return [...new Set(keys)]; }
  async function cloudMigrateKnownLocalFiles() { if (!cloudClient || !cloudUser) return; for (const key of cloudKnownFileKeys()) { const local = await localGetStoredFile(key).catch(() => null); if (local?.blob) await putStoredFile(key, local.blob).catch(() => {}); } }

  async function cloudInitialize() {
    cloudEnsureAuthInterface(); document.querySelector(".app-shell")?.classList.add("is-auth-locked"); cloudClient = cloudConfigureClient();
    if (!cloudClient) { cloudSetAuthMessage("A ligação à base de dados ainda não está configurada.", true); return; }
    cloudClient.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_IN" && session?.user) { cloudSetAuthMessage("E-mail confirmado. A abrir o ImoFlow..."); window.setTimeout(() => cloudStartSession(session), 0); } });
    const { data, error } = await cloudClient.auth.getSession();
    if (error) { cloudSetAuthMessage("Não foi possível validar a sessão.", true); return; }
    if (data.session) await cloudStartSession(data.session);
  }
  cloudInitialize();
})();
