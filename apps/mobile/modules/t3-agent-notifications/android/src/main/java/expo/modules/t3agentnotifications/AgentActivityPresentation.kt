package expo.modules.t3agentnotifications

import android.content.Context
import android.graphics.Typeface
import android.os.Build
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

internal data class ActivityRow(val status: String, val title: String, val project: String)

internal enum class ActivityPhase(
  val status: String,
  val heading: String,
  val chip: String,
  val action: String,
  val color: Int
) {
  STARTING("Connecting", "Starting", "Working", "Open", R.color.agent_activity_working),
  RUNNING("Working", "Working", "Working", "Open", R.color.agent_activity_working),
  APPROVAL(
    "Approval",
    "Approval needed",
    "Approve",
    "Approve",
    R.color.agent_activity_attention
  ),
  INPUT(
    "Input",
    "Question for you",
    "Answer",
    "Answer",
    R.color.agent_activity_input
  ),
  STALE(
    "Waiting",
    "Waiting for an update",
    "Waiting",
    "Open",
    R.color.agent_activity_waiting
  ),
  COMPLETED(
    "Done",
    "Finished",
    "Done",
    "Open",
    R.color.agent_activity_done
  ),
  FAILED(
    "Failed",
    "Failed",
    "Failed",
    "Open",
    R.color.agent_activity_failed
  );

  val needsUser get() = this == APPROVAL || this == INPUT
  val finished get() = this == COMPLETED || this == FAILED

  companion object {
    fun forStatus(status: String) = entries.firstOrNull { it.status == status }
  }
}

/** The relay orders rows and their deep link together; never reorder them in the client. */
internal fun activityRows(data: Map<String, String>) = (0..4).mapNotNull {
  val parts = data["activity_line_$it"]?.split('\t', limit = 3) ?: return@mapNotNull null
  if (parts.size != 3 || parts[1].isBlank()) {
    null
  } else {
    ActivityRow(parts[0].take(40), parts[1].take(120), parts[2].take(120))
  }
}

internal fun activityPhase(data: Map<String, String>, rows: List<ActivityRow>): ActivityPhase? =
  when (data["activity_phase"]?.takeIf { it.isNotBlank() }) {
    "starting" -> ActivityPhase.STARTING
    "running" -> ActivityPhase.RUNNING
    "waiting_for_approval" -> ActivityPhase.APPROVAL
    "waiting_for_input" -> ActivityPhase.INPUT
    "stale" -> ActivityPhase.STALE
    "completed" -> ActivityPhase.COMPLETED
    "failed" -> ActivityPhase.FAILED
    else -> rows.firstOrNull()?.let { ActivityPhase.forStatus(it.status) }
  }

internal class ActivityPresentation(data: Map<String, String>, private val active: Boolean) {
  private val rows = activityRows(data)
  private val hero = rows.firstOrNull()
  val phase = activityPhase(data, rows)
  val isMultiThread = rows.size > 1
  private val phaseStartedAt = parseStablePhaseStartedAt(data["activity_phase_started_at"])
  private val activeCount = data["activity_active_count"]?.toIntOrNull()?.coerceAtLeast(0)
    ?: rows.count { ActivityPhase.forStatus(it.status)?.finished != true }
  private val attentionCount = data["activity_attention_count"]?.toIntOrNull()?.coerceAtLeast(0)
    ?: rows.count { ActivityPhase.forStatus(it.status)?.needsUser == true }
  private val failedCount = rows.count { it.status == ActivityPhase.FAILED.status }
  val threadCount =
    activeCount + rows.count { ActivityPhase.forStatus(it.status)?.finished == true }
  private val singleProject = rows.map { it.project }.distinct().size == 1
  private val legacyBody = (0..4).mapNotNull { data["activity_line_$it"]?.take(300) }
    .takeIf { it.isNotEmpty() }?.joinToString("\n")
    ?: data["activity_body"].orEmpty().take(240)

  val summary = when {
    hero == null -> data["activity_title"]?.takeIf { it.isNotBlank() }?.take(120)
      ?: "Agent activity"
    rows.size == 1 -> hero.title
    attentionCount == 1 -> "1 needs you"
    attentionCount > 1 -> "$attentionCount need you"
    activeCount > 0 && failedCount > 0 -> "$failedCount failed"
    activeCount > 0 -> "$activeCount working"
    failedCount > 0 -> "Finished, $failedCount failed"
    else -> "All finished"
  }

  val chip = when {
    !active -> if (phase == ActivityPhase.FAILED) "Failed" else "Done"
    phase == null -> data["activity_chip"]?.takeIf { it.isNotBlank() }?.take(7) ?: "Active"
    phase == ActivityPhase.RUNNING && activeCount > 1 ->
      "${if (activeCount > 9) "9+" else activeCount} live"
    else -> phase.chip
  }

  val action = if (active) phase?.action ?: "Open" else null

  /** Lock-screen sensitive actions (Approve/Answer) require device unlock before opening the thread. */
  val requiresAuthenticationForAction: Boolean
    get() = active && phase?.needsUser == true

  /**
   * Android 16 (API 36+) Live Updates use ProgressStyle for single-thread milestone cards.
   * Multi-thread aggregate notifications stay on BigTextStyle so every thread row remains visible.
   */
  internal val usesLiveUpdateProgressStyle: Boolean
    get() = Build.VERSION.SDK_INT >= 36 && phase != null && !isMultiThread

  fun applyTo(builder: NotificationCompat.Builder, context: Context) {
    val tint = phase?.let { ContextCompat.getColor(context, it.color) }
    if (tint != null) builder.setColor(tint)
    // Tint the summary only when it names an outcome or a request; a plain
    // "3 working" stays neutral so the accent keeps meaning something.
    val tintedSummary = tint != null && rows.size > 1 && phase != ActivityPhase.RUNNING &&
      phase != ActivityPhase.STARTING
    builder.setContentTitle(if (tintedSummary) tinted(summary, tint!!) else summary)
    if (rows.size > 1) {
      builder.setSubText(
        listOfNotNull(
          hero!!.project.takeIf { singleProject && it.isNotBlank() },
          if (activeCount > 0) "$activeCount active" else "$threadCount threads"
        ).joinToString(" · ")
      )
    }
    val body = body(context)
    val lineBreak = body.indexOf('\n')
    val firstLine = if (lineBreak >= 0) body.subSequence(0, lineBreak) else body
    builder.setContentText(firstLine)
    if (usesLiveUpdateProgressStyle && phase != null) {
      builder.setStyle(buildProgressStyle(context, phase))
    } else {
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
    }
    // Thread update timestamps can change while an approval remains pending.
    // Only enable the live chronometer when a stable activity_phase_started_at is supplied
    // for an active, non-waiting execution phase.
    val showChronometer = active &&
      phaseStartedAt != null &&
      phase != null &&
      !phase.finished &&
      !phase.needsUser
    if (showChronometer && phaseStartedAt != null) {
      builder.setShowWhen(true).setWhen(phaseStartedAt).setUsesChronometer(true)
    } else {
      builder.setShowWhen(false).setUsesChronometer(false)
    }
  }

  private fun buildProgressStyle(
    context: Context,
    currentPhase: ActivityPhase,
  ): NotificationCompat.ProgressStyle {
    val workingColor = ContextCompat.getColor(context, R.color.agent_activity_working)
    val waitingColor = ContextCompat.getColor(context, R.color.agent_activity_waiting)
    val attentionColor = ContextCompat.getColor(context, R.color.agent_activity_attention)
    val inputColor = ContextCompat.getColor(context, R.color.agent_activity_input)
    val doneColor = ContextCompat.getColor(context, R.color.agent_activity_done)
    val failedColor = ContextCompat.getColor(context, R.color.agent_activity_failed)

    val runSegmentColor = if (currentPhase == ActivityPhase.STALE) waitingColor else workingColor
    val reviewSegmentColor = when (currentPhase) {
      ActivityPhase.APPROVAL -> attentionColor
      ActivityPhase.INPUT -> inputColor
      ActivityPhase.FAILED -> failedColor
      ActivityPhase.COMPLETED -> doneColor
      else -> workingColor
    }
    val finishSegmentColor = if (currentPhase == ActivityPhase.FAILED) failedColor else doneColor

    val progress = milestoneProgressFor(currentPhase)
    return NotificationCompat.ProgressStyle()
      .setStyledByProgress(true)
      .setProgress(progress)
      .addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(SEGMENT_START).setColor(workingColor)
      )
      .addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(SEGMENT_RUN).setColor(runSegmentColor)
      )
      .addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(SEGMENT_REVIEW).setColor(reviewSegmentColor)
      )
      .addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(SEGMENT_FINISH).setColor(finishSegmentColor)
      )
      .addProgressPoint(
        NotificationCompat.ProgressStyle.Point(SEGMENT_START).setColor(workingColor)
      )
      .addProgressPoint(
        NotificationCompat.ProgressStyle.Point(SEGMENT_START + SEGMENT_RUN)
          .setColor(reviewSegmentColor)
      )
      .addProgressPoint(
        NotificationCompat.ProgressStyle.Point(SEGMENT_START + SEGMENT_RUN + SEGMENT_REVIEW)
          .setColor(finishSegmentColor)
      )
  }

  private fun body(context: Context): CharSequence = when {
    hero == null -> legacyBody
    rows.size == 1 -> statusLine(context, hero.copy(title = hero.project), "")
    else -> SpannableStringBuilder().apply {
      rows.forEachIndexed { index, row ->
        if (index > 0) append("\n")
        append(statusLine(context, row, row.project.takeUnless { singleProject }.orEmpty()))
      }
    }
  }

  private fun statusLine(context: Context, row: ActivityRow, trailing: String): CharSequence =
    SpannableStringBuilder().apply {
      val status = ActivityPhase.forStatus(row.status)
      val color = ContextCompat.getColor(context, status?.color ?: R.color.agent_activity_waiting)
      append(tinted(row.status, color, bold = true))
      append(" ").append(row.title)
      // Promoted cards drop text color, so the separator has to do the work of the dimming.
      if (trailing.isNotBlank()) {
        val start = length
        append(" · ").append(trailing)
        setSpan(
          ForegroundColorSpan(ContextCompat.getColor(context, R.color.agent_activity_waiting)),
          start,
          length,
          Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )
      }
    }

  private fun tinted(text: String, color: Int, bold: Boolean = false) =
    SpannableStringBuilder(text).apply {
      setSpan(ForegroundColorSpan(color), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      if (bold) setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

  companion object {
    private const val SEGMENT_START = 20
    private const val SEGMENT_RUN = 45
    private const val SEGMENT_REVIEW = 20
    private const val SEGMENT_FINISH = 15
    private const val MAX_PHASE_STARTED_SKEW_MS = 24 * 60 * 60 * 1000L

    internal fun milestoneProgressFor(phase: ActivityPhase): Int = when (phase) {
      ActivityPhase.STARTING -> 15
      ActivityPhase.RUNNING -> 50
      ActivityPhase.STALE -> 55
      ActivityPhase.APPROVAL -> 75
      ActivityPhase.INPUT -> 75
      ActivityPhase.COMPLETED -> 100
      ActivityPhase.FAILED -> 100
    }

    private fun parseStablePhaseStartedAt(raw: String?): Long? {
      val parsed = raw?.toLongOrNull() ?: return null
      if (parsed <= 0L) return null
      val now = System.currentTimeMillis()
      return parsed.takeIf { now - it in -60_000L..MAX_PHASE_STARTED_SKEW_MS }
    }
  }
}
