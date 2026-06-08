(() => {
  const navigation = document.getElementById("navList");
  if (!navigation) return;

  const pendingView = new URLSearchParams(window.location.search).get("imoflowView");
  if (pendingView) {
    const openPendingView = window.setInterval(() => {
      const button = navigation.querySelector(`[data-view="${pendingView}"]`);
      if (!button || document.querySelector(".app-shell.is-auth-locked")) return;
      window.clearInterval(openPendingView);
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("imoflowView");
      window.history.replaceState({}, "", cleanUrl);
      button.click();
    }, 150);
    window.setTimeout(() => window.clearInterval(openPendingView), 10000);
  }

  navigation.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button || button.dataset.view === "users" || !document.body.classList.contains("cloud-users-view")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set("imoflowView", button.dataset.view);
    window.location.href = targetUrl;
  }, { capture: true });
})();
