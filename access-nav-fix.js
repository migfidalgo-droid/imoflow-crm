(() => {
  const navigation = document.getElementById("navList");
  if (!navigation) return;

  navigation.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button || button.dataset.view === "users" || !document.body.classList.contains("cloud-users-view")) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    document.body.classList.remove("cloud-users-view");
    setView(button.dataset.view);
  }, { capture: true });
})();
