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
          <button class="secondary-button" id="authSignupBtn" type="button">Criar conta</button>
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
    gate.querySelector("#authSignupBtn").addEventListener("click", () => cloudHandleAuth("signup"));
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
    const result = action === "signup"
      ? await cloudClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
      })
      : await cloudClient.auth.signInWithPassword({ email, password });
    if (result.error) {
      cloudSetAuthMessage(result.error.message, true);
      return;
    }
    if (action === "signup" && !result.data.session) {
      cloudSetAuthMessage("Conta criada. Confirme o e-mail recebido e depois entre.");
      return;
    }
    await cloudStartSession(result.data.session);
  }

  function cloudSetSignedInInterface(session) {
    document.getElementById("authGate")?.classList.add("is-hidden");
    document.querySelector(".app-shell")?.classList.remove("is-auth-locked");
    const footer = document.querySelector(".sidebar-footer");
    if (footer) footer.innerHTML = `<span class="status-dot"></span><span>Dados online</span>`;
    if (document.getElementById("accountControls")) return;
    const controls = document.createElement("div");
    controls.id = "accountControls";
    controls.className = "account-controls";
    controls.innerHTML = `
      <span class="sync-indicator" id="syncIndicator">Sincronizado</span>
      <span class="account-email">${escapeHtml(session.user.email || "")}</span>
      <button class="ghost-button" id="signOutBtn" type="button">Sair</button>`;
    document.querySelector(".topbar-actions")?.append(controls);
    controls.querySelector("#signOutBtn").addEventListener("click", async () => {
      await cloudClient.auth.signOut();
      window.location.reload();
    });
  }

  function cloudSetSync(message, stateName = "") {
    const indicator = document.getElementById("syncIndicator");
    if (!indicator) return;
    indicator.textContent = message;
    indicator.className = `sync-indicator ${stateName}`.trim();
  }

  function cloudNormalizeTodos(value) {
    if (!Array.isArray(value)) return [];
    const today = localDateKey();
    return value.map(item => {
      const date = item.date || today;
      const done = Boolean(item.done);
      const rolledDate = !done && date < today ? today : date;
      return {
        id: item.id || uid(),
        text: String(item.text || ""),
        done,
        date: rolledDate,
        createdAt: item.createdAt || now(),
        updatedAt: rolledDate !== date ? now() : item.updatedAt || item.createdAt || now(),
      };
    }).filter(item => item.text.trim());
  }

  async function cloudStartSession(session) {
    if (!session?.user) return;
    if (cloudSessionStartedFor === session.user.id) return;
    cloudSessionStartedFor = session.user.id;
    cloudUser = session.user;
    cloudSetSignedInInterface(session);
    cloudSetSync("A sincronizar...", "is-syncing");
    const { data: remoteState, error } = await cloudClient
      .from("crm_state")
      .select("data, quick_todos, updated_at")
      .eq("id", CLOUD_STATE_ID)
      .maybeSingle();
    if (error) {
      cloudSetSync("Erro de sincronização", "is-error");
      toast("Não foi possível carregar os dados online.");
      return;
    }
    if (remoteState?.data && Object.keys(remoteState.data).length) {
      state.data = normalizeData(remoteState.data);
      state.quickTodos = cloudNormalizeTodos(remoteState.quick_todos || []);
      cloudLastUpdatedAt = remoteState.updated_at || "";
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      localStorage.setItem(QUICK_TODOS_KEY, JSON.stringify(state.quickTodos));
    } else {
      await cloudPersistState();
    }
    cloudSubscribe();
    render();
    cloudSetSync("Sincronizado");
    cloudMigrateKnownLocalFiles().catch(() => {});
  }

  async function cloudPersistState() {
    if (!cloudClient || !cloudUser || cloudWriteInFlight) return;
    cloudWriteInFlight = true;
    cloudSetSync("A guardar...", "is-syncing");
    const updatedAt = now();
    const { data, error } = await cloudClient.from("crm_state").upsert({
      id: CLOUD_STATE_ID,
      data: state.data,
      quick_todos: state.quickTodos,
      updated_at: updatedAt,
      updated_by: cloudUser.id,
    }).select("updated_at").single();
    cloudWriteInFlight = false;
    if (error) {
      cloudSetSync("Erro ao guardar", "is-error");
      toast("Não foi possível guardar os dados online.");
      return;
    }
    cloudLastUpdatedAt = data?.updated_at || updatedAt;
    cloudSetSync("Sincronizado");
  }

  function cloudScheduleSave() {
    if (!cloudClient || !cloudUser) return;
    clearTimeout(cloudSaveTimer);
    cloudSetSync("Alterações por guardar", "is-pending");
    cloudSaveTimer = setTimeout(cloudPersistState, 650);
  }

  function cloudSubscribe() {
    if (!cloudClient || cloudSubscription) return;
    cloudSubscription = cloudClient.channel("imoflow-shared-state").on("postgres_changes", {
      event: "*", schema: "public", table: "crm_state", filter: `id=eq.${CLOUD_STATE_ID}`,
    }, payload => {
      const next = payload.new;
      if (!next?.data || next.updated_at === cloudLastUpdatedAt || cloudWriteInFlight) return;
      cloudLastUpdatedAt = next.updated_at || "";
      state.data = normalizeData(next.data);
      state.quickTodos = cloudNormalizeTodos(next.quick_todos || []);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      localStorage.setItem(QUICK_TODOS_KEY, JSON.stringify(state.quickTodos));
      render();
      cloudSetSync("Sincronizado");
      toast("Dados atualizados noutro dispositivo.");
    }).subscribe();
  }

  saveData = function cloudSaveData() {
    const result = localSaveData();
    cloudScheduleSave();
    return result;
  };

  saveQuickTodos = function cloudSaveTodos() {
    localSaveQuickTodos();
    cloudScheduleSave();
  };

  function cloudFilePath(key) {
    return String(key).replace(/[^a-zA-Z0-9._/-]/g, "_");
  }

  putStoredFile = async function cloudPutStoredFile(key, file) {
    if (!cloudClient || !cloudUser) return localPutStoredFile(key, file);
    const { error } = await cloudClient.storage.from(CLOUD_FILE_BUCKET).upload(cloudFilePath(key), file, {
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });
    if (error) throw error;
    return true;
  };

  getStoredFile = async function cloudGetStoredFile(key) {
    if (cloudClient && cloudUser) {
      const path = cloudFilePath(key);
      const { data, error } = await cloudClient.storage.from(CLOUD_FILE_BUCKET).download(path);
      if (!error && data) return { key, blob: data, name: path.split("/").pop() || "documento", type: data.type };
    }
    const local = await localGetStoredFile(key);
    if (local && cloudClient && cloudUser) putStoredFile(key, local.blob).catch(() => {});
    return local;
  };

  deleteStoredFile = async function cloudDeleteStoredFile(key) {
    if (cloudClient && cloudUser) await cloudClient.storage.from(CLOUD_FILE_BUCKET).remove([cloudFilePath(key)]);
    return localDeleteStoredFile(key);
  };

  function cloudKnownFileKeys() {
    const keys = [];
    state.data.properties.forEach(property => {
      if (property.photoStored) keys.push(`photo:${property.id}`);
      (property.activities || []).forEach(activity => {
        if (activity.proposalFileStored) keys.push(activityFileKey(property.id, activity.id, "proposal"));
        if (activity.reportFileStored) keys.push(activityFileKey(property.id, activity.id, "report"));
      });
    });
    state.data.documents.forEach(document => {
      if (document.fileStored) keys.push(`document:${document.id}`);
    });
    return [...new Set(keys)];
  }

  async function cloudMigrateKnownLocalFiles() {
    if (!cloudClient || !cloudUser) return;
    for (const key of cloudKnownFileKeys()) {
      const local = await localGetStoredFile(key).catch(() => null);
      if (local?.blob) await putStoredFile(key, local.blob).catch(() => {});
    }
  }

  async function cloudInitialize() {
    cloudEnsureAuthInterface();
    document.querySelector(".app-shell")?.classList.add("is-auth-locked");
    cloudClient = cloudConfigureClient();
    if (!cloudClient) {
      cloudSetAuthMessage("A ligação à base de dados ainda não está configurada.", true);
      return;
    }
    cloudClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        cloudSetAuthMessage("E-mail confirmado. A abrir o ImoFlow...");
        window.setTimeout(() => cloudStartSession(session), 0);
      }
    });
    const { data, error } = await cloudClient.auth.getSession();
    if (error) {
      cloudSetAuthMessage("Não foi possível validar a sessão.", true);
      return;
    }
    if (data.session) await cloudStartSession(data.session);
  }

  cloudInitialize();
})();
