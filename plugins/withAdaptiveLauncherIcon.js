const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ICON_BACKGROUND = '#05070d';

const ADAPTIVE_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;

const LAYER_SOURCES = [
  {
    src: 'assets/source/adaptive-icon-foreground-logo-only.png',
    name: 'ic_launcher_foreground.png',
  },
  {
    src: 'assets/source/adaptive-icon-background.png',
    name: 'ic_launcher_background.png',
  },
  {
    src: 'assets/source/adaptive-icon-monochrome.png',
    name: 'ic_launcher_monochrome.png',
  },
];

// Expo/resizes densities during prebuild; only reinforce missing xxxhdpi layers.
const FALLBACK_MIPMAP = 'mipmap-xxxhdpi';

function ensureIconBackgroundColor(colorsPath) {
  const entry = `    <color name="iconBackground">${ICON_BACKGROUND}</color>`;
  if (!fs.existsSync(colorsPath)) {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<resources>
${entry}
</resources>
`;
    fs.mkdirSync(path.dirname(colorsPath), { recursive: true });
    fs.writeFileSync(colorsPath, body, 'utf8');
    return;
  }

  let xml = fs.readFileSync(colorsPath, 'utf8');
  if (/name="iconBackground"/.test(xml)) {
    xml = xml.replace(
      /<color\s+name="iconBackground">[^<]*<\/color>/,
      `<color name="iconBackground">${ICON_BACKGROUND}</color>`
    );
  } else if (xml.includes('</resources>')) {
    xml = xml.replace('</resources>', `${entry}\n</resources>`);
  } else {
    xml = `${xml.trim()}\n${entry}\n`;
  }
  fs.writeFileSync(colorsPath, xml, 'utf8');
}

function ensureAdaptiveXml(resDir) {
  const anyDpi = path.join(resDir, 'mipmap-anydpi-v26');
  fs.mkdirSync(anyDpi, { recursive: true });
  fs.writeFileSync(path.join(anyDpi, 'ic_launcher.xml'), ADAPTIVE_XML, 'utf8');
  fs.writeFileSync(path.join(anyDpi, 'ic_launcher_round.xml'), ADAPTIVE_XML, 'utf8');
}

function copyLayerPngsIfNeeded(projectRoot, resDir) {
  // Expo already emits webp adaptive layers from app.json adaptiveIcon.
  // Never copy PNG siblings for the same resource name — AAPT fails on
  // duplicate ic_launcher_foreground.png + .webp in the same mipmap folder.
  // Only ensure XML + color exist; layer bitmaps come from Expo prebuild.
  void projectRoot;
  void resDir;
  void LAYER_SOURCES;
  void FALLBACK_MIPMAP;
}

function withAdaptiveLauncherIcon(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const resDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res');
      if (!fs.existsSync(path.dirname(resDir))) {
        // Prebuild has not created android/ yet; Expo adaptiveIcon still applies.
        return modConfig;
      }
      fs.mkdirSync(resDir, { recursive: true });
      ensureAdaptiveXml(resDir);
      ensureIconBackgroundColor(path.join(resDir, 'values', 'colors.xml'));
      copyLayerPngsIfNeeded(projectRoot, resDir);
      return modConfig;
    },
  ]);
}

module.exports = withAdaptiveLauncherIcon;
