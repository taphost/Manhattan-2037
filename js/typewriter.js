export function createTypewriter({ jitterMs = 0 } = {}) {
  const timers = new Map();

  function clear(valueElement) {
    if (!valueElement) return;
    const timer = timers.get(valueElement);
    if (timer) {
      clearTimeout(timer);
      timers.delete(valueElement);
    }
    valueElement.textContent = '';
  }

  function typewrite({
    valueElement,
    labelElement = null,
    label = '',
    value = '',
    charDelayMs,
    onDone,
    withCursor = true,
  }) {
    if (!valueElement) {
      onDone?.();
      return;
    }

    if (labelElement) {
      labelElement.textContent = label;
    }

    clear(valueElement);
    const text = String(value ?? '');
    let index = 0;
    let cursor = null;

    if (withCursor) {
      cursor = document.createElement('span');
      cursor.className = 'cur';
      valueElement.appendChild(cursor);
    }

    function tick() {
      if (index >= text.length) {
        if (cursor) cursor.remove();
        timers.delete(valueElement);
        onDone?.();
        return;
      }

      if (cursor) {
        cursor.before(document.createTextNode(text[index++]));
      } else {
        valueElement.textContent += text[index++];
      }

      const delay = charDelayMs + Math.random() * jitterMs;
      timers.set(valueElement, setTimeout(tick, delay));
    }

    tick();
  }

  return {
    clear,
    typewrite,
  };
}
