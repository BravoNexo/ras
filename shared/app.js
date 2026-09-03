(function () {
  "use strict";

  const config = window.BRAVONEXO_RAS_CONFIG || {};
  const apiUrl = String(config.apiUrl || "").trim();
  const sessionKey = String(config.sessionStorageKey || "bravonexo.ras.session");
  const screens = ["bootScreen", "emailScreen", "codeScreen", "portal"];
  const state = {
    email: "",
    token: readStoredSession(),
    data: null,
    selected: [],
    dirty: false
  };

  const element = (id) => document.getElementById(id);

  function applyUnitConfig() {
    document.title = `${config.nomeSistema || "Controle de RAS"} - ${config.nomeUnidade || "Unidade"}`;
    element("systemName").textContent = config.nomeSistema || "Controle de RAS";
    element("unitName").textContent = config.nomeUnidade || "Unidade";
    element("unitFullName").textContent = config.nomeCompletoUnidade || config.nomeUnidade || "Unidade";

    const match = String(config.nomeUnidade || "").match(/^\s*(\d+º?)/);
    element("unitMark").textContent = match ? match[1] : "BN";
  }

  function bindEvents() {
    element("emailForm").addEventListener("submit", requestCode);
    element("codeForm").addEventListener("submit", verifyCode);
    element("backToEmailBtn").addEventListener("click", backToEmail);
    element("logoutBtn").addEventListener("click", logout);
    element("saveBtn").addEventListener("click", savePreferences);
    element("code").addEventListener("input", (event) => {
      event.target.value = String(event.target.value || "").replace(/\D/g, "").slice(0, 6);
    });

    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== sessionKey || event.newValue) return;
      state.token = "";
      state.data = null;
      state.selected = [];
      state.dirty = false;
      showScreen("emailScreen");
      showMessage("emailMessage", "A sessão foi encerrada em outra guia.");
    });
  }

  const PUBLIC_ACTIONS = new Set([
    "requestAccessCode",
    "verifyAccessCode",
    "getPortalData",
    "savePreferences",
    "logout"
  ]);

  async function callApi(action, args) {
    if (!apiUrl) {
      throw new Error("O endereço do Controle de RAS não foi configurado para esta unidade.");
    }
    if (!PUBLIC_ACTIONS.has(action)) {
      throw new Error("Ação não permitida neste portal.");
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30000);
    let response;
    let responseText;

    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          api: "RAS_PORTAL_V1",
          action,
          args: Array.isArray(args) ? args : []
        }),
        cache: "no-store",
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      responseText = await response.text();
    } catch (error) {
      const message = error && error.name === "AbortError"
        ? "O servidor demorou para responder."
        : "Não foi possível comunicar com o Controle de RAS.";
      const transportError = new Error(message);
      transportError.isTransportFailure = true;
      console.warn(`[RAS] Falha de transporte em ${action}:`, error && error.name, error && error.message);
      throw transportError;
    } finally {
      window.clearTimeout(timeout);
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw new Error("O Controle de RAS retornou uma resposta inválida.");
    }

    if (!response.ok || !payload || payload.ok === false || payload.sucesso === false) {
      const apiError = payload && payload.error;
      const message =
        (apiError && typeof apiError === "object" && apiError.message) ||
        (typeof apiError === "string" && apiError) ||
        (payload && (payload.message || payload.mensagem)) ||
        (payload && typeof payload.erro === "string" && payload.erro) ||
        "Não foi possível concluir a operação.";
      throw new Error(String(message));
    }

    if (Object.prototype.hasOwnProperty.call(payload, "result")) return payload.result;
    if (Object.prototype.hasOwnProperty.call(payload, "resposta")) return payload.resposta;
    return payload;
  }

  function showScreen(id) {
    screens.forEach((screenId) => {
      const screen = element(screenId);
      screen.hidden = screenId !== id;
    });
    element("logoutBtn").hidden = id !== "portal";
  }

  function showMessage(id, text, isError) {
    const target = element(id);
    target.textContent = text || "";
    target.hidden = !text;
    target.classList.toggle("error", Boolean(isError));
  }

  function setBusy(button, active, label) {
    button.disabled = active;
    if (active) {
      button.dataset.originalLabel = button.textContent;
      button.replaceChildren(createSpinner(), document.createTextNode(label));
      return;
    }
    button.textContent = button.dataset.originalLabel || label;
  }

  function createSpinner() {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    return spinner;
  }

  async function requestCode(event) {
    event.preventDefault();
    const button = element("sendBtn");
    const backButton = element("backToEmailBtn");
    const verifyButton = element("verifyBtn");
    state.email = String(element("email").value || "").trim().toLowerCase();
    showMessage("emailMessage", "");
    setBusy(button, true, "Enviando");
    backButton.disabled = true;
    verifyButton.disabled = true;
    element("maskedEmail").textContent = maskEmail(state.email);
    element("code").value = "";
    showScreen("codeScreen");
    showMessage("codeMessage", "Solicitando o código. Isso pode levar alguns segundos.");

    try {
      const result = await callApi("requestAccessCode", [state.email]);
      showMessage("codeMessage", result && result.message ? result.message : "Se o e-mail estiver autorizado, o código será enviado em instantes.");
      element("code").focus();
    } catch (error) {
      if (error && error.isTransportFailure) {
        showMessage(
          "codeMessage",
          "A resposta do servidor foi interrompida, mas a solicitação pode ter sido recebida. Confira a caixa de entrada e o spam. Se o código chegar, digite-o aqui; se não chegar em até 1 minuto, volte e solicite novamente.",
          true
        );
        element("code").focus();
      } else {
        showScreen("emailScreen");
        showMessage("emailMessage", error.message, true);
        element("email").focus();
      }
    } finally {
      setBusy(button, false, "Enviar código");
      backButton.disabled = false;
      verifyButton.disabled = false;
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    const button = element("verifyBtn");
    const code = String(element("code").value || "").replace(/\D/g, "").slice(0, 6);
    element("code").value = code;
    showMessage("codeMessage", "");
    setBusy(button, true, "Validando");

    try {
      const result = await callApi("verifyAccessCode", [state.email, code]);
      if (!result || !result.token || !isMilitaryPortalData(result.data)) {
        if (result && result.token) void endRemoteSession(result.token);
        throw new Error("Este portal é exclusivo para as escolhas dos militares. O controle administrativo é feito no BravoNexo.");
      }
      state.token = String(result.token);
      persistSession(state.token);
      renderPortal(result.data);
    } catch (error) {
      showMessage("codeMessage", error.message, true);
    } finally {
      setBusy(button, false, "Entrar");
    }
  }

  function backToEmail() {
    element("code").value = "";
    showMessage("codeMessage", "");
    showScreen("emailScreen");
    element("email").focus();
  }

  async function restoreSession() {
    if (!state.token) {
      showScreen("emailScreen");
      return;
    }

    showScreen("bootScreen");
    try {
      const data = await callApi("getPortalData", [state.token]);
      if (!isMilitaryPortalData(data)) {
        throw new Error("Este portal é exclusivo para militares.");
      }
      renderPortal(data);
    } catch (error) {
      clearLocalSession();
      showScreen("emailScreen");
      showMessage("emailMessage", "Sua sessão terminou ou não pôde ser recuperada. Solicite um novo código.", true);
    }
  }

  function isMilitaryPortalData(data) {
    if (!data || typeof data !== "object" || !data.user || !data.cycle) return false;
    return !data.role || normalize(data.role) === "MILITAR";
  }

  function renderPortal(data) {
    state.data = data;
    const opportunities = Array.isArray(data.opportunities) ? data.opportunities : [];
    const availableIds = new Set(opportunities.map((opportunity) => String(opportunity.id)));
    state.selected = (Array.isArray(data.preferenceOrder) ? data.preferenceOrder : [])
      .map(String)
      .filter((id) => availableIds.has(id));
    state.dirty = false;

    const user = data.user || {};
    const cycle = data.cycle || {};
    const rankAndName = [user.rank, user.name].filter(Boolean).join(" ");
    element("userName").textContent = rankAndName || "Militar";
    element("userMeta").textContent = [`RG ${user.rg || "—"}`, user.email || ""].filter(Boolean).join(" • ");
    element("position").textContent = user.position ? `#${user.position}` : "—";
    element("balance").textContent = `${Number(user.balance || 0)}h`;
    element("cycle").textContent = cycle.id || "—";

    const eligibleCount = Number(cycle.eligible || 0);
    const grantedCount = Number(cycle.granted || 0);
    const percentage = eligibleCount ? Math.min(100, Math.max(0, Math.round((grantedCount / eligibleCount) * 100))) : 0;
    element("cycleProgress").textContent = `${grantedCount}/${eligibleCount}`;
    element("progressBar").style.width = `${percentage}%`;

    const canCompete = user.eligible !== false;
    element("eligibilityNotice").hidden = canCompete;
    element("eligibilityNotice").textContent = canCompete
      ? ""
      : "Você está temporariamente como Não concorre. As escolhas serão liberadas automaticamente ao fim do impedimento.";
    element("saveBtn").disabled = !canCompete;
    element("openCount").textContent = `${opportunities.length} aberta${opportunities.length === 1 ? "" : "s"}`;

    renderLists();
    showScreen("portal");
  }

  function renderLists() {
    renderOpportunities();
    renderPreferences();
    setSaveHint(state.dirty ? "Alterações ainda não salvas." : "Preferências registradas.");
  }

  function renderOpportunities() {
    const container = element("opportunities");
    container.replaceChildren();
    const user = state.data && state.data.user ? state.data.user : {};
    const opportunities = state.data && Array.isArray(state.data.opportunities) ? state.data.opportunities : [];

    if (user.eligible === false) {
      container.appendChild(createEmpty("Você não concorre enquanto durar o impedimento atual."));
      return;
    }
    if (!opportunities.length) {
      container.appendChild(createEmpty("Não há oportunidades abertas neste momento."));
      return;
    }

    opportunities.forEach((opportunity) => {
      const id = String(opportunity.id || "");
      const selected = state.selected.includes(id);
      const article = document.createElement("article");
      article.className = `opportunity${selected ? " selected" : ""}`;

      const content = document.createElement("div");
      const title = document.createElement("h4");
      title.appendChild(document.createTextNode(`${opportunity.date || "Data a definir"} • ${Number(opportunity.hours || 0)}h `));
      const origin = document.createElement("span");
      origin.className = "pill";
      origin.textContent = opportunity.origin || "RAS";
      title.appendChild(origin);
      content.appendChild(title);

      const metadata = document.createElement("div");
      metadata.className = "meta";
      [
        opportunity.startTime || "Horário a definir",
        opportunity.location || "Local a definir",
        opportunity.role || "Função a definir",
        `Escolher até ${opportunity.deadline || "o encerramento"}`
      ].forEach((value) => {
        const item = document.createElement("span");
        item.textContent = value;
        metadata.appendChild(item);
      });
      content.appendChild(metadata);

      if (opportunity.observations) {
        const note = document.createElement("p");
        note.className = "opportunity-note";
        note.textContent = opportunity.observations;
        content.appendChild(note);
      }

      const button = document.createElement("button");
      button.className = "select-btn";
      button.type = "button";
      button.textContent = selected ? "✓" : "+";
      button.setAttribute("aria-label", `${selected ? "Remover" : "Selecionar"} oportunidade de ${opportunity.date || "data não informada"}`);
      button.setAttribute("aria-pressed", String(selected));
      button.addEventListener("click", () => toggleOpportunity(id));

      article.append(content, button);
      container.appendChild(article);
    });
  }

  function renderPreferences() {
    const container = element("preferences");
    container.replaceChildren();

    if (!state.selected.length) {
      container.appendChild(createEmpty("Selecione uma ou mais oportunidades e organize sua ordem."));
      return;
    }

    state.selected.forEach((id, index) => {
      const opportunity = state.data.opportunities.find((item) => String(item.id) === id);
      if (!opportunity) return;

      const row = document.createElement("div");
      row.className = "preference";
      const order = document.createElement("div");
      order.className = "order";
      order.textContent = String(index + 1);

      const description = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${opportunity.date || "Data a definir"} • ${Number(opportunity.hours || 0)}h`;
      const detail = document.createElement("span");
      detail.textContent = `${opportunity.origin || "RAS"} — ${opportunity.location || opportunity.role || "Local a definir"}`;
      description.append(title, detail);

      const controls = document.createElement("div");
      controls.className = "controls";
      controls.append(
        createControlButton("↑", "Subir preferência", index === 0, () => movePreference(index, -1)),
        createControlButton("↓", "Descer preferência", index === state.selected.length - 1, () => movePreference(index, 1)),
        createControlButton("×", "Remover preferência", false, () => removePreference(index))
      );

      row.append(order, description, controls);
      container.appendChild(row);
    });
  }

  function createControlButton(label, accessibleLabel, disabled, handler) {
    const button = document.createElement("button");
    button.className = "icon-btn";
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", accessibleLabel);
    button.disabled = disabled;
    button.addEventListener("click", handler);
    return button;
  }

  function createEmpty(text) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = text;
    return empty;
  }

  function toggleOpportunity(id) {
    const index = state.selected.indexOf(id);
    if (index >= 0) state.selected.splice(index, 1);
    else state.selected.push(id);
    state.dirty = true;
    renderLists();
  }

  function movePreference(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.selected.length) return;
    [state.selected[index], state.selected[target]] = [state.selected[target], state.selected[index]];
    state.dirty = true;
    renderLists();
  }

  function removePreference(index) {
    state.selected.splice(index, 1);
    state.dirty = true;
    renderLists();
  }

  async function savePreferences() {
    if (!state.token || !state.data || state.data.user.eligible === false) return;
    const button = element("saveBtn");
    setSaveHint("");
    setBusy(button, true, "Salvando");

    try {
      const result = await callApi("savePreferences", [state.token, [...state.selected]]);
      if (!result || !isMilitaryPortalData(result.data)) {
        throw new Error("O servidor não devolveu os dados atualizados do RAS.");
      }
      renderPortal(result.data);
      setSaveHint(result.message || "Preferências registradas com sucesso.", "success");
    } catch (error) {
      setSaveHint(error.message, "error");
    } finally {
      setBusy(button, false, "Salvar preferências");
      if (state.data && state.data.user && state.data.user.eligible === false) button.disabled = true;
    }
  }

  function setSaveHint(text, status) {
    const hint = element("saveHint");
    hint.textContent = text || "";
    hint.classList.toggle("error", status === "error");
    hint.classList.toggle("success", status === "success");
  }

  async function logout() {
    if (state.dirty && !window.confirm("Há alterações ainda não salvas. Deseja sair mesmo assim?")) return;
    const token = state.token;
    clearLocalSession();
    showMessage("emailMessage", "Sessão encerrada.");
    showScreen("emailScreen");
    if (token) await endRemoteSession(token);
  }

  async function endRemoteSession(token) {
    try {
      await callApi("logout", [token]);
    } catch (error) {
      // A sessão local já foi removida; uma falha de rede não deve impedir a saída.
    }
  }

  function clearLocalSession() {
    removeStoredSession();
    state.token = "";
    state.data = null;
    state.selected = [];
    state.dirty = false;
  }

  function maskEmail(email) {
    const parts = String(email || "").split("@");
    const name = parts[0] || "";
    const domain = parts[1] || "";
    return `${name.slice(0, 2) || "*"}***@${domain}`;
  }

  function readStoredSession() {
    try {
      return localStorage.getItem(sessionKey) || "";
    } catch (error) {
      return "";
    }
  }

  function persistSession(token) {
    try {
      localStorage.setItem(sessionKey, token);
    } catch (error) {
      // A sessão continua válida nesta guia mesmo quando o armazenamento está indisponível.
    }
  }

  function removeStoredSession() {
    try {
      localStorage.removeItem(sessionKey);
    } catch (error) {
      // Não há armazenamento local disponível para limpar.
    }
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  }

  async function start() {
    applyUnitConfig();
    bindEvents();
    if (!apiUrl) {
      showScreen("emailScreen");
      showMessage("emailMessage", "O endereço do Controle de RAS não foi configurado para esta unidade.", true);
      element("sendBtn").disabled = true;
      return;
    }
    await restoreSession();
  }

  void start();
}());
