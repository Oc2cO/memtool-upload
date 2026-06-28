/* eslint-disable no-restricted-syntax -- Home Atrium V1 decorative layer uses tuned opacity constants. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";

const SOURCES = {
  bg: require("../../assets/memtool/home-atrium/v1/memtool_atrium_bg_quasar_v1.png"),
  moonRing: require("../../assets/memtool/home-atrium/v1/memtool_atrium_moon_ring_v1.png"),
  oceanGlow: require("../../assets/memtool/home-atrium/v1/memtool_atrium_ocean_glow_v1.png"),
  particles: require("../../assets/memtool/home-atrium/v1/memtool_atrium_depth_particles_v1.png"),
  glassTexture: require("../../assets/memtool/home-atrium/v1/memtool_glass_card_texture_v1.png"),
  doorwayGlow: require("../../assets/memtool/home-atrium/v1/memtool_doorway_glow_v1.png"),
  bottomGlow: require("../../assets/memtool/home-atrium/v1/memtool_bottom_safe_area_glow_v1.png"),
};

export function HomeAtriumVisualLayer() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Image source={SOURCES.bg} style={[styles.layer, styles.bg]} contentFit="cover" />
      <Image source={SOURCES.moonRing} style={[styles.layer, styles.moonRing]} contentFit="cover" />
      <Image source={SOURCES.oceanGlow} style={[styles.layer, styles.oceanGlow]} contentFit="cover" />
      <Image source={SOURCES.particles} style={[styles.layer, styles.particles]} contentFit="cover" />
      <Image source={SOURCES.glassTexture} style={[styles.layer, styles.glassTexture]} contentFit="cover" />
      <Image source={SOURCES.doorwayGlow} style={[styles.layer, styles.doorwayGlow]} contentFit="cover" />
      <Image source={SOURCES.bottomGlow} style={[styles.layer, styles.bottomGlow]} contentFit="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  bg: { opacity: 0.34 },
  moonRing: { opacity: 0.44 },
  oceanGlow: { opacity: 0.38 },
  particles: { opacity: 0.24 },
  glassTexture: { opacity: 0.18 },
  doorwayGlow: { opacity: 0.3 },
  bottomGlow: { opacity: 0.36 },
});

