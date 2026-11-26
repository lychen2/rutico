package expo.modules.t3reviewdiff

import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewDiffHunkNavigationTest {
  private fun row(kind: String, id: String) = DiffRow(
    kind = kind,
    id = id,
    fileId = "f1",
    filePath = "a.kt",
    previousPath = null,
    changeType = "modified",
    additions = 1,
    deletions = 0,
    text = "@@ -1,3 +1,4 @@",
    content = "",
    change = "context",
    oldLineNumber = null,
    newLineNumber = null,
    wordDiffRanges = emptyList(),
    commentText = "",
    commentRangeLabel = "",
    commentSectionTitle = "",
  )

  @Test
  fun navigatesForwardAndBackwardAcrossHunksWithTolerance() {
    val rows = listOf(
      row("file", "f1"),
      row("hunk", "h1"),
      row("line", "l1"),
      row("hunk", "h2"),
      row("line", "l2"),
      row("hunk", "h3"),
    )
    val tops = intArrayOf(0, 100, 140, 300, 340, 500)

    assertEquals(1, findTargetHunkIndex(rows, anchorOffset = 0, rowTop = { tops[it] }, direction = 1))
    assertEquals(3, findTargetHunkIndex(rows, anchorOffset = 100, rowTop = { tops[it] }, direction = 1))
    assertEquals(5, findTargetHunkIndex(rows, anchorOffset = 300, rowTop = { tops[it] }, direction = 1))
    assertEquals(-1, findTargetHunkIndex(rows, anchorOffset = 500, rowTop = { tops[it] }, direction = 1))

    assertEquals(3, findTargetHunkIndex(rows, anchorOffset = 500, rowTop = { tops[it] }, direction = -1))
    assertEquals(1, findTargetHunkIndex(rows, anchorOffset = 300, rowTop = { tops[it] }, direction = -1))
    assertEquals(-1, findTargetHunkIndex(rows, anchorOffset = 100, rowTop = { tops[it] }, direction = -1))
  }
}
