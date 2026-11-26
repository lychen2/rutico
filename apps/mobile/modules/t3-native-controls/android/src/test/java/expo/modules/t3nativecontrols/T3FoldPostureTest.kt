package expo.modules.t3nativecontrols

import androidx.window.layout.FoldingFeature
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class T3FoldPostureTest {
  @Test
  fun appliesHingeAngleHysteresisWithoutFlapping() {
    assertFalse(nextHingeBentState(currentlyBent = false, angleDegrees = 175f))
    assertFalse(nextHingeBentState(currentlyBent = false, angleDegrees = 171f))
    assertTrue(nextHingeBentState(currentlyBent = false, angleDegrees = 170f))
    assertTrue(nextHingeBentState(currentlyBent = true, angleDegrees = 174.9f))
    assertFalse(nextHingeBentState(currentlyBent = true, angleDegrees = 175f))
    assertTrue(nextHingeBentState(currentlyBent = true, angleDegrees = Float.NaN))
  }

  @Test
  fun classifiesBookAndTabletopOrientations() {
    assertEquals("vertical", foldOrientationName(FoldingFeature.Orientation.VERTICAL))
    assertEquals("book", foldPostureForOrientation(FoldingFeature.Orientation.VERTICAL))
    assertEquals("horizontal", foldOrientationName(FoldingFeature.Orientation.HORIZONTAL))
    assertEquals("tabletop", foldPostureForOrientation(FoldingFeature.Orientation.HORIZONTAL))
  }
}
