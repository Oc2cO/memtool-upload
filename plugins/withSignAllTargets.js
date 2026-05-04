const { withXcodeProject } = require("@expo/config-plugins");

module.exports = function withSignAllTargets(config) {
  return withXcodeProject(config, async (cfg) => {
    const proj = cfg.modResults;
    const configs = proj.pbxXCBuildConfigurationSection();
    for (const key in configs) {
      if (typeof configs[key] === "string") continue;
      const bs = configs[key].buildSettings;
      if (bs) {
        bs.DEVELOPMENT_TEAM = "7JDY7C3VR5";
      }
    }
    return cfg;
  });
};
