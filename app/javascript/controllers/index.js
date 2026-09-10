import { application } from "./application"
import CassioController from "./cassio_controller"
import HelloController from "./hello_controller"
import ManualController from "./manual_controller"

application.register("cassio", CassioController)
application.register("hello", HelloController)
application.register("manual", ManualController)
