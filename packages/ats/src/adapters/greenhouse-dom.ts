/**
 * DOM helpers for the Greenhouse adapter. The in-page scripts are plain strings, not functions:
 * functions passed to page.evaluate get rewritten by tsx/esbuild (`__name`) and then fail in the page.
 */
import type { Locator, Page } from "playwright";

import type { FieldAnswer, FormField } from "../types.ts";

export type RawField = FormField & { needsOpen?: boolean; listboxId?: string };

/** Extracts every visible, enabled control in the application form. Returns RawField[]. */
export const EXTRACT_SCRIPT = `(() => {
  var root = document.querySelector('#application-form');
  if (!root) {
    var forms = [].slice.call(document.querySelectorAll('form'));
    root = forms.filter(function (f) { return f.querySelector('button[type=submit],input[type=submit]'); })[0] || forms[0];
  }
  if (!root) return [];
  var q = function (s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'); };
  var norm = function (s) { return (s || '').replace(/\\s+/g, ' ').trim(); };
  var hiddenAnc = function (el) {
    for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (n.hidden || n.hasAttribute('hidden')) return true;
      if (getComputedStyle(n).display === 'none') return true;
    }
    return false;
  };
  var textOf = function (node) {
    if (!node) return { text: '', star: false };
    var c = node.cloneNode(true);
    [].forEach.call(c.querySelectorAll('input,select,textarea,script,style,ul[role=listbox]'), function (x) { x.remove(); });
    var raw = norm(c.textContent);
    [].forEach.call(c.querySelectorAll('.req,[aria-hidden=true]'), function (x) { x.remove(); });
    var text = norm(c.textContent).replace(/\\s*\\*+\\s*$/, '').trim();
    return { text: text, star: raw.indexOf('*') !== -1 };
  };
  var byIds = function (ids) {
    var parts = [], star = false;
    ids.split(/\\s+/).forEach(function (id) {
      var r = textOf(document.getElementById(id));
      if (r.text) parts.push(r.text);
      if (r.star) star = true;
    });
    return { text: parts.join(' '), star: star };
  };
  var forLabel = function (el) {
    if (el.id) {
      var l = document.querySelectorAll('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]');
      for (var i = 0; i < l.length; i++) { var r = textOf(l[i]); if (r.text) return r; }
    }
    var w = el.closest('label');
    if (w) { var r2 = textOf(w); if (r2.text) return r2; }
    return null;
  };
  var legendOf = function (el) {
    var fs = el.closest('fieldset');
    var lg = fs && fs.querySelector('legend');
    if (lg) { var r = textOf(lg); if (r.text) return r; }
    return null;
  };
  var groupLabel = function (first) {
    var box = first.closest('fieldset,[role=radiogroup],[role=group]');
    if (box) {
      var lb = box.getAttribute('aria-labelledby');
      if (lb) { var r = byIds(lb); if (r.text) return r; }
      var lg = box.querySelector('legend');
      if (lg) { var r2 = textOf(lg); if (r2.text) return r2; }
      var al = box.getAttribute('aria-label');
      if (al) return { text: norm(al), star: false };
    }
    return null;
  };
  var labelOf = function (el) {
    var lb = el.getAttribute('aria-labelledby');
    if (lb) { var r = byIds(lb); if (r.text) return r; }
    return forLabel(el) || legendOf(el) ||
      (el.getAttribute('aria-label') ? { text: norm(el.getAttribute('aria-label')), star: false } : null) ||
      (el.getAttribute('placeholder') ? { text: norm(el.getAttribute('placeholder')), star: false } : null) ||
      { text: el.name || el.id || '', star: false };
  };
  var optionLabel = function (el) {
    var r = forLabel(el);
    if (r) return r.text;
    if (el.getAttribute('aria-label')) return norm(el.getAttribute('aria-label'));
    return el.value;
  };
  var usable = function (el) {
    if (el.disabled || el.closest('fieldset[disabled]')) return false;
    if (el.closest('[role=listbox]')) return false;
    if (hiddenAnc(el)) return false;
    var t = (el.type || '').toLowerCase();
    if (t !== 'file' && t !== 'radio' && t !== 'checkbox' && getComputedStyle(el).visibility === 'hidden') return false;
    return true;
  };
  var out = [], seen = {};
  var els = [].slice.call(root.querySelectorAll('input,select,textarea'));
  els.forEach(function (el) {
    var tag = el.tagName.toLowerCase();
    var type = (el.type || '').toLowerCase();
    if (tag === 'input' && ['hidden', 'submit', 'button', 'image', 'reset'].indexOf(type) !== -1) return;
    if (!usable(el)) return;
    var aria = el.getAttribute('aria-required') === 'true';
    if (tag === 'input' && el.getAttribute('role') === 'combobox') {
      var id = el.id || el.name;
      if (!id || seen['c:' + id]) return;
      seen['c:' + id] = 1;
      var lab = labelOf(el);
      var wrap = el.closest('[data-options]');
      var options = null;
      if (wrap) {
        try {
          var arr = JSON.parse(wrap.getAttribute('data-options'));
          options = arr.map(function (o) {
            return typeof o === 'string' ? { value: o, label: o } : { value: String(o.value !== undefined ? o.value : o.label), label: String(o.label !== undefined ? o.label : o.value) };
          });
        } catch (e) { options = null; }
      }
      out.push({ id: id, label: lab.text, type: 'select', required: el.required || aria || lab.star, options: options || undefined, needsOpen: !options, listboxId: el.getAttribute('aria-controls') || undefined });
      return;
    }
    if (type === 'radio') {
      var name = el.name;
      if (!name || seen['g:' + name]) return;
      seen['g:' + name] = 1;
      var group = els.filter(function (x) { return x.type === 'radio' && x.name === name && usable(x); });
      var gl = groupLabel(group[0]) || { text: name, star: false };
      var box = group[0].closest('fieldset,[role=radiogroup]');
      out.push({
        id: name, label: gl.text, type: 'radio',
        required: group.some(function (x) { return x.required || x.getAttribute('aria-required') === 'true'; }) || gl.star || !!(box && box.getAttribute('aria-required') === 'true'),
        options: group.map(function (x) { return { value: x.value, label: optionLabel(x) }; })
      });
      return;
    }
    if (type === 'checkbox') {
      var cname = el.name;
      var cgroup = cname ? els.filter(function (x) { return x.type === 'checkbox' && x.name === cname && usable(x); }) : [el];
      if (cname) { if (seen['g:' + cname]) return; seen['g:' + cname] = 1; }
      if (cgroup.length > 1) {
        var cl = groupLabel(cgroup[0]) || { text: cname, star: false };
        var cbox = cgroup[0].closest('fieldset,[role=group]');
        out.push({
          id: cname, label: cl.text, type: 'checkbox', multiple: true,
          required: cgroup.some(function (x) { return x.required || x.getAttribute('aria-required') === 'true'; }) || cl.star || !!(cbox && cbox.getAttribute('aria-required') === 'true'),
          options: cgroup.map(function (x) { return { value: x.value, label: optionLabel(x) }; })
        });
      } else {
        var sl = forLabel(el) || labelOf(el);
        var sid = cname || el.id;
        if (!sid) return;
        out.push({ id: sid, label: sl.text, type: 'checkbox', required: el.required || aria || sl.star });
      }
      return;
    }
    var fid = el.name || el.id;
    if (!fid || seen['f:' + fid]) return;
    seen['f:' + fid] = 1;
    var l = labelOf(el);
    var required = el.required || aria || l.star;
    if (tag === 'select') {
      var opts = [].slice.call(el.options).filter(function (o) { return o.value !== '' && !o.disabled; }).map(function (o) { return { value: o.value, label: norm(o.textContent) }; });
      out.push({ id: fid, label: l.text, type: 'select', required: required, options: opts, multiple: el.multiple || undefined });
    } else if (tag === 'textarea') {
      out.push({ id: fid, label: l.text, type: 'textarea', required: required });
    } else if (type === 'file') {
      out.push({ id: fid, label: l.text, type: 'file', required: required });
    } else {
      var t = ['email', 'tel', 'number', 'date'].indexOf(type) !== -1 ? type : 'text';
      out.push({ id: fid, label: l.text, type: t, required: required });
    }
  });
  return out;
})()`;

/** Turns a source string into a real function (locator.evaluate does not invoke strings). */
const compile = <A, R>(src: string): ((arg: A) => R) => new Function(`return (${src})`)() as (arg: A) => R;

const KIND_SCRIPT = `(el) => ({ tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), role: el.getAttribute('role') || '', name: el.name || '', multiple: !!el.multiple })`;

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export async function extractRaw(page: Page): Promise<RawField[]> {
  return (await page.evaluate(EXTRACT_SCRIPT)) as RawField[];
}

/** Reads combobox options by opening the listbox, then closes it with Escape. */
export async function readComboboxOptions(page: Page, f: RawField): Promise<{ value: string; label: string }[]> {
  const input = page.locator(`[id="${esc(f.id)}"]`).first();
  await input.click({ timeout: 5000 });
  const opts = listboxOptions(page, f.listboxId);
  try {
    await opts.first().waitFor({ timeout: 3000 });
  } catch {
    await page.keyboard.press("Escape");
    return [];
  }
  const labels = (await opts.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  await page.keyboard.press("Escape");
  return labels.map((l) => ({ value: l, label: l }));
}

function listboxOptions(page: Page, listboxId?: string | null): Locator {
  return listboxId ? page.locator(`[id="${esc(listboxId)}"] [role=option]`) : page.locator(`[role=listbox] [role=option]`);
}

type Kind = { tag: string; type: string; role: string; name: string; multiple: boolean };

async function findControl(page: Page, id: string): Promise<{ loc: Locator; kind: Kind }> {
  const byId = page.locator(`[id="${esc(id)}"]`);
  const nameSel = ["input", "select", "textarea"].map((t) => `${t}[name="${esc(id)}"]:not([type=hidden])`).join(", ");
  const byName = page.locator(nameSel);
  const loc = (await byId.count()) > 0 ? byId.first() : byName.first();
  if ((await loc.count()) === 0) throw new Error(`Greenhouse: field "${id}" not found on the page`);
  return { loc, kind: (await loc.evaluate(compile<Element, Kind>(KIND_SCRIPT))) as Kind };
}

function wantedValues(a: FieldAnswer): string[] {
  switch (a.kind) {
    case "option":
      return a.values;
    case "text":
      return [a.value];
    case "boolean":
      return [a.value ? "Yes" : "No"];
    case "file":
      return [];
  }
}

async function fillCombobox(page: Page, id: string, loc: Locator, wanted: string[]): Promise<void> {
  if (wanted.length !== 1) throw new Error(`Greenhouse: "${id}" is a single-choice dropdown but got ${wanted.length} values`);
  // data-options may map posted values to labels.
  const mapScript = `(el) => { var v = ${JSON.stringify(wanted[0])}; var w = el.closest('[data-options]'); if (!w) return null; try { var a = JSON.parse(w.getAttribute('data-options')); var m = a.filter(function (o) { return o && typeof o === 'object' && String(o.value) === v; })[0]; return m ? String(m.label) : null; } catch (e) { return null; } }`;
  const mapped = (await loc.evaluate(compile<Element, string | null>(mapScript)).catch(() => null)) as string | null;
  const targets = [wanted[0], mapped].filter((x): x is string => !!x).map(norm);
  const listboxId = await loc.getAttribute("aria-controls");
  const hidden = loc.locator(`xpath=ancestor::*[@data-combobox][1]//input[@type="hidden"]`);
  const before = (await hidden.count()) > 0 ? await hidden.first().inputValue() : null;

  await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
  await loc.click({ timeout: 5000 });
  const opts = listboxOptions(page, listboxId);
  const find = async (): Promise<Locator | null> => {
    try {
      await opts.first().waitFor({ timeout: 3000 });
    } catch {
      return null;
    }
    const texts = await opts.allTextContents();
    const i = texts.findIndex((t) => targets.includes(norm(t)));
    return i >= 0 ? opts.nth(i) : null;
  };
  let option = await find();
  if (!option) {
    // Long or filtered lists: type to narrow, then look again.
    await loc.fill(wanted[0] ?? "").catch(() => undefined);
    option = await find();
  }
  if (!option) {
    const available = (await opts.allTextContents().catch(() => [])).map((t) => t.trim());
    await page.keyboard.press("Escape");
    throw new Error(`Greenhouse: no option "${wanted[0]}" in dropdown "${id}" (available: ${available.join(" | ") || "none"})`);
  }
  await option.click({ timeout: 5000 });
  if ((await hidden.count()) > 0) {
    let now = before;
    for (let i = 0; i < 20; i++) {
      now = await hidden.first().inputValue();
      if (now && now !== before) break;
      await page.waitForTimeout(50);
    }
    if (!now || (now === before && before !== "" && !targets.includes(norm(now)))) throw new Error(`Greenhouse: selecting "${wanted[0]}" in "${id}" did not register`);
  }
  await page.keyboard.press("Escape");
}

async function fillGroup(page: Page, id: string, type: "radio" | "checkbox", wanted: string[]): Promise<void> {
  const group = page.locator(`input[type=${type}][name="${esc(id)}"]`);
  const n = await group.count();
  if (n === 0) throw new Error(`Greenhouse: ${type} group "${id}" not found`);
  const items: { loc: Locator; value: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const loc = group.nth(i);
    const label = (await loc.evaluate(
      compile<Element, string>(`(el) => { var l = el.id ? document.querySelector('label[for="' + el.id.replace(/"/g, '\\\\"') + '"]') : null; l = l || el.closest('label'); return l ? l.textContent.replace(/\\s+/g, ' ').trim() : (el.getAttribute('aria-label') || ''); }`),
    )) as string;
    items.push({ loc, value: await loc.inputValue(), label });
  }
  const pick = (w: string) => items.find((it) => it.value === w) ?? items.find((it) => norm(it.value) === norm(w) || norm(it.label) === norm(w));
  const chosen = new Set<(typeof items)[number]>();
  for (const w of wanted) {
    const it = pick(w);
    if (!it) throw new Error(`Greenhouse: no ${type} option "${w}" in "${id}" (available: ${items.map((x) => x.label || x.value).join(" | ")})`);
    chosen.add(it);
  }
  for (const it of items) {
    const want = chosen.has(it);
    if (type === "radio" && !want) continue;
    await setChecked(it.loc, want);
  }
}

async function setChecked(loc: Locator, want: boolean): Promise<void> {
  try {
    await loc.setChecked(want, { timeout: 5000 });
  } catch {
    await loc.setChecked(want, { timeout: 5000, force: true });
  }
}

/** Fills one field by id. Throws a descriptive error when it can't. */
export async function fillField(page: Page, id: string, answer: FieldAnswer): Promise<void> {
  const { loc, kind } = await findControl(page, id);
  const wanted = wantedValues(answer);
  try {
    if (kind.tag === "input" && kind.role === "combobox") return await fillCombobox(page, id, loc, wanted);
    if (kind.tag === "input" && kind.type === "file") {
      if (answer.kind !== "file") throw new Error("expected a file answer");
      return await loc.setInputFiles(answer.path, { timeout: 10_000 });
    }
    if (kind.tag === "input" && kind.type === "radio") return await fillGroup(page, id, "radio", wanted);
    if (kind.tag === "input" && kind.type === "checkbox") {
      const n = await page.locator(`input[type=checkbox][name="${esc(id)}"]`).count();
      if (n > 1) return await fillGroup(page, id, "checkbox", wanted);
      const want = answer.kind === "boolean" ? answer.value : answer.kind === "option" ? answer.values.length > 0 : /^(yes|true|on|1|checked)$/i.test(wanted[0] ?? "");
      return await setChecked(loc, want);
    }
    if (kind.tag === "select") {
      const sel = wanted.map((w) => ({ value: w }));
      try {
        await loc.selectOption(sel, { timeout: 5000 });
      } catch {
        await loc.selectOption(
          wanted.map((w) => ({ label: w })),
          { timeout: 5000 },
        );
      }
      return;
    }
    if (answer.kind === "file") throw new Error("file answer for a non-file field");
    if (answer.kind === "option") await loc.fill(answer.values.join(", "), { timeout: 10_000 });
    else await loc.fill(wantedValues(answer)[0] ?? "", { timeout: 10_000 });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Greenhouse:")) throw err;
    throw new Error(`Greenhouse: could not fill "${id}": ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

/** After filling a controlling field, waits briefly for conditional wrappers to update. */
export async function waitForDependents(page: Page, controllingNames: string[], value: string): Promise<void> {
  const names = controllingNames.filter(Boolean);
  if (names.length === 0) return;
  const script = `(() => { var names = ${JSON.stringify(names)}, v = ${JSON.stringify(value)};
    var ws = [].slice.call(document.querySelectorAll('[data-depends-on]')).filter(function (w) { return names.indexOf(w.getAttribute('data-depends-on')) !== -1; });
    if (!ws.length) return true;
    return ws.every(function (w) { var show = v === w.getAttribute('data-depends-value'); return w.hidden === !show; }); })()`;
  await page.waitForFunction(script, undefined, { timeout: 1500 }).catch(() => undefined);
}

/** Names a field posts under (the hidden input of a combobox), for dependency lookups. */
export async function postedNames(page: Page, id: string): Promise<string[]> {
  const names = [id];
  const hidden = page.locator(`[id="${esc(id)}"]`).first().locator(`xpath=ancestor::*[@data-combobox][1]//input[@type="hidden"]`);
  if ((await hidden.count()) > 0) {
    const n = await hidden.first().getAttribute("name");
    if (n) names.push(n);
  }
  return names;
}
