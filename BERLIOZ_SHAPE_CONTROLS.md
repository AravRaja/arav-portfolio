# 🎨 Berlioz Visualizer Shape Controls Guide

Complete guide to customizing the 5 animated strokes in your visualizer.

**File to edit:** `/src/components/BerliozVisualizer.jsx` (lines 21-124)

---

## 📍 Basic Position Controls

```javascript
{
  x: width * 0.5,        // Horizontal position (0-1, where 0=left, 1=right)
  y: height * 0.5,       // Vertical position (0-1, where 0=top, 1=bottom)
  length: 200,           // Total length in pixels
  angle: Math.PI / 4,    // Direction angle in radians
  color: '#FF4444',      // Hex color code
  thickness: 15,         // Base thickness in pixels
}
```

### Common Angles:
- `0` = Right →
- `Math.PI / 4` = Northeast ↗
- `Math.PI / 2` = Up ↑
- `Math.PI` = Left ←
- `-Math.PI / 2` = Down ↓

---

## 🌊 Shape Type Controls

### `shapeType` Options:

#### 1. **'wave'** - Sine Wave Pattern
Creates smooth oscillating curves
```javascript
shapeType: 'wave',
waveAmplitude: 40,      // Wave height in pixels (0 = straight line)
waveFrequency: 3,       // Number of complete waves along the length
wavePhase: 0,           // Starting offset (0 to 2π)
```

**Examples:**
- Gentle wave: `amplitude: 20, frequency: 1`
- Tight waves: `amplitude: 30, frequency: 5`
- Offset wave: `amplitude: 40, frequency: 2, phase: Math.PI/2`

#### 2. **'bezier'** - Bezier Curve
Creates smooth curves using control points
```javascript
shapeType: 'bezier',
controlPoint1: { x: 0.3, y: -0.5 },  // First control point
controlPoint2: { x: 0.7, y: 0.5 },   // Second control point
```

**Control Point Guide:**
- `x`: Position along length (0-1, where 0=start, 1=end)
- `y`: Perpendicular offset (-1 to 1, negative=one side, positive=other side)

**Examples:**
- S-curve: `cp1: {x: 0.3, y: -0.5}, cp2: {x: 0.7, y: 0.5}`
- C-curve: `cp1: {x: 0.5, y: 0.8}, cp2: {x: 0.5, y: 0.8}`
- Gentle arc: `cp1: {x: 0.33, y: 0.2}, cp2: {x: 0.66, y: 0.2}`

#### 3. **'straight'** - Straight Line
No curvature, just a straight line

---

## 📏 Thickness Variation

### `thicknessVariation`
Amount of thickness change (0-1)
- `0` = Uniform thickness
- `0.3` = Moderate variation
- `0.8` = High variation

### `thicknessPattern` Options:

#### **'uniform'** - Consistent Thickness
Same thickness throughout

#### **'taper'** - Gradually Thins
```
████████▓▓▓▓▓▓▒▒▒▒░░
```
Starts thick, ends thin (30% of original)

#### **'bulge'** - Thick in Middle
```
▓▓████████████▓▓
```
Thins at both ends, thickest in middle

#### **'pulse'** - Multiple Pulses
```
██▓▓██▓▓██▓▓██▓▓
```
Alternating thick and thin sections

---

## 🎯 Complete Example Presets

### Preset 1: Smooth Arc
```javascript
{
  x: width * 0.2,
  y: height * 0.3,
  length: 300,
  angle: 0,
  color: '#FF4444',
  thickness: 20,
  
  shapeType: 'bezier',
  controlPoint1: { x: 0.5, y: 0.5 },
  controlPoint2: { x: 0.5, y: 0.5 },
  
  thicknessVariation: 0.2,
  thicknessPattern: 'taper',
}
```

### Preset 2: Wavy Ribbon
```javascript
{
  x: width * 0.5,
  y: height * 0.5,
  length: 400,
  angle: Math.PI / 4,
  color: '#4444FF',
  thickness: 15,
  
  shapeType: 'wave',
  waveAmplitude: 50,
  waveFrequency: 4,
  wavePhase: 0,
  
  thicknessVariation: 0.4,
  thicknessPattern: 'pulse',
}
```

### Preset 3: Tapered S-Curve
```javascript
{
  x: width * 0.7,
  y: height * 0.2,
  length: 250,
  angle: Math.PI / 2,
  color: '#FFDD44',
  thickness: 25,
  
  shapeType: 'bezier',
  controlPoint1: { x: 0.3, y: -0.7 },
  controlPoint2: { x: 0.7, y: 0.7 },
  
  thicknessVariation: 0.5,
  thicknessPattern: 'taper',
}
```

### Preset 4: Straight Pulse Line
```javascript
{
  x: width * 0.3,
  y: height * 0.8,
  length: 350,
  angle: 0,
  color: '#FF8844',
  thickness: 18,
  
  shapeType: 'straight',
  waveAmplitude: 0,
  
  thicknessVariation: 0.6,
  thicknessPattern: 'pulse',
}
```

---

## 🎭 Audio Reactive Behavior

All strokes automatically react to the music with:
- **Thickness pulse**: Strokes get thicker on beats
- **Wobble**: Strokes wiggle more intensely with bass
- **Opacity**: Strokes become more opaque with beats
- **Smoothing**: Changes are smoothed for fluid motion

---

## 💡 Pro Tips

1. **Balance Your Strokes**: Mix different shapes (some wavy, some bezier) for visual interest
2. **Color Contrast**: Use complementary colors that pop against your background
3. **Vary Thickness**: Mix thin (10-15px) and thick (20-30px) strokes
4. **Position Strategy**: Spread strokes across the canvas (corners, center, edges)
5. **Layer Depths**: Use z-index to create depth (overlapping strokes)
6. **Test Audio**: Play music to see how strokes pulse with beats

---

## 🎨 Quick Reference

| Property | Type | Range | Effect |
|----------|------|-------|--------|
| `x` | number | 0-1 * width | Horizontal start |
| `y` | number | 0-1 * height | Vertical start |
| `length` | number | pixels | Stroke length |
| `angle` | number | radians | Direction |
| `thickness` | number | pixels | Base thickness |
| `shapeType` | string | wave/bezier/straight | Shape algorithm |
| `waveAmplitude` | number | pixels | Wave height |
| `waveFrequency` | number | count | Wave repetitions |
| `wavePhase` | number | 0-2π | Wave offset |
| `controlPoint1.x` | number | 0-1 | CP1 position |
| `controlPoint1.y` | number | -1 to 1 | CP1 offset |
| `controlPoint2.x` | number | 0-1 | CP2 position |
| `controlPoint2.y` | number | -1 to 1 | CP2 offset |
| `thicknessVariation` | number | 0-1 | Variation amount |
| `thicknessPattern` | string | uniform/taper/bulge/pulse | Pattern type |

---

## 🔧 Troubleshooting

**Stroke not visible?**
- Check x/y are within 0-1 range
- Increase thickness
- Verify color isn't transparent

**Weird curves?**
- Bezier control points too extreme? Try smaller y values (-0.5 to 0.5)
- Wave amplitude too large? Reduce to 20-50 pixels

**Performance issues?**
- Reduce number of strokes (keep 3-5)
- Lower waveFrequency (1-3 is optimal)

---

**Now go create something beautiful! 🎨✨**
