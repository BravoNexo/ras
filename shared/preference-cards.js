(function () {
  "use strict";

  function create(options) {
    const container = options.container;
    const animations = new Map();
    let drag = null;
    let scrollFrame = 0;
    const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rows = () => Array.from(container.querySelectorAll(".preference[data-preference-id]"));
    const idOf = (row) => row.dataset.preferenceId;
    const rectangles = () => new Map(rows().map((row) => [idOf(row), row.getBoundingClientRect()]));

    function stopAnimations() {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    }

    function animateFrom(before, excludedId) {
      stopAnimations();
      if (reducedMotion()) return;
      rows().forEach((row) => {
        const previous = before.get(idOf(row));
        if (!previous || idOf(row) === excludedId || typeof row.animate !== "function") return;
        const current = row.getBoundingClientRect();
        const x = previous.left - current.left;
        const y = previous.top - current.top;
        if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
        const animation = row.animate([
          { transform: `translate(${x}px, ${y}px)` },
          { transform: "translate(0, 0)" }
        ], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
        animations.set(row, animation);
        animation.onfinish = () => animations.delete(row);
      });
    }

    function announce(id, order) {
      options.announce(`Preferência movida para a posição ${order.indexOf(id) + 1} de ${order.length}. Salve para confirmar.`);
    }

    function focusCard(id, action) {
      const row = rows().find((item) => idOf(item) === id);
      if (!row) return;
      const preferred = row.querySelector(`[data-preference-action="${action}"]`);
      const target = preferred && !preferred.disabled ? preferred : row.querySelector(".preference-drag-handle");
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }

    function move(id, delta, action) {
      if (drag || !options.canMove(id)) return;
      const order = options.getOrder();
      const index = order.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= order.length || index === target) return;
      const before = rectangles();
      order.splice(index, 1);
      order.splice(target, 0, id);
      options.onReorder(order);
      animateFrom(before);
      focusCard(id, action || "drag");
      announce(id, order);
    }

    function updateNumbers() {
      rows().forEach((row, index) => {
        row.querySelector(".order").textContent = String(index + 1);
        row.setAttribute("aria-posinset", String(index + 1));
      });
    }

    function restoreOrder(order) {
      const byId = new Map(rows().map((row) => [idOf(row), row]));
      order.forEach((id) => {
        if (byId.has(id)) container.appendChild(byId.get(id));
      });
      updateNumbers();
    }

    function cleanupDrag() {
      const finished = drag;
      if (!finished) return null;
      drag = null;
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      finished.row.classList.remove("is-drag-placeholder");
      if (finished.ghost) finished.ghost.remove();
      container.classList.remove("is-sorting");
      if (container.hasPointerCapture && container.hasPointerCapture(finished.pointerId)) {
        container.releasePointerCapture(finished.pointerId);
      }
      return finished;
    }

    function cancel(silent) {
      const before = drag && drag.active ? rectangles() : null;
      const finished = cleanupDrag();
      stopAnimations();
      if (!finished) return;
      restoreOrder(finished.order);
      if (finished.active && !silent) {
        animateFrom(before);
        focusCard(finished.id, "drag");
        options.announce("Movimento cancelado. A ordem anterior foi mantida.");
      }
    }

    function positionGhost() {
      if (!drag || !drag.ghost) return;
      drag.ghost.style.transform = `translate3d(${drag.left}px, ${drag.clientY - drag.offsetY}px, 0)`;
    }

    function previewPosition() {
      if (!drag || !drag.active) return;
      // Layout positions do not include the animation transform of displaced cards.
      const top = container.getBoundingClientRect().top;
      const center = drag.clientY - drag.offsetY + drag.height / 2;
      const others = rows().filter((row) => row !== drag.row);
      const target = others.find((row) => center < top + row.offsetTop + row.offsetHeight / 2);
      const ordered = rows();
      const index = target ? ordered.indexOf(target) : ordered.length;
      const current = ordered.indexOf(drag.row);
      if (index === current || index === current + 1) return;
      const before = rectangles();
      stopAnimations();
      container.insertBefore(drag.row, target || null);
      updateNumbers();
      animateFrom(before, drag.id);
    }

    function autoScroll() {
      if (!drag || !drag.active) return;
      const edge = Math.min(96, window.innerHeight / 5);
      const y = drag.clientY;
      const speed = y < edge ? -Math.ceil(15 * (1 - Math.max(0, y) / edge))
        : y > window.innerHeight - edge ? Math.ceil(15 * (1 - Math.max(0, window.innerHeight - y) / edge)) : 0;
      if (speed) {
        // "instant" avoids the page's normal smooth-scroll behavior during a drag.
        window.scrollBy({ top: speed, behavior: "instant" });
        previewPosition();
      }
      scrollFrame = window.requestAnimationFrame(autoScroll);
    }

    function activateDrag() {
      const rect = drag.row.getBoundingClientRect();
      stopAnimations();
      drag.active = true;
      drag.left = rect.left;
      drag.height = rect.height;
      drag.offsetY = drag.startY - rect.top;
      drag.ghost = drag.row.cloneNode(true);
      drag.ghost.removeAttribute("data-preference-id");
      drag.ghost.removeAttribute("role");
      drag.ghost.removeAttribute("aria-posinset");
      drag.ghost.removeAttribute("aria-setsize");
      drag.ghost.classList.add("preference-drag-ghost");
      drag.ghost.setAttribute("aria-hidden", "true");
      drag.ghost.inert = true;
      drag.ghost.style.width = `${rect.width}px`;
      document.body.appendChild(drag.ghost);
      drag.row.classList.add("is-drag-placeholder");
      container.classList.add("is-sorting");
      positionGhost();
      scrollFrame = window.requestAnimationFrame(autoScroll);
    }

    container.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest(".preference-drag-handle");
      if (!handle || !container.contains(handle) || handle.disabled || drag ||
          event.button !== 0 || event.isPrimary === false) return;
      const row = handle.closest(".preference");
      const id = idOf(row);
      if (!options.canMove(id) || options.getOrder().length < 2) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      drag = {
        id, row, pointerId: event.pointerId, startX: event.clientX,
        startY: event.clientY, clientY: event.clientY, order: options.getOrder(), active: false
      };
      // Capturing on the stable container survives moving a card within the list.
      if (container.setPointerCapture) container.setPointerCapture(event.pointerId);
    });

    container.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!options.canMove(drag.id)) { cancel(true); return; }
      drag.clientY = event.clientY;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      event.preventDefault();
      if (!drag.active) activateDrag();
      positionGhost();
      previewPosition();
    });

    container.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const before = rectangles();
      if (drag.ghost) before.set(drag.id, drag.ghost.getBoundingClientRect());
      const order = rows().map(idOf);
      const finished = cleanupDrag();
      if (!finished.active) return;
      if (!options.canMove(finished.id)) { restoreOrder(finished.order); return; }
      if (order.some((id, index) => id !== finished.order[index])) {
        options.onReorder(order);
        announce(finished.id, order);
      }
      animateFrom(before);
      focusCard(finished.id, "drag");
    });

    container.addEventListener("pointercancel", (event) => {
      if (drag && drag.pointerId === event.pointerId) cancel();
    });
    container.addEventListener("lostpointercapture", (event) => {
      if (drag && drag.pointerId === event.pointerId) cancel();
    });
    window.addEventListener("blur", () => cancel());
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(true); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drag) { event.preventDefault(); cancel(); }
    });
    container.addEventListener("keydown", (event) => {
      const handle = event.target.closest(".preference-drag-handle");
      if (!handle || handle.disabled || event.altKey || event.ctrlKey || event.metaKey || drag) return;
      const deltas = { ArrowUp: -1, ArrowDown: 1 };
      if (!Object.prototype.hasOwnProperty.call(deltas, event.key)) return;
      event.preventDefault();
      move(idOf(handle.closest(".preference")), deltas[event.key], "drag");
    });
    return { move, cancel: () => cancel(true) };
  }

  window.BravoNexoPreferenceCards = { create };
}());
