package expo.modules.t3nativecontrols

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scrim
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

internal enum class T3PredictiveBackOwner {
  MODAL,
  RAIL,
  PANEL,
  SCREEN_STACK,
}

/**
 * Deterministic single-owner arbitration for Android Predictive Back across native and JS layers.
 * Priority: modal -> expanded rail -> side panel -> screen stack.
 * Locks the winning owner at gesture start so mid-gesture updates cannot split or double-commit.
 */
internal object T3PredictiveBackCoordinator {
  @Volatile
  var modalOwnerCount: Int = 0
    private set

  @Volatile
  var railExpanded: Boolean = false
    private set

  @Volatile
  var panelOwnerCount: Int = 0
    private set

  @Volatile
  var activeGestureOwner: T3PredictiveBackOwner? = null
    private set

  private val listeners = linkedSetOf<() -> Unit>()

  @Synchronized
  fun setModalOwnerCount(count: Int) {
    val next = count.coerceAtLeast(0)
    if (modalOwnerCount == next) return
    modalOwnerCount = next
    notifyListenersLocked()
  }

  @Synchronized
  fun setRailExpanded(expanded: Boolean) {
    if (railExpanded == expanded) return
    railExpanded = expanded
    notifyListenersLocked()
  }

  @Synchronized
  fun setPanelOwnerCount(count: Int) {
    val next = count.coerceAtLeast(0)
    if (panelOwnerCount == next) return
    panelOwnerCount = next
    notifyListenersLocked()
  }

  @Synchronized
  fun resolveOwner(): T3PredictiveBackOwner = when {
    modalOwnerCount > 0 -> T3PredictiveBackOwner.MODAL
    railExpanded -> T3PredictiveBackOwner.RAIL
    panelOwnerCount > 0 -> T3PredictiveBackOwner.PANEL
    else -> T3PredictiveBackOwner.SCREEN_STACK
  }

  fun shouldRailOwnBack(): Boolean = railExpanded && modalOwnerCount == 0

  fun shouldPanelOwnBack(): Boolean = panelOwnerCount > 0 && modalOwnerCount == 0 && !railExpanded

  @Synchronized
  fun beginGesture(): T3PredictiveBackOwner {
    val owner = activeGestureOwner ?: resolveOwner()
    activeGestureOwner = owner
    return owner
  }

  @Synchronized
  fun cancelGesture(): T3PredictiveBackOwner? {
    val owner = activeGestureOwner
    activeGestureOwner = null
    return owner
  }

  @Synchronized
  fun commitGesture(): T3PredictiveBackOwner {
    val owner = activeGestureOwner ?: resolveOwner()
    activeGestureOwner = null
    return owner
  }

  @Synchronized
  fun addListener(listener: () -> Unit): () -> Unit {
    listeners.add(listener)
    return {
      synchronized(this) {
        listeners.remove(listener)
      }
    }
  }

  @Synchronized
  internal fun resetForTesting() {
    modalOwnerCount = 0
    railExpanded = false
    panelOwnerCount = 0
    activeGestureOwner = null
    listeners.clear()
  }

  private fun notifyListenersLocked() {
    val snapshot = listeners.toList()
    snapshot.forEach { it() }
  }
}

internal fun isAnimatorScaleDisabled(context: Context): Boolean = try {
  Settings.Global.getFloat(
    context.contentResolver,
    Settings.Global.ANIMATOR_DURATION_SCALE,
    1f,
  ) == 0f
} catch (_: Throwable) {
  false
}

class T3WorkspaceNavigationModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var panelBackCallback: OnBackPressedCallback? = null
  private var attachedActivityHash: Int = 0
  private var unsubscribeCoordinator: (() -> Unit)? = null
  private var lastPanelProgress = -1f
  private var panelGestureActive = false

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      mainHandler.post(block)
    }
  }

  private fun syncPanelBackCallback() {
    val activity = appContext.currentActivity as? ComponentActivity
    if (activity == null) {
      panelBackCallback?.isEnabled = false
      return
    }
    val hash = System.identityHashCode(activity)
    if (panelBackCallback == null || attachedActivityHash != hash) {
      panelBackCallback?.remove()
      attachedActivityHash = hash
      val callback = object : OnBackPressedCallback(T3PredictiveBackCoordinator.shouldPanelOwnBack()) {
        override fun handleOnBackStarted(backEvent: BackEventCompat) {
          T3PredictiveBackCoordinator.beginGesture()
          panelGestureActive = true
          lastPanelProgress = backEvent.progress.coerceIn(0f, 1f)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            appContext.currentActivity?.window?.decorView?.performHapticFeedback(
              HapticFeedbackConstants.GESTURE_START,
            )
          }
          sendEvent(
            "onPredictiveBack",
            mapOf(
              "phase" to "start",
              "progress" to lastPanelProgress,
              "swipeEdge" to backEvent.swipeEdge,
              "touchX" to backEvent.touchX,
              "touchY" to backEvent.touchY,
              "source" to "native-panel",
            ),
          )
        }

        override fun handleOnBackProgressed(backEvent: BackEventCompat) {
          val next = backEvent.progress.coerceIn(0f, 1f)
          if (kotlin.math.abs(next - lastPanelProgress) < 0.004f && next > 0f && next < 1f) {
            return
          }
          lastPanelProgress = next
          sendEvent(
            "onPredictiveBack",
            mapOf(
              "phase" to "progress",
              "progress" to next,
              "swipeEdge" to backEvent.swipeEdge,
              "touchX" to backEvent.touchX,
              "touchY" to backEvent.touchY,
              "source" to "native-panel",
            ),
          )
        }

        override fun handleOnBackCancelled() {
          T3PredictiveBackCoordinator.cancelGesture()
          panelGestureActive = false
          lastPanelProgress = -1f
          sendEvent(
            "onPredictiveBack",
            mapOf(
              "phase" to "cancel",
              "progress" to 0f,
              "swipeEdge" to 0,
              "touchX" to 0f,
              "touchY" to 0f,
              "source" to "native-panel",
            ),
          )
        }

        override fun handleOnBackPressed() {
          T3PredictiveBackCoordinator.commitGesture()
          val hadGesture = panelGestureActive
          panelGestureActive = false
          lastPanelProgress = -1f
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            appContext.currentActivity?.window?.decorView?.performHapticFeedback(
              HapticFeedbackConstants.GESTURE_END,
            )
          }
          sendEvent(
            "onPredictiveBack",
            mapOf(
              "phase" to "commit",
              "progress" to 1f,
              "swipeEdge" to 0,
              "touchX" to 0f,
              "touchY" to 0f,
              "hadGesture" to hadGesture,
              "source" to "native-panel",
            ),
          )
        }
      }
      panelBackCallback = callback
      activity.onBackPressedDispatcher.addCallback(activity, callback)
    } else {
      panelBackCallback?.isEnabled = T3PredictiveBackCoordinator.shouldPanelOwnBack()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("T3WorkspaceNavigation")
    Events("onPredictiveBack")

    OnCreate {
      unsubscribeCoordinator = T3PredictiveBackCoordinator.addListener {
        runOnMain { syncPanelBackCallback() }
      }
      runOnMain { syncPanelBackCallback() }
    }

    OnActivityEntersForeground {
      runOnMain { syncPanelBackCallback() }
    }

    OnActivityDestroys {
      runOnMain {
        panelBackCallback?.remove()
        panelBackCallback = null
        attachedActivityHash = 0
      }
    }

    OnDestroy {
      unsubscribeCoordinator?.invoke()
      unsubscribeCoordinator = null
      runOnMain {
        panelBackCallback?.remove()
        panelBackCallback = null
        attachedActivityHash = 0
      }
    }

    Function("setModalBackOwnerCount") { count: Int ->
      T3PredictiveBackCoordinator.setModalOwnerCount(count)
    }

    Function("setPanelBackOwnerCount") { count: Int ->
      T3PredictiveBackCoordinator.setPanelOwnerCount(count)
    }

    View(T3WorkspaceNavigationView::class) {
      Prop("tabs") { view: T3WorkspaceNavigationView, value: List<String> -> view.tabs = value }
      Prop("tabTitles") { view: T3WorkspaceNavigationView, value: Map<String, String> ->
        view.tabTitles = value
      }
      Prop("expandedTabTitles") { view: T3WorkspaceNavigationView, value: Map<String, String> ->
        view.expandedTabTitles = value
      }
      Prop("newThreadTitle") { view: T3WorkspaceNavigationView, value: String ->
        view.newThreadTitle = value
      }
      Prop("selectedTab") { view: T3WorkspaceNavigationView, value: String ->
        view.selectedTab = value
      }
      Prop("floating") { view: T3WorkspaceNavigationView, value: Boolean ->
        view.floating = value
        view.clipToPadding = !value
        view.clipChildren = !value
      }
      Prop("rail") { view: T3WorkspaceNavigationView, value: Boolean -> view.rail = value }
      Prop("dark") { view: T3WorkspaceNavigationView, value: Boolean -> view.dark = value }
      Prop("textScale") { view: T3WorkspaceNavigationView, value: Float -> view.textScale = value }
      Prop("newEnabled") { view: T3WorkspaceNavigationView, value: Boolean ->
        view.newEnabled = value
      }
      Prop("safeAreaTop") { view: T3WorkspaceNavigationView, value: Float ->
        view.safeAreaTop = value
      }
      Prop("safeAreaBottom") { view: T3WorkspaceNavigationView, value: Float ->
        view.safeAreaBottom = value
      }
      Prop("headerHeight") { view: T3WorkspaceNavigationView, value: Float ->
        view.headerHeight = value
      }
      Prop("containerColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.containerColor = value
      }
      Prop("selectedColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.selectedColor = value
      }
      Prop("indicatorColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.indicatorColor = value
      }
      Prop("unselectedColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.unselectedColor = value
      }
      Prop("actionColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.actionColor = value
      }
      Prop("actionContentColor") { view: T3WorkspaceNavigationView, value: Int ->
        view.actionContentColor = value
      }
      Events("onTabSelected", "onNewThread", "onOverlayChange")
    }
  }
}

/** One Material3 selection surface moves from below the list to its leading edge. */
class T3WorkspaceNavigationView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  // Compose must remeasure native children when Yoga resizes the folded window.
  override val shouldUseAndroidLayout = true

  private val onTabSelected by EventDispatcher()
  private val onNewThread by EventDispatcher()
  private val onOverlayChange by EventDispatcher()
  var tabs by mutableStateOf(listOf("threads", "pullRequests", "issues", "usage", "settings"))
  var tabTitles by mutableStateOf(emptyMap<String, String>())
  var expandedTabTitles by mutableStateOf(emptyMap<String, String>())
  var newThreadTitle by mutableStateOf("New thread")
  var selectedTab by mutableStateOf("threads")
  var rail by mutableStateOf(false)
  var floating by mutableStateOf(false)
  var dark by mutableStateOf(false)
  var textScale by mutableStateOf(1f)
  var newEnabled by mutableStateOf(false)
  var safeAreaTop by mutableStateOf(0f)
  var safeAreaBottom by mutableStateOf(0f)
  var headerHeight by mutableStateOf(56f)
  var containerColor by mutableStateOf(0)
  var selectedColor by mutableStateOf(0)
  var indicatorColor by mutableStateOf(0)
  var unselectedColor by mutableStateOf(0)
  var actionColor by mutableStateOf(0)
  var actionContentColor by mutableStateOf(0)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Fabric measures the replacement bar before attaching it on a fold.
    // Compose needs an attached window to obtain its lifecycle recomposer.
    if (!isAttachedToWindow) {
      setMeasuredDimension(
        MeasureSpec.getSize(widthMeasureSpec),
        MeasureSpec.getSize(heightMeasureSpec)
      )
      return
    }
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    if (isAttachedToWindow) super.onLayout(changed, left, top, right, bottom)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    requestLayout()
  }

  init {
    addView(
      ComposeView(context).apply {
        clipChildren = false
        setViewCompositionStrategy(
          ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool
        )
        setContent {
          MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
            if (rail) {
              rail()
            } else if (floating) {
              floatingTabs()
            } else {
              NavigationBar(
                modifier = Modifier.fillMaxSize(),
                containerColor = Color(containerColor),
                tonalElevation = androidx.compose.ui.unit.Dp(0f),
                windowInsets = WindowInsets(0),
              ) {
                tabs.forEach { tab ->
                  NavigationBarItem(
                    selected = selectedTab == tab,
                    onClick = { onTabSelected(mapOf("tab" to tab)) },
                    icon = { Icon(tabIconPainter(tab), contentDescription = null) },
                    label = { Text(tabTitle(tab), fontSize = (12 * textScale).sp) },
                    colors = NavigationBarItemDefaults.colors(
                      selectedIconColor = Color(selectedColor),
                      selectedTextColor = Color(selectedColor),
                      indicatorColor = Color(indicatorColor),
                      unselectedIconColor = Color(unselectedColor),
                      unselectedTextColor = Color(unselectedColor),
                    ),
                  )
                }
              }
            }
          }
        }
      },
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )
  }

  @Composable
  private fun floatingTabs() {
    Surface(
      modifier = Modifier.fillMaxSize().padding(8.dp),
      shape = CircleShape,
      color = Color(containerColor),
      shadowElevation = 6.dp,
    ) {
      Row(
        modifier = Modifier.fillMaxSize().selectableGroup(),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        tabs.forEach { tab ->
          val selected = selectedTab == tab
          val tint = Color(if (selected) selectedColor else unselectedColor)
          Box(
            modifier = Modifier
              .weight(1f)
              .fillMaxHeight()
              .clip(CircleShape)
              .selectable(
                selected = selected,
                role = Role.Tab,
                onClick = { onTabSelected(mapOf("tab" to tab)) },
              )
              .semantics { contentDescription = expandedTabTitle(tab) }
              .padding(4.dp)
              .background(if (selected) Color(indicatorColor) else Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
          ) {
            Icon(
              tabIconPainter(tab),
              contentDescription = null,
              modifier = Modifier.size((24 * textScale).dp),
              tint = tint,
            )
          }
        }
      }
    }
  }

  @Composable
  private fun rail() {
    // One rail surface widens in place over the list. Material's ModalWideNavigationRail
    // instead moves its destinations into a dialog window copy, which blanks them for a few
    // frames while the window attaches and lays them out at a different height.
    var expanded by remember { mutableStateOf(false) }
    // React Native sizes this view to the rail. While the rail is open it spans the workspace,
    // and it only widens once the host has made room, so the surface is never clipped.
    var roomy by remember { mutableStateOf(false) }
    var backProgress by remember { mutableStateOf<Float?>(null) }
    var modalOwnerCount by remember { mutableStateOf(T3PredictiveBackCoordinator.modalOwnerCount) }
    val reducedMotion = isAnimatorScaleDisabled(context)

    DisposableEffect(Unit) {
      val unsubscribe = T3PredictiveBackCoordinator.addListener {
        modalOwnerCount = T3PredictiveBackCoordinator.modalOwnerCount
      }
      onDispose {
        unsubscribe()
        T3PredictiveBackCoordinator.setRailExpanded(false)
      }
    }

    LaunchedEffect(expanded) {
      T3PredictiveBackCoordinator.setRailExpanded(expanded)
      if (!expanded) {
        backProgress = null
      }
    }

    val progress by animateFloatAsState(
      targetValue = if (expanded && roomy) 1f else 0f,
      animationSpec = MaterialTheme.motionScheme.defaultSpatialSpec(),
    )
    val overlay = expanded || progress != 0f || backProgress != null
    LaunchedEffect(overlay) { onOverlayChange(mapOf("overlay" to overlay)) }

    // Single-owner arbitration: modal -> expanded rail -> side panel -> screen stack.
    // The rail callback is enabled only when expanded and no modal owns back.
    val railOwnsBack = expanded && modalOwnerCount == 0
    val backDispatcher = (appContext.currentActivity as? ComponentActivity)?.onBackPressedDispatcher
    DisposableEffect(backDispatcher, railOwnsBack) {
      val callback = object : OnBackPressedCallback(railOwnsBack) {
        override fun handleOnBackStarted(backEvent: BackEventCompat) {
          T3PredictiveBackCoordinator.beginGesture()
          backProgress = backEvent.progress.coerceIn(0f, 1f)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            performHapticFeedback(HapticFeedbackConstants.GESTURE_START)
          }
        }

        override fun handleOnBackProgressed(backEvent: BackEventCompat) {
          backProgress = backEvent.progress.coerceIn(0f, 1f)
        }

        override fun handleOnBackCancelled() {
          T3PredictiveBackCoordinator.cancelGesture()
          backProgress = null
        }

        override fun handleOnBackPressed() {
          T3PredictiveBackCoordinator.commitGesture()
          backProgress = null
          expanded = false
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            performHapticFeedback(HapticFeedbackConstants.GESTURE_END)
          }
        }
      }
      backDispatcher?.addCallback(callback)
      onDispose { callback.remove() }
    }
    val density = LocalDensity.current
    Box(
      Modifier.fillMaxSize().onSizeChanged {
        roomy = with(density) { it.width.toDp() } >= EXPANDED_RAIL_WIDTH
      },
    ) {
      val liveBack = backProgress
      val baseFraction = if (reducedMotion) {
        if (expanded && roomy) 1f else 0f
      } else {
        progress.coerceIn(0f, 1f)
      }
      val fraction = if (liveBack != null) {
        if (reducedMotion) baseFraction else (1f - liveBack * 0.85f).coerceIn(0.15f, 1f)
      } else {
        baseFraction
      }
      val scrimAlpha = if (liveBack != null) {
        (1f - liveBack * (if (reducedMotion) 0.45f else 0.72f)).coerceIn(0.15f, 1f)
      } else {
        fraction
      }
      val surfaceAlpha = if (liveBack != null && reducedMotion) {
        (1f - liveBack * 0.2f).coerceIn(0.8f, 1f)
      } else {
        1f
      }
      val railShape = RoundedCornerShape(topEnd = 16.dp * fraction, bottomEnd = 16.dp * fraction)
      if (fraction > 0f) {
        Scrim(
          contentDescription = "Close navigation rail",
          onClick = { expanded = false },
          alpha = { scrimAlpha },
        )
      }
      Column(
        Modifier
          .fillMaxHeight()
          .width(
            lerp(
              RAIL_WIDTH,
              EXPANDED_RAIL_WIDTH,
              if (liveBack != null) fraction else if (reducedMotion) baseFraction else progress.coerceAtLeast(0f),
            ),
          )
          .alpha(surfaceAlpha)
          .shadow(RAIL_SHADOW * fraction, railShape, clip = false)
          .background(Color(containerColor), railShape)
          .padding(top = safeAreaTop.dp, bottom = safeAreaBottom.dp + 12.dp)
          .selectableGroup(),
      ) {
        // As tall as the list toolbar so the menu lines up with the toolbar's actions.
        Box(
          Modifier.height(headerHeight.dp).padding(start = RAIL_INSET),
          contentAlignment = Alignment.CenterStart,
        ) {
          IconButton(
            onClick = { expanded = !expanded },
            modifier = Modifier.semantics {
              contentDescription =
                if (expanded) "Collapse navigation rail" else "Expand navigation rail"
            },
          ) {
            Icon(
              painterResource(R.drawable.t3_menu),
              contentDescription = null,
              tint = Color(unselectedColor),
            )
          }
        }
        // Other tabs keep the button's slot so the destinations below never move between tabs.
        if (selectedTab == "threads") {
          newThreadButton(fraction) {
            expanded = false
            onNewThread(emptyMap<String, Any>())
          }
        } else {
          Spacer(Modifier.padding(top = 12.dp).height(FAB_SIZE))
        }
        Spacer(Modifier.weight(1f))
        tabs.forEach { tab ->
          railItem(tab, fraction) {
            expanded = false
            onTabSelected(mapOf("tab" to tab))
          }
        }
        Spacer(Modifier.weight(1f))
      }
    }
  }

  /** The collapsed FAB widens with the rail and reveals its label as it goes. */
  @Composable
  private fun newThreadButton(fraction: Float, onClick: () -> Unit) {
    Surface(
      onClick = onClick,
      enabled = newEnabled,
      shape = MaterialTheme.shapes.large,
      color = Color(actionColor),
      contentColor = Color(actionContentColor),
      shadowElevation = 3.dp,
      modifier = Modifier
        .padding(start = RAIL_INSET, top = 12.dp)
        .height(FAB_SIZE)
        .width(lerp(FAB_SIZE, EXPANDED_RAIL_WIDTH - RAIL_INSET * 2, fraction))
        .alpha(if (newEnabled) 1f else DISABLED_ALPHA)
        .semantics { contentDescription = newThreadTitle },
    ) {
      Row(
        Modifier.padding(start = (FAB_SIZE - ICON_SIZE) / 2).clipToBounds(),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(painterResource(R.drawable.t3_new_thread), contentDescription = null)
        Text(
          newThreadTitle,
          Modifier.padding(start = 12.dp).alpha(labelAlpha(fraction)).clearAndSetSemantics {},
          style = MaterialTheme.typography.labelLarge,
          fontSize = (14 * textScale).sp,
          maxLines = 1,
          softWrap = false,
        )
      }
    }
  }

  /**
   * A destination whose indicator stretches from a circle around the icon into a pill around
   * the icon and label. The icon never moves, so the collapsed and expanded rails share it.
   */
  @Composable
  private fun railItem(tab: String, fraction: Float, onClick: () -> Unit) {
    val selected = selectedTab == tab
    val title = expandedTabTitle(tab)
    val tint = Color(if (selected) selectedColor else unselectedColor)
    Box(
      Modifier
        .padding(start = RAIL_INSET, bottom = 4.dp)
        .height(ITEM_HEIGHT)
        .width(lerp(ITEM_HEIGHT, EXPANDED_RAIL_WIDTH - RAIL_INSET * 2, fraction))
        .clip(CircleShape)
        .background(if (selected) Color(indicatorColor) else Color.Transparent)
        .selectable(selected = selected, role = Role.Tab, onClick = onClick)
        .semantics { contentDescription = title },
    ) {
      Row(
        Modifier.fillMaxHeight().padding(start = (ITEM_HEIGHT - ICON_SIZE) / 2).clipToBounds(),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(tabIconPainter(tab), contentDescription = null, tint = tint)
        Text(
          title,
          Modifier.padding(start = 12.dp).alpha(labelAlpha(fraction)).clearAndSetSemantics {},
          color = tint,
          style = MaterialTheme.typography.labelLarge,
          fontSize = (14 * textScale).sp,
          maxLines = 1,
          softWrap = false,
        )
      }
    }
  }

  private fun tabTitle(tab: String) = tabTitles[tab] ?: when (tab) {
    "threads" -> "Chats"
    "pullRequests" -> "Pulls"
    "issues" -> "Issues"
    "workflows" -> "Workflows"
    "usage" -> "Usage"
    else -> "Settings"
  }

  private fun expandedTabTitle(tab: String) =
    expandedTabTitles[tab] ?: if (tab == "pullRequests") "Pull requests" else tabTitle(tab)

  @Composable
  private fun tabIconPainter(tab: String) = painterResource(
    when (tab) {
      "threads" -> R.drawable.t3_chats
      "pullRequests" -> R.drawable.t3_pull_requests
      "issues" -> R.drawable.t3_issues
      "workflows" -> R.drawable.t3_workflows
      "usage" -> R.drawable.t3_usage
      else -> R.drawable.t3_settings
    }
  )

  private companion object {
    // Material's 80dp compact rail, minus 8dp: still a 48dp touch target with 12dp margins.
    val RAIL_WIDTH = 72.dp
    val EXPANDED_RAIL_WIDTH = 240.dp
    val RAIL_INSET = 12.dp
    val ITEM_HEIGHT = 48.dp
    val FAB_SIZE = 48.dp
    val ICON_SIZE = 24.dp
    val RAIL_SHADOW = 6.dp
    const val DISABLED_ALPHA = 0.4f

    // Labels fade in over the second half of the widening, once there is room for them, and
    // fade out over the first half of the narrowing, before the surface clips them.
    fun labelAlpha(fraction: Float) = ((fraction - 0.5f) / 0.5f).coerceIn(0f, 1f)
  }
}
