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
        <lineBasicMaterial color={color} linewidth={4} />
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
      <sphereGeometry args={[1.25, 32, 24]} />
      <meshBasicMaterial color="#999999" wireframe />
    </mesh>
  );
}

// Main SphericalGraph component
function SphericalGraph({ 
  vectorData = [], 
  title = "Low Precision",
  enableRotation = false,
  enableCameraControls = true 
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
    <div className="spherical-graph">
    <h2>{title}</h2>
    <Canvas camera={{ position: [2.5, 2.5, 2.5], fov: 50 }}>
      
      <WireframeSphere enableRotation={enableRotation} />
      
      {enableCameraControls && (
        <OrbitControls 
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          autoRotate={true}
        />
      )}

      {(() => {
        const vectorElements = [];
        const sphereRadius = 1.25; // Define your desired radius here

        for (let i = 0; i < vectors.length; i++) {
          const vector = vectors[i];
          
          // Create a THREE.Vector3 from the raw data
          const originalVector = new THREE.Vector3(vector.x, vector.y, vector.z);
          
          // Normalize it (make its length 1) and then scale it to the sphere's radius
          const scaledVector = originalVector.normalize().multiplyScalar(sphereRadius);

          vectorElements.push(
            <Vector
              key={i}
              start={new THREE.Vector3(0, 0, 0)}
              end={scaledVector} // Use the new, correctly scaled vector
              color={vector.color || '#ff6b6b'}
            />
          );
        }
        return vectorElements;
      })()}
    </Canvas>
  </div>
);
}

export default SphericalGraph;