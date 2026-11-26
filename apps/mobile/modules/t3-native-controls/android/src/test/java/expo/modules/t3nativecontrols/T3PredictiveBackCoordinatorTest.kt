package expo.modules.t3nativecontrols

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class T3PredictiveBackCoordinatorTest {
  @Before
  fun setUp() {
    T3PredictiveBackCoordinator.resetForTesting()
  }

  @Test
  fun enforcesSingleOwnerPriorityModalOverRailOverPanelOverStack() {
    assertEquals(T3PredictiveBackOwner.SCREEN_STACK, T3PredictiveBackCoordinator.resolveOwner())
    assertFalse(T3PredictiveBackCoordinator.shouldRailOwnBack())
    assertFalse(T3PredictiveBackCoordinator.shouldPanelOwnBack())

    T3PredictiveBackCoordinator.setPanelOwnerCount(1)
    assertEquals(T3PredictiveBackOwner.PANEL, T3PredictiveBackCoordinator.resolveOwner())
    assertFalse(T3PredictiveBackCoordinator.shouldRailOwnBack())
    assertTrue(T3PredictiveBackCoordinator.shouldPanelOwnBack())

    T3PredictiveBackCoordinator.setRailExpanded(true)
    assertEquals(T3PredictiveBackOwner.RAIL, T3PredictiveBackCoordinator.resolveOwner())
    assertTrue(T3PredictiveBackCoordinator.shouldRailOwnBack())
    assertFalse(T3PredictiveBackCoordinator.shouldPanelOwnBack())

    T3PredictiveBackCoordinator.setModalOwnerCount(1)
    assertEquals(T3PredictiveBackOwner.MODAL, T3PredictiveBackCoordinator.resolveOwner())
    assertFalse(T3PredictiveBackCoordinator.shouldRailOwnBack())
    assertFalse(T3PredictiveBackCoordinator.shouldPanelOwnBack())

    // Closing modal returns ownership cleanly to the expanded rail.
    T3PredictiveBackCoordinator.setModalOwnerCount(0)
    assertEquals(T3PredictiveBackOwner.RAIL, T3PredictiveBackCoordinator.resolveOwner())
    assertTrue(T3PredictiveBackCoordinator.shouldRailOwnBack())
    assertFalse(T3PredictiveBackCoordinator.shouldPanelOwnBack())
  }

  @Test
  fun locksGestureOwnerOnStartAndCancelsWithoutCommitting() {
    T3PredictiveBackCoordinator.setRailExpanded(true)
    T3PredictiveBackCoordinator.setPanelOwnerCount(1)

    val started = T3PredictiveBackCoordinator.beginGesture()
    assertEquals(T3PredictiveBackOwner.RAIL, started)
    assertEquals(T3PredictiveBackOwner.RAIL, T3PredictiveBackCoordinator.activeGestureOwner)

    // Mid-gesture state mutations cannot steal ownership from the locked owner.
    T3PredictiveBackCoordinator.setModalOwnerCount(1)
    assertEquals(T3PredictiveBackOwner.RAIL, T3PredictiveBackCoordinator.activeGestureOwner)

    val cancelled = T3PredictiveBackCoordinator.cancelGesture()
    assertEquals(T3PredictiveBackOwner.RAIL, cancelled)
    assertNull(T3PredictiveBackCoordinator.activeGestureOwner)
    assertEquals(T3PredictiveBackOwner.MODAL, T3PredictiveBackCoordinator.resolveOwner())
  }

  @Test
  fun commitsOnceAndClearsActiveGestureLock() {
    T3PredictiveBackCoordinator.setPanelOwnerCount(1)
    assertEquals(T3PredictiveBackOwner.PANEL, T3PredictiveBackCoordinator.beginGesture())

    val committed = T3PredictiveBackCoordinator.commitGesture()
    assertEquals(T3PredictiveBackOwner.PANEL, committed)
    assertNull(T3PredictiveBackCoordinator.activeGestureOwner)

    // Subsequent discrete commit (API 33 / button back) resolves current owner without stale lock.
    T3PredictiveBackCoordinator.setPanelOwnerCount(0)
    assertEquals(T3PredictiveBackOwner.SCREEN_STACK, T3PredictiveBackCoordinator.commitGesture())
  }
}
