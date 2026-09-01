const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Forces the 16 KB page-size aligned ML Kit face-detection artifact.
 *
 * expo-face-detector pins com.google.mlkit:face-detection:16.1.5, whose native
 * libs (libface_detector_v2_jni.so, libabarhopper_v3.so) are not 16 KB aligned.
 * ML Kit 16.1.7+ ships 16 KB-aligned native libraries.
 */
const MLKIT_ALIGNED_VERSION = "16.1.7";

const withMlKit16KB = (config) => {
  return withAppBuildGradle(config, (config) => {
    const injection = [
      "",
      `// 16 KB page-size support: force aligned ML Kit artifacts (added by withMlKit16KB plugin)`,
      `configurations.all {`,
      `    resolutionStrategy {`,
      `        force "com.google.mlkit:face-detection:${MLKIT_ALIGNED_VERSION}"`,
      `    }`,
      `}`,
    ].join("\n");

    if (!config.modResults.contents.includes(`face-detection:${MLKIT_ALIGNED_VERSION}`)) {
      config.modResults.contents = `${config.modResults.contents}\n${injection}\n`;
    }
    return config;
  });
};

module.exports = withMlKit16KB;
