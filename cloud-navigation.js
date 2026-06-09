(() => {
  const navigation = document.getElementById("navList");
  if (!navigation) return;

  const bindNavigation = () => {
    if (typeof window.imoflowSetView !== "function") return false;
    if (navigation.dataset.cloudNavigationBound === "true") return true;

    navigation.dataset.cloudNavigationBound = "true";
    const addEventListener = window.imoflowNativeAddNavigation || EventTarget.prototype.addEventListener;
    addEventListener.call(navigation, "click", event => {
      const button = event.target.closest("[data-view]");
      if (!button || button.dataset.view === "users") return;

      event.preventDefault();
      event.stopImmediatePropagation();
      navigation.dataset.lastRequestedView = button.dataset.view;
      try {
        const opened = typeof window.imoflowBaseNavigate === "function"
          && window.imoflowBaseNavigate(button.dataset.view);
        if (!opened) window.imoflowSetView(button.dataset.view);
        navigation.dataset.lastNavigationResult = opened ? "base" : "bridge";
      } catch (error) {
        navigation.dataset.lastNavigationResult = error?.message || "error";
      }
      window.setTimeout(() => {
        navigation.dataset.lastNavigationTitle = document.getElementById("pageTitle")?.textContent || "";
      }, 100);
    }, { capture: true });
    return true;
  };

  if (bindNavigation()) return;
  const timer = window.setInterval(() => {
    if (!bindNavigation()) return;
    window.clearInterval(timer);
  }, 100);
  window.setTimeout(() => window.clearInterval(timer), 15000);
})();
