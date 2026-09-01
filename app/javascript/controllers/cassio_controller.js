import { Controller } from "@hotwired/stimulus"
import { CassioApp } from "cassio/app"

export default class extends Controller {
  connect() {
    this.app = new CassioApp(this.element)
  }
}
