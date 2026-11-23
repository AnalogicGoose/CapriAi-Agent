const payload = new URLSearchParams(location.search).get('layout');
if (payload) {
  const { frame, caption } = JSON.parse(payload);
  const target = document.getElementById('target');
  const label = document.getElementById('caption');
  for (const [element, bounds] of [[target, frame], [label, caption]]) {
    if (!bounds) continue;
    element.style.left = `${bounds.x}px`;
    element.style.top = `${bounds.y}px`;
    if (element === target) {
      element.style.width = `${bounds.width}px`;
      element.style.height = `${bounds.height}px`;
    } else {
      element.style.maxWidth = `${bounds.width}px`;
      element.querySelector('span').textContent = bounds.label;
    }
    element.hidden = false;
  }
}
