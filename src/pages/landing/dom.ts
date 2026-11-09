type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

/** Create an element. `on<event>` attributes become listeners; false, null and undefined are skipped. */
export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "html") {
      el.innerHTML = String(value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "number" ? String(child) : child);
  }
  return el;
};

let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;

/** Copy text, falling back to a hidden textarea where the async clipboard is unavailable. */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { class: "visually-hidden", readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
};
