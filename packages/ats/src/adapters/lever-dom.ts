import type { Page } from "playwright";

import type { FieldAnswer, FormField } from "../types.ts";

/** Quotes a form-control name for use inside a CSS attribute selector. */
export const nameSelector = (name: string): string => `[name="${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;

/** Reads every visible, enabled control in the application form and turns it into a FormField. */
export async function extractLeverFields(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    type Opt = { value: string; label: string };
    type Out = {
      id: string;
      label: string;
      type: "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "date" | "email" | "tel" | "number";
      required: boolean;
      options?: Opt[];
      multiple?: boolean;
    };

    const clean = (s: string | null | undefined): string =>
      (s ?? "")
        .replace(/\s+/g, " ")
        .replace(/\s*\*+\s*$/, "")
        .trim();

    /** Text of an element without required markers and without nested controls. */
    const textOf = (el: Element): string => {
      const c = el.cloneNode(true) as Element;
      c.querySelectorAll(".req, [aria-hidden='true'], input, select, textarea, button, script, style").forEach((n) => n.remove());
      return clean(c.textContent);
    };

    const byIds = (ids: string | null): string => {
      if (!ids) return "";
      return clean(
        ids
          .split(/\s+/)
          .map((id) => {
            const n = document.getElementById(id);
            return n ? textOf(n) : "";
          })
          .filter(Boolean)
          .join(" "),
      );
    };

    const ownLabel = (el: HTMLElement): string => {
      const fromAria = byIds(el.getAttribute("aria-labelledby"));
      if (fromAria) return fromAria;
      if (el.id) {
        const l = Array.from(document.querySelectorAll("label")).find((x) => x.htmlFor === el.id);
        if (l) {
          const t = textOf(l);
          if (t) return t;
        }
      }
      const wrap = el.closest("label");
      if (wrap) {
        const t = textOf(wrap);
        if (t) return t;
      }
      return "";
    };

    const groupLabel = (el: HTMLElement): string => {
      const fs = el.closest("fieldset");
      if (fs) {
        const fromAria = byIds(fs.getAttribute("aria-labelledby"));
        if (fromAria) return fromAria;
        const legend = fs.querySelector("legend");
        if (legend) {
          const t = textOf(legend);
          if (t) return t;
        }
        const al = clean(fs.getAttribute("aria-label"));
        if (al) return al;
      }
      const grp = el.closest("[role=radiogroup], [role=group]");
      if (grp) {
        const t = byIds(grp.getAttribute("aria-labelledby")) || clean(grp.getAttribute("aria-label"));
        if (t) return t;
      }
      return "";
    };

    const fallbackLabel = (el: HTMLElement): string => {
      const fs = el.closest("fieldset")?.querySelector("legend");
      return (fs ? textOf(fs) : "") || clean(el.getAttribute("aria-label")) || clean(el.getAttribute("placeholder"));
    };

    const visible = (el: HTMLElement): boolean => {
      if ((el as HTMLInputElement).disabled) return false;
      if (el.closest("[hidden]")) return false;
      if (el.closest("fieldset[disabled]")) return false;
      const type = (el as HTMLInputElement).type;
      // File inputs are often visually hidden behind a styled button; radios/checkboxes likewise.
      if (type === "file" || type === "radio" || type === "checkbox") {
        for (let n: HTMLElement | null = el; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === "none") return false;
        }
        return true;
      }
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      return el.getClientRects().length > 0;
    };

    const isReq = (el: HTMLElement): boolean => (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true";

    const root: ParentNode = document.querySelector("form#application-form") ?? document.querySelector("form") ?? document;
    const controls = Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea"));
    const out: Out[] = [];
    const groups = new Map<string, Out>();

    const optionLabel = (el: HTMLElement): string => ownLabel(el) || clean((el as HTMLInputElement).value);

    for (const el of controls) {
      const name = (el as HTMLInputElement).name;
      const tag = el.tagName.toLowerCase();
      const type = tag === "input" ? ((el as HTMLInputElement).type || "text").toLowerCase() : tag;
      if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
      if (/captcha-response$/i.test(name)) continue;
      if (!name) continue;
      if (!visible(el)) continue;

      if (type === "radio" || type === "checkbox") {
        const key = `${type}:${name}`;
        let g = groups.get(key);
        const same = Array.from(root.querySelectorAll<HTMLInputElement>(`input[type=${type}]`)).filter((x) => x.name === name);
        if (!g) {
          const isGroup = type === "radio" || same.length > 1;
          g = {
            id: name,
            label: isGroup ? groupLabel(el) || fallbackLabel(el) || ownLabel(el) : ownLabel(el) || groupLabel(el) || fallbackLabel(el),
            type,
            required: false,
          };
          if (isGroup) g.options = [];
          if (type === "checkbox" && isGroup) g.multiple = true;
          groups.set(key, g);
          out.push(g);
        }
        if (isReq(el)) g.required = true;
        g.options?.push({ value: (el as HTMLInputElement).value, label: optionLabel(el) });
        continue;
      }

      const label = ownLabel(el) || fallbackLabel(el) || groupLabel(el);
      if (tag === "select") {
        const sel = el as HTMLSelectElement;
        out.push({
          id: name,
          label,
          type: "select",
          required: isReq(el),
          multiple: sel.multiple || undefined,
          options: Array.from(sel.options)
            .filter((o) => o.value !== "" && !o.disabled)
            .map((o) => ({ value: o.value, label: clean(o.textContent) })),
        });
        continue;
      }
      if (tag === "textarea") {
        out.push({ id: name, label, type: "textarea", required: isReq(el) });
        continue;
      }
      const t: Out["type"] =
        type === "file" ? "file" : type === "email" ? "email" : type === "tel" ? "tel" : type === "number" ? "number" : type === "date" ? "date" : "text";
      out.push({ id: name, label, type: t, required: isReq(el) });
    }
    return out.map((f) => {
      if (f.multiple === undefined) delete f.multiple;
      return f;
    });
  });
}

/** Waits for a control to be visible and enabled (conditional questions reveal asynchronously). */
async function waitUsable(page: Page, name: string, label: string): Promise<void> {
  const loc = page.locator(nameSelector(name)).first();
  try {
    await loc.waitFor({ state: "attached", timeout: 3000 });
  } catch {
    throw new Error(`Lever field "${label}" (${name}) was not found on the page`);
  }
  const deadline = Date.now() + 3000;
  for (;;) {
    const usable = await page.evaluate((sel) => {
      const els = Array.from(document.querySelectorAll<HTMLInputElement>(sel));
      return els.some((e) => !e.disabled && !e.closest("[hidden]"));
    }, nameSelector(name));
    if (usable) return;
    if (Date.now() > deadline) throw new Error(`Lever field "${label}" (${name}) is hidden or disabled`);
    await page.waitForTimeout(50);
  }
}

/** Gives dependent questions (`data-depends-on`) a moment to appear after their controller changes. */
async function settleConditionals(page: Page, name: string): Promise<void> {
  const controls = await page.evaluate((n) => document.querySelectorAll(`[data-depends-on="${n.replace(/"/g, '\\"')}"]`).length, name);
  if (controls > 0) await page.waitForTimeout(150);
}

export async function fillLeverField(page: Page, id: string, answer: FieldAnswer): Promise<void> {
  await waitUsable(page, id, id);
  const sel = nameSelector(id);
  const loc = page.locator(`${sel}:not([disabled])`);
  const kind = await loc.first().evaluate((el) => {
    const t = el.tagName.toLowerCase();
    return t === "select" ? ((el as HTMLSelectElement).multiple ? "select-multiple" : "select-one") : t === "input" ? (el as HTMLInputElement).type.toLowerCase() : t;
  });

  if (answer.kind === "file") {
    if (kind !== "file") throw new Error(`Lever field ${id} is not a file input`);
    await loc.first().setInputFiles(answer.path);
    return;
  }

  if (kind === "radio") {
    if (answer.kind !== "option" || answer.values.length !== 1) throw new Error(`Lever radio ${id} needs exactly one option, got ${JSON.stringify(answer)}`);
    const want = answer.values[0]!;
    const target = page.locator(`${sel}:not([disabled])`).and(page.locator(`[value="${want.replace(/"/g, '\\"')}"]`));
    if ((await target.count()) === 0) throw new Error(`Lever radio ${id} has no option "${want}"`);
    await target.first().check();
  } else if (kind === "checkbox") {
    if (answer.kind === "boolean") {
      await loc.first().setChecked(answer.value);
    } else if (answer.kind === "option") {
      const all = await loc.all();
      const values = await Promise.all(all.map((l) => l.inputValue()));
      for (const v of answer.values) if (!values.includes(v)) throw new Error(`Lever checkbox group ${id} has no option "${v}"`);
      for (let i = 0; i < all.length; i++) await all[i]!.setChecked(answer.values.includes(values[i]!));
    } else {
      throw new Error(`Lever checkbox ${id} cannot take a text answer`);
    }
  } else if (kind === "select-one" || kind === "select-multiple") {
    if (answer.kind !== "option") throw new Error(`Lever select ${id} needs an option answer`);
    const have = await loc.first().evaluate((el) => Array.from((el as HTMLSelectElement).options).map((o) => o.value));
    for (const v of answer.values) if (!have.includes(v)) throw new Error(`Lever select ${id} has no option "${v}"`);
    await loc.first().selectOption(answer.values);
  } else if (kind === "file") {
    throw new Error(`Lever field ${id} is a file input but the answer is not a file`);
  } else {
    const value = answer.kind === "text" ? answer.value : answer.kind === "boolean" ? (answer.value ? "Yes" : "No") : answer.values.join(", ");
    await loc.first().fill(value);
  }
  await settleConditionals(page, id);
}
