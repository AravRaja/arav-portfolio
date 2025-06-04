import React, { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGLTF, OrbitControls } from '@react-three/drei'
import { useSpring, a } from '@react-spring/three'

function ButtonModel() {
  const { nodes } = useGLTF('/button-test2.glb')
  const [isPressed, setPressed] = useState(false)

  const { position } = useSpring({
    position: isPressed ? [0, 0.05, 0] : [0, 0.1, 0],
    config: { tension: 300, friction: 20 },
  })

  return (
    <group>
      <mesh geometry={nodes.Base.geometry} material={nodes.Base.material} />
      <a.mesh
        geometry={nodes.ButtonTest.geometry}
        material={nodes.ButtonTest.material}
        position={position}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => {
          setPressed(false)
          console.log('Button clicked!')
        }}
        onPointerOver={() => setPressed(false)}
        onPointerOut={() => setPressed(false)}
      />
    </group>
  )
}

export default function ButtonScene() {
  return (
    <Canvas camera={{ position: [0, 5, 10], fov: 50 }}>
      <ambientLight />
      <directionalLight position={[5, 5, 5]} intensity={1} />
      <ButtonModel />
      <OrbitControls />
    </Canvas>
  )
}