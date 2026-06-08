(() => {
  const navigation = document.getElementById("navList");
  if (!navigation) return;
  const pendingViewKey = "imoflow-pending-view";

  const pendingView = sessionStorage.getItem(pendingViewKey);
  if (pendingView) {
    const openPendingView = window.setInterval(() => {
      const button = navigation.querySelector(`[data-view="${pendingView}"]`);
      if (!button || document.querySelector(".app-shell.is-auth-locked")) return;
      window.clearInterval(openPendingView);
      sessionStorage.removeItem(pendingViewKey);
      button.click();
    }, 150);
    window.setTimeout(() => window.clearInterval(openPendingView), 10000);
  }

  navigation.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button || button.dataset.view === "users" || !document.body.classList.contains("cloud-users-view")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    sessionStorage.setItem(pendingViewKey, button.dataset.view);
    window.location.reload();
  }, { capture: true });
})();
