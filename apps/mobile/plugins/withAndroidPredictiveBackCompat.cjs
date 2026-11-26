const { withMainActivity } = require("expo/config-plugins");

// React Native 0.88.1 registers an OnBackPressedCallback only when running on Android 16 (API 36+)
// with targetSdk >= 36. Android 13-15 (API 33-35) need this compat callback to bridge both discrete
// back presses and Android 14-15 BackEventCompat progress events to JS without duplicating API 36.

const CALLBACK_PROPERTY = `
  private var predictiveBackGestureActive = false
  private var lastPredictiveBackProgress = -1f

  private fun emitPredictiveBackEvent(
    phase: String,
    progress: Float,
    swipeEdge: Int,
    touchX: Float,
    touchY: Float,
    hadGesture: Boolean,
  ) {
    val reactContext = reactDelegate?.currentReactContext ?: return
    val payload = Arguments.createMap().apply {
      putString("phase", phase)
      putDouble("progress", progress.toDouble())
      putInt("swipeEdge", swipeEdge)
      putDouble("touchX", touchX.toDouble())
      putDouble("touchY", touchY.toDouble())
      putBoolean("hadGesture", hadGesture)
      putString("source", "compat")
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("t3PredictiveBack", payload)
  }

  // Routes predictive-back gestures and progress to JS on Android 13-15 (API 33-35), where
  // react-native registers no OnBackPressedDispatcher callback of its own (it registers on
  // Android 16+). Registered in onCreate; added by withAndroidPredictiveBackCompat.
  private val predictiveBackCompatCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) {
      predictiveBackGestureActive = true
      lastPredictiveBackProgress = backEvent.progress.coerceIn(0f, 1f)
      emitPredictiveBackEvent(
        phase = "start",
        progress = lastPredictiveBackProgress,
        swipeEdge = backEvent.swipeEdge,
        touchX = backEvent.touchX,
        touchY = backEvent.touchY,
        hadGesture = true,
      )
    }

    override fun handleOnBackProgressed(backEvent: BackEventCompat) {
      val next = backEvent.progress.coerceIn(0f, 1f)
      if (kotlin.math.abs(next - lastPredictiveBackProgress) < 0.004f && next > 0f && next < 1f) {
        return
      }
      lastPredictiveBackProgress = next
      emitPredictiveBackEvent(
        phase = "progress",
        progress = next,
        swipeEdge = backEvent.swipeEdge,
        touchX = backEvent.touchX,
        touchY = backEvent.touchY,
        hadGesture = true,
      )
    }

    override fun handleOnBackCancelled() {
      predictiveBackGestureActive = false
      lastPredictiveBackProgress = -1f
      emitPredictiveBackEvent(
        phase = "cancel",
        progress = 0f,
        swipeEdge = 0,
        touchX = 0f,
        touchY = 0f,
        hadGesture = true,
      )
    }

    override fun handleOnBackPressed() {
      val hadGesture = predictiveBackGestureActive
      predictiveBackGestureActive = false
      lastPredictiveBackProgress = -1f
      emitPredictiveBackEvent(
        phase = "commit",
        progress = 1f,
        swipeEdge = 0,
        touchX = 0f,
        touchY = 0f,
        hadGesture = hadGesture,
      )
      isEnabled = false
      onBackPressed()
      isEnabled = true
    }
  }
`;

const CALLBACK_REGISTRATION = `
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) {
      onBackPressedDispatcher.addCallback(this, predictiveBackCompatCallback)
    }`;

// Disable the compat callback during default back handling to prevent dispatcher recursion.
const INVOKE_DEFAULT_WRAPPER = `override fun invokeDefaultOnBackPressed() {
    predictiveBackCompatCallback.isEnabled = false
    try {
      invokeDefaultOnBackPressedLegacy()
    } finally {
      predictiveBackCompatCallback.isEnabled = true
    }
  }

  private fun invokeDefaultOnBackPressedLegacy() {`;

function insertAfter(contents, anchor, insertion, description) {
  const index = contents.indexOf(anchor);
  if (index === -1) {
    throw new Error(
      `withAndroidPredictiveBackCompat: could not find ${description} in MainActivity — the Expo template changed; update the plugin anchors.`,
    );
  }
  const end = index + anchor.length;
  return contents.slice(0, end) + insertion + contents.slice(end);
}

function addImport(contents, importLine) {
  if (contents.includes(importLine)) {
    return contents;
  }
  return insertAfter(
    contents,
    "import android.os.Bundle",
    `\n${importLine}`,
    "the android.os.Bundle import",
  );
}

module.exports = function withAndroidPredictiveBackCompat(config) {
  if (config.android?.predictiveBackGestureEnabled !== true) {
    return config;
  }

  return withMainActivity(config, (nextConfig) => {
    let contents = nextConfig.modResults.contents;
    if (nextConfig.modResults.language !== "kt") {
      throw new Error("withAndroidPredictiveBackCompat: MainActivity must be Kotlin.");
    }
    if (contents.includes("predictiveBackCompatCallback")) {
      return nextConfig;
    }

    contents = addImport(contents, "import androidx.activity.BackEventCompat");
    contents = addImport(contents, "import androidx.activity.OnBackPressedCallback");
    contents = addImport(contents, "import com.facebook.react.bridge.Arguments");
    contents = addImport(
      contents,
      "import com.facebook.react.modules.core.DeviceEventManagerModule",
    );
    contents = insertAfter(
      contents,
      "class MainActivity : ReactActivity() {",
      CALLBACK_PROPERTY,
      "the MainActivity class declaration",
    );
    contents = insertAfter(
      contents,
      "super.onCreate(null)",
      CALLBACK_REGISTRATION,
      "the super.onCreate call",
    );

    if (!contents.includes("override fun invokeDefaultOnBackPressed() {")) {
      throw new Error(
        "withAndroidPredictiveBackCompat: could not find invokeDefaultOnBackPressed in MainActivity — the Expo template changed; update the plugin anchors.",
      );
    }
    contents = contents.replace(
      "override fun invokeDefaultOnBackPressed() {",
      INVOKE_DEFAULT_WRAPPER,
    );

    nextConfig.modResults.contents = contents;
    return nextConfig;
  });
};
