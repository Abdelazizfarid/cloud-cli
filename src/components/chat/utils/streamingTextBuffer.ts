// Pending text that has not been rendered yet.
let pendingChars = '';
// Text already rendered to the DOM.
let renderedText = '';
// The DOM node we write streamed text into.
let streamingTextNode: HTMLSpanElement | null = null;
// requestAnimationFrame id for the typing loop.
let typingRaf = 0;

const CHARS_PER_FRAME = 3;

function typeLoop() {
  typingRaf = 0;
  if (!streamingTextNode || pendingChars.length === 0) {
    return;
  }

  const chunk = pendingChars.slice(0, CHARS_PER_FRAME);
  pendingChars = pendingChars.slice(CHARS_PER_FRAME);
  renderedText += chunk;
  streamingTextNode.textContent = renderedText;

  if (pendingChars.length > 0) {
    typingRaf = requestAnimationFrame(typeLoop);
  }
}

export function appendStreamingText(text: string): void {
  if (!text) {
    return;
  }

  pendingChars += text;
  if (!typingRaf && streamingTextNode) {
    typingRaf = requestAnimationFrame(typeLoop);
  }
}

export function resetStreamingBuffer(initialText = ''): void {
  pendingChars = '';
  renderedText = initialText;
  if (typingRaf) {
    cancelAnimationFrame(typingRaf);
    typingRaf = 0;
  }

  if (streamingTextNode) {
    streamingTextNode.textContent = renderedText;
  }
}

export function flushStreamingBuffer(): string {
  renderedText += pendingChars;
  pendingChars = '';

  if (typingRaf) {
    cancelAnimationFrame(typingRaf);
    typingRaf = 0;
  }

  if (streamingTextNode) {
    streamingTextNode.textContent = renderedText;
  }

  return renderedText;
}

export function attachStreamingTextNode(node: HTMLSpanElement, initialText: string): void {
  streamingTextNode = node;
  renderedText = initialText;
  node.textContent = initialText;

  if (!typingRaf && pendingChars.length > 0) {
    typingRaf = requestAnimationFrame(typeLoop);
  }
}

export function detachStreamingTextNode(node: HTMLSpanElement): void {
  if (streamingTextNode !== node) {
    return;
  }

  streamingTextNode = null;
  if (typingRaf) {
    cancelAnimationFrame(typingRaf);
    typingRaf = 0;
  }
}
