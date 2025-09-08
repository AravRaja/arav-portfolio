import { useMemo } from 'react';

// Animation states
export const ANIMATION = {
  IDLE: 'idle',
  UP: 'up',
  DOWN: 'down',
  RUNNING: 'running',
  RUNNING_ACTIVATED: 'running_activated'
};

export const ANIMATION_CONFIG = {
  // Scale factor for all animations
  scale: 1,
  
  // Speed constants
  TONEBAR_SPEED: 0.01,
  LEFT_RIGHT_SF: 3.3,
  MAX_VINYL_SPEED_PER_SEC: 0.4 * 60,
  
  // Vinyl acceleration/deceleration
  VINYL_ACCEL_BASE: 8,
  VINYL_ACCEL_SCALE: 20,
  VINYL_DECEL_BASE: 6,
  VINYL_DECEL_SCALE: 20,
  
  // Starting positions (change to adjust initial pose)
  START_TONEBAR_LEFT_Z: -0.08,
  START_TONEBAR_LEFT_Y: -0.59,
  START_TONEBAR_RIGHT_Z: 0.24,
  START_TONEBAR_RIGHT_Y: -0.02,
  
  // Animation targets (change to adjust how far tonebars move)
  HIGH_TONEBAR_Y: 0.59,       // How high the tonebars lift (Y axis)
  HIGH_TONEBAR_Z: 0.18,       // How far the tonebars swing (Z axis)
  FINAL_TONEBAR_Z: 0.08,      // Final Z offset after animation
};

// Derived constants (calculated from base config)
export const getDerivedConfig = (config = ANIMATION_CONFIG) => {
  const scaledConfig = {
    ...config,
    TONEBAR_SPEED: config.TONEBAR_SPEED * config.scale,
    MAX_VINYL_SPEED_PER_SEC: config.MAX_VINYL_SPEED_PER_SEC * config.scale,
    VINYL_ACCEL_BASE: config.VINYL_ACCEL_BASE * config.scale,
    VINYL_ACCEL_SCALE: config.VINYL_ACCEL_SCALE * config.scale,
    VINYL_DECEL_BASE: config.VINYL_DECEL_BASE * config.scale,
    VINYL_DECEL_SCALE: config.VINYL_DECEL_SCALE * config.scale,
  };

  return {
    ...scaledConfig,
    HIGH_TONEBAR_LEFT_Z: scaledConfig.HIGH_TONEBAR_Z + scaledConfig.START_TONEBAR_LEFT_Z,
    HIGH_TONEBAR_RIGHT_Z: scaledConfig.START_TONEBAR_RIGHT_Z - (scaledConfig.HIGH_TONEBAR_Z * scaledConfig.LEFT_RIGHT_SF),
    HIGH_TONEBAR_LEFT_Y: scaledConfig.HIGH_TONEBAR_Y + scaledConfig.START_TONEBAR_LEFT_Y,
    HIGH_TONEBAR_RIGHT_Y: scaledConfig.START_TONEBAR_RIGHT_Y - (scaledConfig.HIGH_TONEBAR_Z * 3.07),
    FINAL_TONEBAR_LEFT_Z: scaledConfig.FINAL_TONEBAR_Z + scaledConfig.START_TONEBAR_LEFT_Z,
    FINAL_TONEBAR_RIGHT_Z: scaledConfig.START_TONEBAR_RIGHT_Z - (scaledConfig.FINAL_TONEBAR_Z * scaledConfig.LEFT_RIGHT_SF),
  };
};

/**
 * React hook that memoizes the derived animation config.
 * Recomputes only when any of the relevant base config values change.
 */
export const useDerivedConfig = (config) => {
  const cfg = config ?? ANIMATION_CONFIG;
  return useMemo(() => getDerivedConfig(cfg), [cfg]);
};
