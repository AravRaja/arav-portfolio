import React, { useState, useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, OrbitControls } from '@react-three/drei'
import { useSpring, a } from '@react-spring/three'

function DJModel() {
  const { nodes } = useGLTF('/DJ1.glb')
  console.log(nodes)
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
    position: isPressed ? [0, -0.03, 0] : [0, 0, 0],
    config: { tension: 100, friction: 10 },
  })

  return (
    <group>
      <primitive object={nodes.Base} />
      <a.group
        object={nodes.About}
        position={position}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => {
          setPressed(false)
          console.log('About clicked!')
        }}
        onPointerOver={() => setPressed(false)}
        onPointerOut={() => setPressed(false)}
      />
      <primitive object={nodes.Experience} />
      <primitive object={nodes.Projects} />
      <primitive object={nodes.Contact} />
      <primitive
        ref={vinylRef}
        object={nodes.VinylLeft}
        position={[-1.025, 0.35 , -0.39]} 
      />
    </group>
  )
}

export default function DJScene() {
  return (
    <Canvas 
      camera={{ position: [0, 3, 8], fov: 45 }}
      style={{ background: 'white' }} >
      <ambientLight intensity={0} />
      <directionalLight position={[5, 5, 5]} intensity={5} />
      <DJModel />
      <OrbitControls />
    </Canvas>
  )
}