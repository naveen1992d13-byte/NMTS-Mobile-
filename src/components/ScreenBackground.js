import React, { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { BG } from '../theme';

const WALL = require('../../assets/source/nmts-mobile-wall-background.webp');

export const WALL_OVERLAY_OPACITY = 0.6;

function ScreenBackgroundInner({ children, overlayOpacity = WALL_OVERLAY_OPACITY }) {
  return (
    <View style={styles.root} collapsable={false}>
      <Image
        source={WALL}
        style={styles.image}
        resizeMode="cover"
        pointerEvents="none"
      />
      <View
        pointerEvents="none"
        style={[styles.overlay, { opacity: overlayOpacity }]}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

export const ScreenBackground = memo(ScreenBackgroundInner);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    overflow: 'hidden',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
  },
  content: {
    flex: 1,
  },
});
