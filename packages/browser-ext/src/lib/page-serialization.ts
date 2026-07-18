const MAX_PAGE_HTML_CHARS = 2_000_000;
const MAX_READABLE_CHARS = 500_000;
const MAX_JSON_LD_CHARS = 100_000;
const MAX_ATTRIBUTE_CHARS = 1_000;

const SENSITIVE_ATTRIBUTE =
  /(?:token|secret|password|passwd|auth|session|cookie|csrf)/i;
const SENSITIVE_QUERY_PARAM =
  /(?:token|secret|password|passwd|auth|session|cookie|csrf|code)/i;

function sanitizeUrl(value: string, baseUrl: string): string {
  try {
    const url = new URL(value, baseUrl);
    url.username = "";
    url.password = "";
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_PARAM.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString().slice(0, MAX_ATTRIBUTE_CHARS);
  } catch {
    return value.slice(0, MAX_ATTRIBUTE_CHARS);
  }
}

function sanitizeElementAttributes(element: Element, baseUrl: string): void {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (
      name.startsWith("on") ||
      name === "value" ||
      name === "srcdoc" ||
      name === "nonce" ||
      name === "ping" ||
      SENSITIVE_ATTRIBUTE.test(name)
    ) {
      element.removeAttribute(attribute.name);
      continue;
    }
    if (name === "href" || name === "src" || name === "action") {
      element.setAttribute(
        attribute.name,
        sanitizeUrl(attribute.value, baseUrl),
      );
      continue;
    }
    if (attribute.value.length > MAX_ATTRIBUTE_CHARS) {
      element.setAttribute(
        attribute.name,
        attribute.value.slice(0, MAX_ATTRIBUTE_CHARS),
      );
    }
  }
}

/** Return the safe, bounded subset of attributes suitable for model context. */
export function serializeSafeElementAttributes(
  element: Element,
  baseUrl = document.baseURI,
): Record<string, string> {
  const clone = element.cloneNode(false) as Element;
  sanitizeElementAttributes(clone, baseUrl);
  return Object.fromEntries(
    Array.from(clone.attributes, ({ name, value }) => [name, value]),
  );
}

/** Return visible-ish element text without form drafts or editable regions. */
export function serializeSafeElementText(
  element: Element,
  maxChars = 200,
): string | undefined {
  const clone = element.cloneNode(true) as Element;
  for (const sensitive of clone.querySelectorAll(
    'script, style, input, textarea, select, [contenteditable], [role="textbox"]',
  )) {
    sensitive.remove();
  }
  if (
    clone.matches(
      'input, textarea, select, [contenteditable], [role="textbox"]',
    )
  ) {
    return undefined;
  }
  const text = clone.textContent?.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maxChars) : undefined;
}

export interface SerializedPage {
  html: string;
  readable: string;
  truncated: boolean;
}

/** Build a bounded, redacted page snapshot for extension-side extraction. */
export function serializePageForExtraction(doc: Document): SerializedPage {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;

  for (const element of clone.querySelectorAll(
    'script:not([type="application/ld+json"]), style, link, svg, iframe, noscript, template, input, textarea, select, [contenteditable], [role="textbox"]',
  )) {
    element.remove();
  }
  for (const script of clone.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    if ((script.textContent?.length ?? 0) > MAX_JSON_LD_CHARS) {
      script.remove();
    }
  }
  for (const element of Array.from(clone.querySelectorAll("*"))) {
    sanitizeElementAttributes(element, doc.baseURI);
  }

  const readableRoot =
    clone.querySelector("main, article") ?? clone.querySelector("body");
  const readableClone = readableRoot?.cloneNode(true) as Element | undefined;
  for (const script of readableClone?.querySelectorAll("script") ?? []) {
    script.remove();
  }
  const readableSource = readableClone?.textContent?.trim() ?? "";
  const readable = readableSource.slice(0, MAX_READABLE_CHARS);

  const serialized = clone.outerHTML;
  const html = serialized.slice(0, MAX_PAGE_HTML_CHARS);
  return {
    html,
    readable,
    truncated:
      serialized.length > MAX_PAGE_HTML_CHARS ||
      readableSource.length > MAX_READABLE_CHARS,
  };
}
