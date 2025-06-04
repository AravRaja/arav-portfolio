import React from 'react'

export default function Box() {
  return (
    <mesh rotation={[0.5, 0.5, 0]}>
      <boxGeometry  args={[18, 18, 18]}/>
      <meshStandardMaterial color="orange" />
    </mesh>
  )
}