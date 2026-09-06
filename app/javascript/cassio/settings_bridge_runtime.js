import { saveSettings } from "cassio/settings_store"

/**
 * Existing PLAY/LOOP hardware controls predate the global SETTINGS store.
 * Preserve their project/recovery behavior while also making the corresponding
 * system preference authoritative across reloads.
 */
export function installSettingsBridgeRuntime(app) {
  const runtime = app?.settingsRuntime
  if (!app || !runtime || app._settingsBridgeRuntimeInstalled) return
  app._settingsBridgeRuntimeInstalled = true

  const setMetroOn = app.setMetroOn?.bind(app)
  if (setMetroOn) {
    app.setMetroOn = (on) => {
      runtime.settings = saveSettings({ ...runtime.settings, metroOn: !!on })
      app.systemSettings = runtime.settings
      return setMetroOn(on)
    }
  }

  const setMetroLevel = app.setMetroLevel?.bind(app)
  if (setMetroLevel) {
    app.setMetroLevel = (level) => {
      const next = Math.min(1, Math.max(0, Number(level) || 0))
      runtime.settings = saveSettings({ ...runtime.settings, metroLevel: next })
      app.systemSettings = runtime.settings
      return setMetroLevel(level)
    }
  }
}
