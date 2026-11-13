/**
 * What a refresh keeps in the server-rendered fields it renders again (islands mode), as source.
 * The production client entry (nitro/universal-build.ts) and the `farm dev` client entry (vite.ts)
 * both include it.
 *
 * A refresh (`router.refresh()`, a server action) replaces a layout or page whose output changed
 * with its new HTML. React updates such a tree in place under the RSC engine, so a field keeps
 * what was typed into it and the focus. The replacement does the same: each field outside an
 * island takes the value the user gave its counterpart, and the focused one keeps the focus and
 * selection. A form whose submission is in flight is left out: its action resets it.
 */
export const FARM_REFRESH_FIELDS_SOURCE = `// The server-rendered fields of a tree: islands keep their own.
function listFarmServerFields(root) {
  return Array.from(root.querySelectorAll("input, textarea, select")).filter(function(field) {
    return !field.closest("f-island");
  });
}

// Reads the fields of a tree about to be replaced: their order, and which one has the focus.
function captureFarmServerFields(root) {
  const fields = listFarmServerFields(root);
  const focused = fields.indexOf(document.activeElement);
  const field = fields[focused];
  let selection = null;
  try {
    if (field && typeof field.selectionStart === "number") {
      selection = [field.selectionStart, field.selectionEnd, field.selectionDirection];
    }
  } catch {}
  return { fields, focused, selection };
}

function isSameFarmField(current, next) {
  return current.tagName === next.tagName &&
    current.type === next.type &&
    current.name === next.name &&
    current.id === next.id;
}

// Gives the replacing tree's fields what the user changed in the replaced one, and the focus.
function restoreFarmServerFields(captured, root) {
  const fields = listFarmServerFields(root);
  captured.fields.forEach(function(current, index) {
    const next = fields[index];
    if (!next || !isSameFarmField(current, next)) return;
    if (current.form && current.form.getAttribute("aria-busy") === "true") return;
    if (current.tagName === "SELECT") {
      const changed = Array.from(current.options).some(function(option) {
        return option.selected !== option.defaultSelected;
      });
      if (!changed) return;
      const values = new Set(Array.from(current.selectedOptions, function(option) {
        return option.value;
      }));
      Array.from(next.options).forEach(function(option) {
        option.selected = values.has(option.value);
      });
    } else if (current.type === "checkbox" || current.type === "radio") {
      if (current.checked !== current.defaultChecked) next.checked = current.checked;
    } else if (current.type !== "file" && current.value !== current.defaultValue) {
      next.value = current.value;
    }
  });
  const focused = fields[captured.focused];
  if (!focused || !isSameFarmField(captured.fields[captured.focused], focused)) return;
  focused.focus({ preventScroll: true });
  if (captured.selection) {
    try {
      focused.setSelectionRange(captured.selection[0], captured.selection[1], captured.selection[2]);
    } catch {}
  }
}
`;
