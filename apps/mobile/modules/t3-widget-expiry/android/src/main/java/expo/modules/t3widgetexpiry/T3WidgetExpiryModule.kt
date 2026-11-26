package expo.modules.t3widgetexpiry

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3WidgetExpiryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3WidgetExpiry")
    Function("schedule") { name: String, deadlines: List<Double> ->
      val context = appContext.reactContext ?: return@Function
      WidgetExpiryReceiver.schedule(context, name, deadlines.map { it.toLong() }.toLongArray())
    }
    Function("setLaunchUrl") { name: String, url: String? ->
      val context = appContext.reactContext ?: return@Function
      val editor = context.getSharedPreferences(LAUNCH_URL_PREFERENCES, Context.MODE_PRIVATE).edit()
      val normalized = url?.trim()
      if (normalized.isNullOrEmpty()) {
        editor.remove(name)
      } else {
        editor.putString(name, normalized)
      }
      editor.apply()
    }
  }

  companion object {
    const val LAUNCH_URL_PREFERENCES = "expo.modules.t3widgetexpiry.LAUNCH_URLS"
  }
}
