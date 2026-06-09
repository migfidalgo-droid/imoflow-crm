(() => {
  window.IMOFLOW_NAV_FIX_VERSION = "6";
  const navigation = document.getElementById("navList");
  if (!navigation) return;
  const pendingViewKey = "imoflowView";

  const clearPendingView = () => {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete(pendingViewKey);
    window.history.replaceState({}, "", cleanUrl);
  };

  const pendingView = new URLSearchParams(window.location.search).get(pendingViewKey);
  if (pendingView) {
    const openPendingView = window.setInterval(() => {
      if (document.querySelector(".app-shell.is-auth-locked")) return;

      if (typeof window.imoflowSetView === "function") {
        window.clearInterval(openPendingView);
        clearPendingView();
        window.imoflowSetView(pendingView);
        return;
      }

      const button = navigation.querySelector(`[data-view="${pendingView}"]`);
      const usersOpen = document.getElementById("pageTitle")?.textContent === "Utilizadores";
      if (button && !usersOpen) {
        window.clearInterval(openPendingView);
        clearPendingView();
        button.click();
      }
    }, 150);
    window.setTimeout(() => window.clearInterval(openPendingView), 10000);
  }

  navigation.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button || button.dataset.view === "users") return;

    if (typeof window.imoflowSetView === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.imoflowSetView(button.dataset.view);
      return;
    }

    const usersOpen = document.getElementById("pageTitle")?.textContent === "Utilizadores";
    if (usersOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const targetUrl = new URL(window.location.href);
      targetUrl.searchParams.set(pendingViewKey, button.dataset.view);
      window.location.assign(targetUrl);
    }
  }, { capture: true });
})();
