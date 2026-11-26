"use strict";

// Precede expo-widgets so its reverse-ordered mods generate SubscriptionUsageProvider.kt first,
// then this plugin upgrades it with a direct BAL-compliant Glance actionStartActivity launch.

const fs = require("fs");
const path = require("path");
const { AndroidConfig, withDangerousMod } = require("expo/config-plugins");

const MARKER = "// Managed by plugins/withAndroidWidgetDeepLink.cjs";
const WIDGET_NAME = "SubscriptionUsage";
const PROVIDER_CLASS_NAME = `${WIDGET_NAME}Provider`;
const LAUNCH_URL_PREFS = "expo.modules.t3widgetexpiry.LAUNCH_URLS";

function resolvePrimaryScheme(scheme) {
  if (Array.isArray(scheme)) {
    const first = scheme.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    if (first) return first.trim();
  }
  if (typeof scheme === "string" && scheme.trim().length > 0) {
    return scheme.trim();
  }
  return "rutico";
}

function buildProviderSource(androidPackage, primaryScheme) {
  const fallbackUrl = `${primaryScheme}://settings/usage?tab=limits`;
  return `package ${androidPackage}

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.compose.ui.unit.DpSize
import androidx.glance.Emittable
import androidx.glance.EmittableWithChildren
import androidx.glance.GlanceModifier
import androidx.glance.action.Action
import androidx.glance.action.ActionModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.AppWidgetId
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import expo.modules.widgets.ExpoWidgetsAppWidgetProvider
import io.github.expo.peek.emittables.PeekEmittableAppWidget

${MARKER}
// Binds a BAL-compliant Activity PendingIntent via Glance actionStartActivity so widget taps
// launch Rutico directly to Usage even from a cold/terminated process.
class ${PROVIDER_CLASS_NAME} : ExpoWidgetsAppWidgetProvider("${WIDGET_NAME}") {
  private val baseWidget: PeekEmittableAppWidget = super.glanceAppWidget

  override val glanceAppWidget: PeekEmittableAppWidget =
    SubscriptionUsageDeepLinkWidget(
      delegate = baseWidget,
      widgetName = "${WIDGET_NAME}",
      fallbackUrl = "${fallbackUrl}",
    )
}

@SuppressLint("RestrictedApi")
private class SubscriptionUsageDeepLinkWidget(
  private val delegate: PeekEmittableAppWidget,
  private val widgetName: String,
  private val fallbackUrl: String,
) : PeekEmittableAppWidget() {
  override val sizeMode: SizeMode = delegate.sizeMode

  override fun provideRoot(
    context: Context,
    id: AppWidgetId,
    options: Bundle,
    size: DpSize,
  ): Emittable {
    val root = delegate.provideRoot(context, id, options, size)
    val launchUrl = resolveLaunchUrl(context, widgetName, fallbackUrl)
    val launchIntent =
      Intent(Intent.ACTION_VIEW, Uri.parse(launchUrl))
        .setPackage(context.packageName)
        .addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_SINGLE_TOP
        )
    val launchAction = actionStartActivity(launchIntent)
    if (!replaceActionModifiers(root, launchAction)) {
      root.modifier = root.modifier.clickable(launchAction)
    }
    return root
  }

  private fun resolveLaunchUrl(
    context: Context,
    name: String,
    fallback: String,
  ): String {
    val stored =
      context
        .getSharedPreferences("${LAUNCH_URL_PREFS}", Context.MODE_PRIVATE)
        .getString(name, null)
        ?.trim()
    if (!stored.isNullOrEmpty()) {
      val parsed = Uri.parse(stored)
      if (!parsed.scheme.isNullOrBlank()) {
        return stored
      }
    }
    return fallback
  }

  private fun replaceActionModifiers(node: Emittable, launchAction: Action): Boolean {
    var replaced = false
    if (node.modifier.any { it is ActionModifier }) {
      val stripped =
        node.modifier.foldIn(GlanceModifier as GlanceModifier) { acc, element ->
          if (element is ActionModifier) acc else acc.then(element)
        }
      node.modifier = stripped.clickable(launchAction)
      replaced = true
    }
    if (node is EmittableWithChildren) {
      for (child in node.children) {
        if (replaceActionModifiers(child, launchAction)) {
          replaced = true
        }
      }
    }
    return replaced
  }
}
`;
}

function patchSubscriptionUsageProvider(source, androidPackage, primaryScheme) {
  if (!source.includes(`class ${PROVIDER_CLASS_NAME}`)) {
    throw new Error(`Could not find ${PROVIDER_CLASS_NAME} in generated widget provider source.`);
  }
  return buildProviderSource(androidPackage, primaryScheme);
}

function withAndroidWidgetDeepLink(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const androidPackage = AndroidConfig.Package.getPackage(cfg);
      if (!androidPackage) {
        return cfg;
      }
      const providerPath = path.join(
        cfg.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...androidPackage.split("."),
        `${PROVIDER_CLASS_NAME}.kt`,
      );
      if (!fs.existsSync(providerPath)) {
        return cfg;
      }
      const existing = fs.readFileSync(providerPath, "utf8");
      const primaryScheme = resolvePrimaryScheme(cfg.scheme);
      const patched = patchSubscriptionUsageProvider(existing, androidPackage, primaryScheme);
      if (patched !== existing) {
        fs.writeFileSync(providerPath, patched);
      }
      return cfg;
    },
  ]);
}

withAndroidWidgetDeepLink.patchSubscriptionUsageProvider = patchSubscriptionUsageProvider;
withAndroidWidgetDeepLink.resolvePrimaryScheme = resolvePrimaryScheme;
withAndroidWidgetDeepLink.MARKER = MARKER;

module.exports = withAndroidWidgetDeepLink;
