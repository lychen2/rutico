package expo.modules.t3nativecontrols

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Hysteresis for foldable hinge angle sensors (Pixel/Galaxy foldables rest near 175° when flat).
 * Snapping bent at <= 170° and releasing at >= 175° prevents resting flap jitter.
 */
internal fun nextHingeBentState(currentlyBent: Boolean, angleDegrees: Float): Boolean {
  if (!angleDegrees.isFinite()) return currentlyBent
  return if (currentlyBent) angleDegrees < 175f else angleDegrees <= 170f
}

internal fun foldPostureForOrientation(orientation: FoldingFeature.Orientation): String =
  if (orientation == FoldingFeature.Orientation.HORIZONTAL) "tabletop" else "book"

internal fun foldOrientationName(orientation: FoldingFeature.Orientation): String =
  if (orientation == FoldingFeature.Orientation.HORIZONTAL) "horizontal" else "vertical"

class T3FoldPostureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3FoldPosture")

    View(T3FoldPostureView::class) {
      Events("onHingeChange")
    }
  }
}

/**
 * Reports vertical (book) and horizontal (tabletop) hinges in view & window dp coordinates
 * while the device is bent. Never fabricates a hinge angle when no hardware sensor is present:
 * falls back cleanly to FoldingFeature.State.HALF_OPENED without emitting a fake angle.
 */
class T3FoldPostureView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext), SensorEventListener {
  private val onHingeChange by EventDispatcher()
  private val sensorManager = context.getSystemService(SensorManager::class.java)
  private val hingeSensor =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      sensorManager?.getDefaultSensor(Sensor.TYPE_HINGE_ANGLE)
    } else {
      null
    }
  private var scope: CoroutineScope? = null
  private var fold: FoldingFeature? = null
  private var listening = false
  private var bent = false
  private var lastHingeAngle: Float? = null
  private var reported: Map<String, Any>? = null

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    observeFold()
  }

  // The activity can be missing when the view first attaches, so layout passes retry.
  private fun observeFold() {
    if (scope != null || !isAttachedToWindow) return
    val activity = appContext.currentActivity ?: return
    scope = MainScope().also { scope ->
      scope.launch {
        WindowInfoTracker.getOrCreate(activity).windowLayoutInfo(activity).collect { info ->
          fold = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull()
          listen(fold != null)
          report()
        }
      }
    }
  }

  override fun onDetachedFromWindow() {
    scope?.cancel()
    scope = null
    listen(false)
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    observeFold()
    if (changed) report()
  }

  override fun onSensorChanged(event: SensorEvent) {
    val angle = event.values.firstOrNull() ?: return
    if (!angle.isFinite()) return
    lastHingeAngle = angle
    bent = nextHingeBentState(bent, angle)
    report()
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit

  private fun listen(enabled: Boolean) {
    if (enabled == listening || hingeSensor == null) return
    listening = enabled
    if (enabled) {
      sensorManager.registerListener(this, hingeSensor, SensorManager.SENSOR_DELAY_UI)
    } else {
      sensorManager.unregisterListener(this)
      bent = false
      lastHingeAngle = null
    }
  }

  private fun report() {
    val feature = fold
    // Without a hinge angle sensor, the platform's HALF_OPENED posture is the closest real signal.
    val hasSensor = hingeSensor != null
    val aligned = feature != null &&
      if (hasSensor) {
        bent || feature.state == FoldingFeature.State.HALF_OPENED
      } else {
        feature.state == FoldingFeature.State.HALF_OPENED
      }
    val hinge: Map<String, Any> = if (aligned && feature != null) {
      val origin = IntArray(2).also { getLocationInWindow(it) }
      val density = resources.displayMetrics.density
      val payload = LinkedHashMap<String, Any>(12)
      payload["orientation"] = foldOrientationName(feature.orientation)
      payload["posture"] = foldPostureForOrientation(feature.orientation)
      payload["state"] = if (feature.state == FoldingFeature.State.HALF_OPENED) {
        "half_opened"
      } else {
        "flat"
      }
      payload["x"] = (feature.bounds.left - origin[0]) / density
      payload["windowX"] = feature.bounds.left / density
      payload["width"] = feature.bounds.width() / density
      payload["y"] = (feature.bounds.top - origin[1]) / density
      payload["windowY"] = feature.bounds.top / density
      payload["height"] = feature.bounds.height() / density
      payload["hasAngleSensor"] = hasSensor
      // Only include angle when backed by a real hardware TYPE_HINGE_ANGLE reading.
      val measuredAngle = if (hasSensor) lastHingeAngle else null
      if (measuredAngle != null && measuredAngle.isFinite()) {
        payload["angle"] = measuredAngle
      }
      payload
    } else {
      emptyMap()
    }
    if (hinge == reported) return
    reported = hinge
    onHingeChange(hinge)
  }
}
