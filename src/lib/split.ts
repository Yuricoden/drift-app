/**
 * Splits an element's text content into word spans (class .w),
 * preserving nested inline elements (e.g. <em>). Returns the spans.
 */
export function splitWords(el: HTMLElement): HTMLElement[] {
  const words: HTMLElement[] = [];

  const splitNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      const frag = document.createDocumentFragment();
      text.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(' '));
        } else {
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = part;
          words.push(span);
          frag.appendChild(span);
        }
      });
      node.parentNode?.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      Array.from(node.childNodes).forEach(splitNode);
    }
  };

  Array.from(el.childNodes).forEach(splitNode);
  return words;
}
