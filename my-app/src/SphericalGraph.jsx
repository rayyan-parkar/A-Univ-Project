import React, { useState, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// Vector component that renders a line with an endpoint
function Vector({ start, end, color }) {
  const points = [start, end];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  return (
    <group>
      <line geometry={geometry}>
        <lineBasicMaterial color={color} linewidth={3} />
      </line>
      <mesh position={[end.x, end.y, end.z]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// Wireframe sphere component with optional rotation
function WireframeSphere({ enableRotation = false }) {
  const meshRef = useRef();

  useFrame((state, delta) => {
    if (enableRotation && meshRef.current) {
      meshRef.current.rotation.y += delta * 0.2; // Rotate around Y axis
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 32, 24]} />
      <meshBasicMaterial color="#888888" wireframe />
    </mesh>
  );
}

// Main SphericalGraph component
function SphericalGraph({ 
  vectorData = [], 
  title = "Low Precision",
  enableRotation = false,
  enableCameraControls = false 
}) {
  const [vectors, setVectors] = useState([]);

  // Update vectors when data is received
  useEffect(() => {
    if (vectorData && vectorData.length > 0) {
      setVectors(vectorData);
    } 
    
    else {
      setVectors([]); // Clear vectors if no data
    }
  }, 
  [vectorData]);

return (
    <div style={{ 
        width: '400px', 
        height: '400px',
        background: '#ffffff',
        borderRadius: '8px',
        border: '1px solid #000000'
    }}>
    <Canvas camera={{ position: [2.5, 2.5, 2.5], fov: 50 }}>
      
      <WireframeSphere enableRotation={enableRotation} />
      
      {enableCameraControls && (
        <OrbitControls 
          enablePan={false}
          enableZoom={false}
          enableRotate={false}
          autoRotate={false}
        />
      )}

      {vectors.map((vector, index) => (
        <Vector
          key={index}
          start={new THREE.Vector3(0, 0, 0)}
          end={new THREE.Vector3(vector.x, vector.y, vector.z)}
          color={vector.color || '#ff6b6b'}
        />
      ))}
    </Canvas>
  </div>
);
}

export default SphericalGraph;