import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["dialog", "search", "section", "count", "empty"]

  connect() {
    this.previousFocus = null
    this.handleKeydown = this.handleKeydown.bind(this)
    window.addEventListener("keydown", this.handleKeydown)
  }

  disconnect() {
    window.removeEventListener("keydown", this.handleKeydown)
  }

  open() {
    this.previousFocus = document.activeElement
    this.dialogTarget.hidden = false
    document.documentElement.classList.add("manual-open")
    requestAnimationFrame(() => this.searchTarget.focus())
  }

  close() {
    if (this.dialogTarget.hidden) return
    this.dialogTarget.hidden = true
    document.documentElement.classList.remove("manual-open")
    this.previousFocus?.focus?.()
  }

  backdropClose(event) {
    if (event.target === this.dialogTarget) this.close()
  }

  handleKeydown(event) {
    if (this.dialogTarget.hidden) return
    if (event.key === "Escape") {
      event.preventDefault()
      this.close()
      return
    }
    if (event.key === "/" && document.activeElement !== this.searchTarget) {
      event.preventDefault()
      this.searchTarget.focus()
    }
  }

  search() {
    const query = this.searchTarget.value.trim().toLocaleLowerCase()
    let visible = 0

    this.sectionTargets.forEach((section) => {
      const match = !query || section.textContent.toLocaleLowerCase().includes(query)
      section.hidden = !match
      if (match) visible += 1

      const id = section.id
      this.element.querySelectorAll(`[data-manual-link="${CSS.escape(id)}"]`).forEach((link) => {
        link.hidden = !match
      })
    })

    this.countTarget.textContent = query
      ? `${visible} section${visible === 1 ? "" : "s"}`
      : `${this.sectionTargets.length} sections`
    this.emptyTarget.hidden = visible !== 0
  }

  clearSearch() {
    this.searchTarget.value = ""
    this.search()
    this.searchTarget.focus()
  }

  jump(event) {
    event.preventDefault()
    const id = event.currentTarget.getAttribute("href")?.replace(/^#/, "")
    const section = id ? document.getElementById(id) : null
    if (!section || section.hidden) return
    section.scrollIntoView({ block: "start", behavior: "smooth" })
    section.focus({ preventScroll: true })
  }
}
