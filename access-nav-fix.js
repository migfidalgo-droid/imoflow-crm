(() => {
  window.IMOFLOW_NAV_FIX_VERSION = "7";
  const navigation = document.getElementById("navList");
  if (!navigation) return;
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const navigationHandlers = [];
  let released = false;

  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (!released && this === navigation && type === "click") {
      navigationHandlers.push({ listener, options });
      return;
    }
    return nativeAddEventListener.call(this, type, listener, options);
  };

  window.setTimeout(() => {
    released = true;
    EventTarget.prototype.addEventListener = nativeAddEventListener;
    const effectiveHandler = navigationHandlers.at(-1);
    if (effectiveHandler) {
      nativeAddEventListener.call(navigation, "click", effectiveHandler.listener, effectiveHandler.options);
    }
    window.IMOFLOW_NAV_HANDLER_COUNT = navigationHandlers.length;
  }, 4000);
})();
