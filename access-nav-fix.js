(() => {
  const navigation = document.getElementById("navList");
  if (!navigation) return;

  navigation.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button || button.dataset.view === "users" || typeof window.imoflowSetView !== "function") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.imoflowSetView(button.dataset.view);
  }, { capture: true });
})();
