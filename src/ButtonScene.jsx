import React, { useState, useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, OrbitControls } from '@react-three/drei'
import { useSpring, a } from '@react-spring/three'

function ButtonModel() {
  const { nodes } = useGLTF('/button-test3.glb')
  const [isPressed, setPressed] = useState(false)
  const vinylRef = useRef()
  const [rotationSpeed, setRotationSpeed] = useState(0)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        setRotationSpeed((prev) => Math.min(prev + 0.005, 0.2)) // max speed
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useFrame(() => {
    if (vinylRef.current) {
      vinylRef.current.rotation.y += rotationSpeed
    }
  })

  const { position } = useSpring({
    position: isPressed ? [0, -0.05, 0] : [0, 0, 0],
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
      <mesh
        ref={vinylRef}
        geometry={nodes.Vinyl.geometry}
        material={nodes.Vinyl.material}
        position={[0, 0.101, 0]} // just above the base
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