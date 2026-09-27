(function () {
  'use strict';
  window.createRasPortalServices = function (options) {
    const state = options.state;
    const callApi = options.callApi;
    let epoch = 0;
    let listRequest = 0;
    let pendingSubmit = false;
    let services = [];
    let dialogRecord = null;
    let lastFocus = null;
    const requestKeys = new Map();
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const button = (text, handler, className) => {
      const node = el('button', className || 'btn btn-light', text);
      node.type = 'button';
      node.addEventListener('click', handler);
      return node;
    };
    const panel = el('section', 'card panel ras-services-panel');
    panel.setAttribute('aria-labelledby', 'rasServicesTitle');
    const header = el('div', 'panel-head');
    const heading = el('div');
    const title = el('h3', '', 'Meus RAS e cancelamentos');
    title.id = 'rasServicesTitle';
    heading.append(title, el('small', '', 'Consulte suas concessões e solicite um cancelamento à administração.'));
    const toggle = button('Consultar meus RAS', () => {
      if (!body.hidden) { body.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Consultar meus RAS'; return; }
      body.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.textContent = 'Recolher';
      void loadServices();
    });
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'rasServicesBody');
    header.append(heading, toggle);
    const body = el('div');
    body.id = 'rasServicesBody';
    body.hidden = true;
    const refresh = button('Atualizar meus RAS', () => void loadServices());
    const message = el('p', 'message');
    message.setAttribute('role', 'status');
    message.hidden = true;
    const list = el('div', 'ras-services-list');
    body.append(refresh, message, list);
    panel.append(header, body);
    document.getElementById('portal').append(panel);

    const dialog = el('dialog', 'ras-cancel-dialog');
    dialog.setAttribute('aria-labelledby', 'rasCancelTitle');
    const form = el('form');
    const dialogTitle = el('h3', '', 'Solicitar cancelamento');
    dialogTitle.id = 'rasCancelTitle';
    const summary = el('p');
    const notice = el('p', 'notice warning', 'O RAS continuará agendado até a aprovação da administração. Não deixe de cumprir o serviço sem essa autorização.');
    const label = el('label', '', 'Motivo do pedido');
    label.htmlFor = 'rasCancelReason';
    const reason = el('textarea');
    reason.id = 'rasCancelReason'; reason.required = true; reason.maxLength = 500; reason.rows = 4;
    reason.placeholder = 'Informe o motivo para a administração (até 500 caracteres).';
    const result = el('p', 'message'); result.setAttribute('role', 'status'); result.hidden = true;
    const actions = el('div', 'ras-dialog-actions');
    const close = button('Voltar', () => { if (!pendingSubmit) dialog.close(); });
    const submit = el('button', 'btn btn-primary', 'Enviar pedido'); submit.type = 'submit';
    actions.append(close, submit);
    form.append(dialogTitle, summary, notice, label, reason, result, actions);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener('cancel', (event) => { if (pendingSubmit) event.preventDefault(); });
    dialog.addEventListener('close', () => { if (lastFocus && lastFocus.isConnected) lastFocus.focus(); });
    form.addEventListener('submit', sendCancellation);

    function feedback(target, text, error) {
      target.textContent = text; target.hidden = !text; target.classList.toggle('error', Boolean(error));
    }
    function current(token, generation) { return state.token === token && epoch === generation && !!state.data; }
    function describe(service) {
      return [service.date, service.startTime, `${Number(service.hours || 0)}h`, service.origin, service.location, service.role].filter(Boolean).join(' • ');
    }
    function requestLabel(request) {
      if (!request) return '';
      const status = request.status || request.situation || '';
      return {PENDENTE: 'Aguardando aprovação', APROVADA: 'Aprovado', REJEITADA: 'Rejeitado', RESOLVIDA: 'RAS já cancelado', ENCERRADA: 'RAS já finalizado'}[status] || status;
    }
    async function loadServices() {
      if (!state.token || !state.data || pendingSubmit) return;
      const token = state.token, generation = epoch, number = ++listRequest;
      refresh.disabled = true;
      feedback(message, 'Consultando seus RAS…');
      try {
        const data = await callApi('getMyRasServices', [token]);
        if (!current(token, generation) || number !== listRequest) return;
        if (!data || !Array.isArray(data.services)) throw new Error('O servidor não devolveu seus RAS. Tente atualizar novamente.');
        services = data.services;
        renderServices(data);
        feedback(message, data.truncated ? 'Exibindo os registros mais recentes. Para registros antigos, consulte a administração.' : 'Dados atualizados. Solicitar cancelamento não altera suas preferências.');
      } catch (error) {
        if (current(token, generation) && number === listRequest) feedback(message, error.message, true);
      } finally {
        if (current(token, generation) && number === listRequest) refresh.disabled = false;
      }
    }
    function renderServices(data) {
      list.replaceChildren();
      if (!services.length) list.append(el('p', 'empty', 'Você não possui RAS concedidos para exibir.'));
      services.forEach((service) => {
        const card = el('article', 'ras-service');
        card.append(el('h4', '', `${service.date || 'Data não informada'} • ${service.startTime || 'Horário não informado'}`));
        card.append(el('p', 'meta', [service.origin, service.location, service.role, `${Number(service.hours || 0)}h`].filter(Boolean).join(' • ')));
        card.append(el('span', 'pill', service.situation || 'Situação não informada'));
        if (service.cancellationRequest) {
          const request = service.cancellationRequest;
          card.append(el('p', 'ras-cancel-status', 'Pedido de cancelamento: ' + requestLabel(request)));
          if (request.reason) card.append(el('p', 'ras-request-reason', 'Motivo: ' + request.reason));
          if (request.decisionReason) card.append(el('p', 'ras-request-reason', 'Administração: ' + request.decisionReason));
        }
        if (service.canRequestCancellation === true) {
          const action = button('Solicitar cancelamento', () => openCancellation(service, action), 'btn ras-cancel-button');
          card.append(action);
        } else if (service.cancellationBlockReason) {
          card.append(el('p', 'ras-service-help', service.cancellationBlockReason));
        }
        list.append(card);
      });
      const shown = new Set(services.map((service) => service.cancellationRequest && service.cancellationRequest.id).filter(Boolean));
      const history = (Array.isArray(data.cancellationRequests) ? data.cancellationRequests : []).filter((request) => !shown.has(request.id));
      if (history.length) {
        const details = el('details', 'ras-request-history');
        details.append(el('summary', '', 'Outros pedidos de cancelamento'));
        history.forEach((request) => {
          details.append(el('p', '', [request.date || request.requestedAt, requestLabel(request), request.reason, request.decisionReason].filter(Boolean).join(' • ')));
        });
        list.append(details);
      }
    }
    function openCancellation(service, source) {
      if (!state.token || pendingSubmit || service.canRequestCancellation !== true) return;
      dialogRecord = service;
      lastFocus = source;
      summary.textContent = describe(service);
      reason.value = '';
      feedback(result, '');
      dialog.showModal();
      reason.focus();
    }
    async function sendCancellation(event) {
      event.preventDefault();
      if (pendingSubmit || !dialogRecord || !state.token) return;
      const text = reason.value.trim();
      if (!text) { feedback(result, 'Informe o motivo do pedido.', true); reason.focus(); return; }
      const token = state.token, generation = epoch, service = dialogRecord;
      if (!requestKeys.has(service.id)) requestKeys.set(service.id, crypto.randomUUID());
      pendingSubmit = true; submit.disabled = true; close.disabled = true; reason.disabled = true;
      feedback(result, 'Enviando pedido…');
      let success = false;
      try {
        const data = await callApi('requestRasCancellation', [token, {recordId: service.id, reason: text, idempotencyKey: requestKeys.get(service.id)}]);
        if (!current(token, generation)) return;
        if (!data || data.ok !== true) throw new Error('Não foi possível confirmar o pedido. Atualize seus RAS antes de tentar novamente.');
        success = true;
        feedback(result, data.message || 'Pedido enviado. Aguarde a decisão da administração.');
        requestKeys.delete(service.id);
      } catch (error) {
        if (current(token, generation)) feedback(result, error.message + ' Se a resposta foi interrompida, atualize seus RAS para conferir se o pedido entrou.', true);
      } finally {
        if (current(token, generation)) {
          pendingSubmit = false; submit.disabled = false; close.disabled = false; reason.disabled = false;
          if (success) { dialog.close(); await loadServices(); }
        }
      }
    }
    function addParticipants(content, group) {
      const details = el('details', 'ras-participants');
      const summaryNode = el('summary', '', 'Ver inscritos');
      const container = el('div', 'ras-participants-content');
      const status = el('p'); status.setAttribute('role', 'status');
      const names = el('ul');
      const reload = button('Atualizar inscritos', () => void load());
      container.append(status, names, reload);
      details.append(summaryNode, container);
      let busy = false, loaded = false;
      async function load() {
        if (busy || !state.token || !details.isConnected) return;
        const token = state.token, generation = epoch;
        busy = true; reload.disabled = true; status.textContent = 'Consultando inscrições salvas…';
        try {
          const data = await callApi('getOpportunityParticipants', [token, group.id]);
          if (!current(token, generation) || !details.isConnected) return;
          if (!data || !Array.isArray(data.participants)) throw new Error('Não foi possível conferir os inscritos.');
          names.replaceChildren();
          data.participants.forEach((person) => names.append(el('li', '', [person.rank, person.name].filter(Boolean).join(' '))));
          summaryNode.textContent = `${data.participants.length} inscrito${data.participants.length === 1 ? '' : 's'}`;
          status.textContent = (data.participants.length ? '' : 'Nenhuma inscrição salva ainda. ') + (data.notice || 'Inscrições salvas, em ordem alfabética. Esta lista não é a fila de concessão.');
          loaded = true;
        } catch (error) {
          if (current(token, generation) && details.isConnected) status.textContent = error.message;
        } finally {
          busy = false; reload.disabled = false;
        }
      }
      details.addEventListener('toggle', () => { if (details.open && !loaded) void load(); });
      content.append(details);
    }
    function reset() {
      epoch += 1; listRequest += 1; services = []; pendingSubmit = false; dialogRecord = null; lastFocus = null;
      requestKeys.clear(); list.replaceChildren(); body.hidden = true; message.hidden = true;
      refresh.disabled = false; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Consultar meus RAS';
      submit.disabled = false; close.disabled = false; reason.disabled = false; reason.value = '';
      if (dialog.open) dialog.close();
    }
    return {addParticipants, reset};
  };
}());
