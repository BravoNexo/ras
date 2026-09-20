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
    groups: [],
    selected: [],
    preferenceOrder: [],
    dirty: false,
    saving: false,
    saveRequestId: 0
  };

  const element = (id) => document.getElementById(id);

  function applyUnitConfig() {
    document.title = `${config.nomeSistema || "Controle de RAS"} - ${config.nomeUnidade || "Unidade"}`;
    element("systemName").textContent = config.nomeSistema || "Controle de RAS";
    element("unitName").textContent = config.nomeUnidade || "Unidade";
    element("unitFullName").textContent = config.nomeCompletoUnidade || config.nomeUnidade || "Unidade";
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
      state.groups = [];
      state.selected = [];
      state.preferenceOrder = [];
      state.dirty = false;
      state.saving = false;
      state.saveRequestId += 1;
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

  function opportunityGroupingKey(opportunity) {
    opportunity = opportunity && typeof opportunity === "object" ? opportunity : {};
    const text = (value) => String(value == null ? "" : value).trim();
    const date = text(opportunity.date);
    const startTime = text(opportunity.startTime);
    const hours = Number(opportunity.hours);
    const brDate = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const isoDate = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const year = Number(brDate ? brDate[3] : isoDate ? isoDate[1] : 0);
    const month = Number(brDate ? brDate[2] : isoDate ? isoDate[2] : 0);
    const day = Number(brDate ? brDate[1] : isoDate ? isoDate[3] : 0);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const time = startTime.match(/^(\d{2}):(\d{2})$/);
    if (!year || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] ||
        !time || Number(time[1]) > 23 || Number(time[2]) > 59 || !Number.isFinite(hours) || hours <= 0) {
      return "id:" + text(opportunity.id);
    }
    return JSON.stringify([date, startTime, hours, ...["origin", "location", "role", "deadline", "status", "observations"].map((field) => text(opportunity[field]))]);
  }

  function buildOpportunityGroups(opportunities, preferenceOrder) {
    const groups = [];
    const byKey = new Map();
    const seenIds = new Set();
    (Array.isArray(opportunities) ? opportunities : []).forEach((opportunity, index) => {
      if (!opportunity || typeof opportunity !== "object") return;
      const id = String(opportunity.id == null ? "" : opportunity.id).trim();
      if (id && seenIds.has(id)) return;
      if (id) seenIds.add(id);
      const key = id ? opportunityGroupingKey(opportunity) : "missing-id:" + index;
      let group = byKey.get(key);
      if (!group) {
        group = { id: id || "missing-id:" + index, ids: [], opportunity, eligible: true, eligibilityReason: "" };
        byKey.set(key, group);
        groups.push(group);
      }
      if (id) group.ids.push(id);
      if (opportunity.eligible === false) {
        group.eligible = false;
        if (!group.eligibilityReason) group.eligibilityReason = String(opportunity.eligibilityReason || "Você não pode concorrer a este RAS na data do serviço.");
      }
    });
    const previousPosition = new Map();
    (Array.isArray(preferenceOrder) ? preferenceOrder : []).forEach((id, index) => {
      const normalizedId = String(id == null ? "" : id).trim();
      if (!previousPosition.has(normalizedId)) previousPosition.set(normalizedId, index);
    });
    groups.forEach((group) => {
      group.ids.sort((first, second) => (previousPosition.has(first) ? previousPosition.get(first) : Infinity) -
        (previousPosition.has(second) ? previousPosition.get(second) : Infinity));
    });
    return groups;
  }

  function expandedPreferenceIds() {
    const byId = new Map(state.groups.map((group) => [group.id, group]));
    const result = [];
    const seen = new Set();
    state.selected.forEach((id) => {
      const group = byId.get(id);
      if (!group) return;
      group.ids.forEach((memberId) => {
        if (!seen.has(memberId)) { seen.add(memberId); result.push(memberId); }
      });
    });
    return result;
  }

  function vacancyLabel(group) {
    const quantity = group.ids.length || 1;
    return `${quantity} vaga${quantity === 1 ? "" : "s"}`;
  }

  function createServiceWing(opportunity) {
    const wing = opportunity && opportunity.serviceWing;
    const label = document.createElement("span");
    label.className = "service-wing";
    label.textContent = `Ala de serviço: ${Number.isInteger(wing) && wing >= 1 && wing <= 4 ? wing : "não informada"}`;
    return label;
  }

  function canChooseRas() {
    const user = state.data && state.data.user ? state.data.user : {};
    return typeof user.canChoose === "boolean" ? user.canChoose : user.eligible !== false;
  }

  function selectedBlockedGroups() {
    return state.groups.filter((group) => group.eligible === false && state.selected.includes(group.id));
  }

  function createEligibilityReason(group) {
    const reason = document.createElement("p");
    reason.className = "opportunity-eligibility";
    reason.textContent = "Indisponível nesta data: " + group.eligibilityReason;
    return reason;
  }

  function renderPortal(data) {
    state.data = data;
    const opportunities = Array.isArray(data.opportunities) ? data.opportunities : [];
    state.preferenceOrder = (Array.isArray(data.preferenceOrder) ? data.preferenceOrder : [])
      .map((id) => String(id == null ? "" : id).trim());
    state.groups = buildOpportunityGroups(opportunities, state.preferenceOrder);
    const groupByMember = new Map();
    state.groups.forEach((group) => group.ids.forEach((id) => groupByMember.set(id, group.id)));
    state.selected = [...new Set(state.preferenceOrder.map((id) => groupByMember.get(id)).filter(Boolean))];
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

    const canCompete = canChooseRas();
    element("eligibilityNotice").hidden = false;
    element("eligibilityNotice").classList.toggle("warning", !canCompete);
    element("eligibilityNotice").textContent = user.eligibilityNotice || (canCompete
      ? "A aptidão é verificada na data de cada RAS. Férias não impedem a concorrência."
      : "Sua participação no RAS não está liberada. Consulte a administração para verificar a definição de concorrência e o acesso.");
    if (!state.saving) setBusy(element("saveBtn"), false, "Salvar preferências");
    element("saveBtn").disabled = !canCompete || state.saving;
    const openVacancies = state.groups.reduce((total, group) => total + group.ids.length, 0);
    element("openCount").textContent = `${openVacancies} vaga${openVacancies === 1 ? "" : "s"} aberta${openVacancies === 1 ? "" : "s"}`;

    renderLists();
    showScreen("portal");
  }

  function renderLists() {
    renderOpportunities();
    renderPreferences();
    setSaveHint(selectedBlockedGroups().length
      ? "Há preferências indisponíveis na data do serviço. Confira os motivos e remova essas opções antes de salvar."
      : state.dirty ? "Alterações ainda não salvas." : "Preferências registradas.");
  }

  function renderOpportunities() {
    const container = element("opportunities");
    container.replaceChildren();
    const groups = state.groups;

    if (!canChooseRas()) {
      container.appendChild(createEmpty("Você não concorre ao RAS: sua participação não está liberada. Consulte a administração."));
      return;
    }
    if (!groups.length) {
      container.appendChild(createEmpty("Não há oportunidades abertas neste momento."));
      return;
    }

    groups.forEach((group) => {
      const opportunity = group.opportunity;
      const id = group.id;
      const selected = state.selected.includes(id);
      const article = document.createElement("article");
      article.className = `opportunity${selected ? " selected" : ""}${group.eligible === false ? " unavailable" : ""}`;

      const content = document.createElement("div");
      const title = document.createElement("h4");
      title.appendChild(document.createTextNode(`${opportunity.date || "Data a definir"} • ${Number(opportunity.hours || 0)}h `));
      const origin = document.createElement("span");
      origin.className = "pill";
      origin.textContent = opportunity.origin || "RAS";
      title.appendChild(origin);
      const quantity = document.createElement("span");
      quantity.className = "pill vacancy-count";
      quantity.textContent = vacancyLabel(group);
      title.appendChild(quantity);
      content.appendChild(title);
      content.appendChild(createServiceWing(opportunity));

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

      if (opportunity.status) {
        const status = document.createElement("span");
        status.textContent = `Situação: ${opportunity.status}`;
        metadata.appendChild(status);
      }

      if (opportunity.observations) {
        const note = document.createElement("p");
        note.className = "opportunity-note";
        note.textContent = opportunity.observations;
        content.appendChild(note);
      }
      if (group.eligible === false) content.appendChild(createEligibilityReason(group));

      const button = document.createElement("button");
      button.className = "select-btn";
      button.type = "button";
      button.textContent = selected ? "✓" : "+";
      button.disabled = state.saving || !group.ids.length || (group.eligible === false && !selected);
      if (group.eligible === false) button.title = group.eligibilityReason;
      if (!group.ids.length) button.title = "Oportunidade sem identificador. Atualize o portal ou avise a administração.";
      button.setAttribute("aria-label", `${selected ? "Remover" : "Selecionar"} opção de ${opportunity.date || "data não informada"}, ${opportunity.startTime || "horário não informado"}, ${opportunity.location || "local não informado"}, ${opportunity.role || "função não informada"}, ${vacancyLabel(group)}`);
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
      const group = state.groups.find((item) => item.id === id);
      if (!group) return;
      const opportunity = group.opportunity;

      const row = document.createElement("div");
      row.className = "preference" + (group.eligible === false ? " unavailable" : "");
      const order = document.createElement("div");
      order.className = "order";
      order.textContent = String(index + 1);

      const description = document.createElement("div");
      description.className = "preference-description";
      const title = document.createElement("strong");
      title.textContent = `${opportunity.date || "Data a definir"} • ${opportunity.startTime || "Horário a definir"} • ${Number(opportunity.hours || 0)}h`;
      const quantity = document.createElement("span");
      quantity.className = "preference-quantity";
      quantity.textContent = vacancyLabel(group);
      const detail = document.createElement("span");
      detail.textContent = `${opportunity.origin || "RAS"} • ${opportunity.location || "Local a definir"} • ${opportunity.role || "Função a definir"}`;
      const deadline = document.createElement("span");
      deadline.textContent = `Escolher até ${opportunity.deadline || "o encerramento"}${opportunity.status ? ` • ${opportunity.status}` : ""}`;
      description.append(title, createServiceWing(opportunity), quantity, detail, deadline);
      if (group.eligible === false) description.appendChild(createEligibilityReason(group));
      if (opportunity.observations) {
        const note = document.createElement("span");
        note.className = "preference-note";
        note.textContent = opportunity.observations;
        description.appendChild(note);
      }

      const controls = document.createElement("div");
      controls.className = "controls";
      controls.append(
        createControlButton("↑", "Subir preferência", index === 0 || group.eligible === false, () => movePreference(index, -1)),
        createControlButton("↓", "Descer preferência", index === state.selected.length - 1 || group.eligible === false, () => movePreference(index, 1)),
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
    button.disabled = disabled || state.saving || !canChooseRas();
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
    if (state.saving || !state.data || !canChooseRas()) return;
    const group = state.groups.find((item) => item.id === id);
    if (!group || !group.ids.length) return;
    const index = state.selected.indexOf(id);
    if (index >= 0) state.selected.splice(index, 1);
    else if (group.eligible !== false) state.selected.push(id);
    else return;
    state.dirty = true;
    renderLists();
  }

  function movePreference(index, delta) {
    if (state.saving || !state.data || !canChooseRas()) return;
    if (state.groups.some((group) => group.id === state.selected[index] && group.eligible === false)) return;
    const target = index + delta;
    if (target < 0 || target >= state.selected.length) return;
    [state.selected[index], state.selected[target]] = [state.selected[target], state.selected[index]];
    state.dirty = true;
    renderLists();
  }

  function removePreference(index) {
    if (state.saving || !state.data || !canChooseRas()) return;
    state.selected.splice(index, 1);
    state.dirty = true;
    renderLists();
  }

  async function savePreferences() {
    if (state.saving || !state.token || !state.data || !canChooseRas()) return;
    if (selectedBlockedGroups().length) {
      setSaveHint("Remova das preferências as opções indisponíveis na data do serviço antes de salvar. As demais escolhas serão mantidas.", "error");
      return;
    }
    const token = state.token;
    const requestId = ++state.saveRequestId;
    const ids = expandedPreferenceIds();
    const stillCurrent = () => state.token === token && state.saveRequestId === requestId;
    state.saving = true;
    const button = element("saveBtn");
    setBusy(button, true, "Salvando");
    renderLists();
    setSaveHint("Salvando preferências… Aguarde para continuar editando.");

    try {
      const result = await callApi("savePreferences", [token, ids]);
      if (!stillCurrent()) return;
      if (!result || !isMilitaryPortalData(result.data)) {
        throw new Error("O servidor não devolveu os dados atualizados do RAS.");
      }
      state.saving = false;
      renderPortal(result.data);
      setSaveHint(result.message || "Preferências registradas com sucesso.", "success");
    } catch (error) {
      if (!stillCurrent()) return;
      state.saving = false;
      renderLists();
      setSaveHint(error.message, "error");
    } finally {
      if (stillCurrent()) {
        state.saving = false;
        setBusy(button, false, "Salvar preferências");
        if (!canChooseRas()) button.disabled = true;
      }
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
    state.groups = [];
    state.selected = [];
    state.preferenceOrder = [];
    state.dirty = false;
    state.saving = false;
    state.saveRequestId += 1;
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
