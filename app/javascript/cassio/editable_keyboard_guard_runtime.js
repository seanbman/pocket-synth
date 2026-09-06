function editableTarget(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  return target.matches?.("input, textarea, select, [contenteditable='true']") || false
}

/**
 * CASSIO's computer-performance mappings intentionally live on window so they
 * work throughout the hardware UI. Stop editable-field key events at document
 * after the input itself has received them, but before they bubble to window.
 * This preserves normal typing while preventing notes, pads, navigation, or
 * transport shortcuts from leaking out of text-entry surfaces.
 */
export function installEditableKeyboardGuardRuntime(app) {
  if (!app || app._editableKeyboardGuardRuntimeInstalled) return
  app._editableKeyboardGuardRuntimeInstalled = true

  const guard = (event) => {
    if (!editableTarget(event.target)) return
    event.stopPropagation()
  }

  document.addEventListener("keydown", guard)
  document.addEventListener("keyup", guard)

  app._editableKeyboardGuardCleanup = () => {
    document.removeEventListener("keydown", guard)
    document.removeEventListener("keyup", guard)
  }
}

export { editableTarget }
